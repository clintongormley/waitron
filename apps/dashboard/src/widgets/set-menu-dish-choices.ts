import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import {
  baseStyles,
  draftScopeFor,
  leaveCoordinatorFor,
  saveActionState,
  type DraftScope,
  type LeaveReason,
} from "@waitron/ui";
import { MAX_SET_MENU_AMOUNT_CENTS, stringToCents } from "@waitron/shared";
import { isProductPrice } from "@waitron/menu/src/modifier-limits.js";
import type { CategorySummary, DashboardApi, Product, SetMenuDetails } from "../api/client.js";
import { codeMessage, codeOf, fieldOf } from "../i18n/codes.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import type { SetMenuDishesSaved } from "./set-menu-dishes.js";
import "./section-add-products.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-price-input.js";
import "@waitron/ui/src/components/wt-switch.js";

type Dish = SetMenuDetails["dishes"][number];
type VariantChoice = { variantId: string; included: boolean; surcharge: string };
export const validSurcharge = (value: string) =>
  value === "" || (isProductPrice(value) && stringToCents(value) <= MAX_SET_MENU_AMOUNT_CENTS);

export function dishRefusal(
  error: unknown,
  products: readonly Pick<Product, "id" | "name">[],
): string {
  if (codeOf(error) === "set_menu.dish_sold_by_measure") {
    const params = (error as { params?: { productId?: unknown } }).params;
    const product = products.find(({ id }) => id === params?.productId);
    return product
      ? fill("menus.set_menu_cannot_add_measured", { name: product.name })
      : t("menus.set_menu_cannot_add_measured_unnamed");
  }
  return codeMessage(codeOf(error), undefined, { field: fieldOf(error) });
}

@customElement("dashboard-set-menu-dish-choices")
export class SetMenuDishChoices extends LitElement {
  static override styles = [
    baseStyles,
    css`
      fieldset {
        border: 0;
        padding: 0;
        margin: 0 0 var(--wt-space-4);
      }
      legend {
        font-weight: var(--wt-font-weight-bold);
      }
      label {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-block-size: var(--wt-tap-min);
      }
      input[type="checkbox"] {
        accent-color: var(--wt-color-primary);
      }
      .variant {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-3);
        align-items: center;
        margin-block: var(--wt-space-3);
      }
      .variant > span {
        flex: 1 0 calc(var(--wt-space-6) * 3);
        overflow-wrap: anywhere;
      }
      .variant > wt-price-input {
        flex: 1 1 calc(var(--wt-space-6) * 5);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) details!: SetMenuDetails;
  @property({ attribute: false }) dish: Dish | null = null;
  @state() private products: Product[] | null = null;
  @state() private categories: CategorySummary[] = [];
  @state() private selected: Product[] = [];
  @state() private excluded = new Set<string>();
  @state() private draft: VariantChoice[] = [];
  @state() private loading = false;
  @state() private loadError = false;
  @state() private saving = false;
  @state() private error = "";
  #scope?: DraftScope<VariantChoice[]>;

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.dish === null) void this.#loadProducts();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has("dish") || this.dish === null) return;
    this.#scope?.dispose();
    this.draft = this.dish.variants.map(({ id, included, surcharge }) => ({
      variantId: id,
      included,
      surcharge: surcharge ?? "",
    }));
    this.#scope = draftScopeFor(this, {
      id: this,
      current: () => this.draft,
      snapshot: (draft) => [...draft],
      equal: (a, b) =>
        a.every(
          (choice, i) => choice.included === b[i]?.included && choice.surcharge === b[i]?.surcharge,
        ),
      restore: (draft) => {
        this.draft = draft;
      },
    }).scope;
    this.#scope.commit(this.draft);
  }

  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    super.disconnectedCallback();
  }

  async #loadProducts(): Promise<void> {
    this.loading = true;
    this.loadError = false;
    const api = this.api.background ?? this.api;
    try {
      const [products, categories] = await Promise.all([
        api.listLibraryProducts(),
        api.listCategories(),
      ]);
      this.products = products.filter(({ active }) => active);
      this.categories = categories;
    } catch {
      this.loadError = true;
    } finally {
      this.loading = false;
    }
  }

  #picker() {
    return this.renderRoot.querySelector("dashboard-section-add-products");
  }

  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> => {
    if (this.saving) return false;
    const scope = this.dish ? this.#scope?.id : this.#picker();
    const leave = leaveCoordinatorFor(this);
    return (
      !scope ||
      !leave ||
      (await leave.request({ scopes: [scope], reason, proceed() {} })) === "proceeded"
    );
  };

  #close(): void {
    void this.renderRoot.querySelector("wt-modal")!.requestClose("cancel");
  }

  #closed(): void {
    this.dispatchEvent(
      new CustomEvent("set-menu-dish-dialog-closed", { bubbles: true, composed: true }),
    );
  }

  #saved(result: SetMenuDishesSaved): void {
    this.#scope?.commit(this.draft);
    this.#picker()?.commitSaved(this.selected.map(({ id }) => id));
    this.renderRoot.querySelector("wt-modal")!.closeAfter("saved");
    this.dispatchEvent(
      new CustomEvent("set-menu-dishes-saved", { detail: result, bubbles: true, composed: true }),
    );
  }

  #pick(event: CustomEvent<{ productIds: string[] }>): void {
    event.stopPropagation();
    const selected = this.products!.filter(({ id }) => event.detail.productIds.includes(id));
    this.error = "";
    if (selected.some(({ variants }) => variants.some(({ active }) => active))) {
      this.selected = selected;
      return;
    }
    void this.#add(selected);
  }

  async #add(selected = this.selected): Promise<void> {
    if (this.saving || selected.length === 0) return;
    this.saving = true;
    this.error = "";
    try {
      const dishes = selected.map(({ id, variants }) => ({
        productId: id,
        excludedVariantIds: variants
          .filter(({ id, active }) => active && this.excluded.has(id))
          .map(({ id }) => id),
      }));
      this.#saved(await this.api.addSetMenuDishes(this.details.id, dishes));
    } catch (error) {
      this.error = dishRefusal(error, selected);
    } finally {
      this.saving = false;
    }
  }

  #edit(variantId: string, patch: Partial<VariantChoice>): void {
    this.draft = this.draft.map((choice) =>
      choice.variantId === variantId ? { ...choice, ...patch } : choice,
    );
    this.error = "";
    this.#scope?.changed();
  }

  #invalid(choice: VariantChoice): boolean {
    return choice.included && !validSurcharge(choice.surcharge.trim());
  }

  async #saveVariants(dish: Dish): Promise<void> {
    if (
      this.saving ||
      !this.#scope?.isDirty() ||
      this.draft.some((choice) => this.#invalid(choice))
    )
      return;
    this.error = "";
    this.saving = true;
    const choices = this.draft.map(({ variantId, included, surcharge }) => ({
      variantId,
      included,
      surcharge: included ? surcharge.trim() || null : null,
    }));
    try {
      this.#saved({
        details: await this.api.saveSetMenuVariantChoices(
          this.details.id,
          dish.menuItemId,
          choices,
        ),
      });
    } catch (error) {
      this.error = dishRefusal(error, [{ id: dish.productId, name: dish.name }]);
    } finally {
      this.saving = false;
    }
  }

  #cancel() {
    return html`<wt-button
      slot="cancel"
      variant="secondary"
      .disabled=${this.saving}
      @click=${() => this.#close()}
      >${t("action.cancel")}</wt-button
    >`;
  }

  #variantFields(dish: Dish) {
    return repeat(
      dish.variants,
      ({ id }) => id,
      (variant, i) => {
        const choice = this.draft[i]!;
        const course = this.details.courses.find(({ id }) => id === variant.courseId);
        return html`<div class="variant">
          <span
            >${variant.name}${course && variant.courseId !== dish.courseId ? html` · ${course.name}` : nothing}</span
          >
          <wt-switch
            label=${t("menus.set_menu_included")}
            accessible-name=${fill("menus.set_menu_include_variant", { name: variant.name })}
            name="included"
            .checked=${choice.included}
            .disabled=${this.saving}
            @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
              event.stopPropagation();
              this.#edit(variant.id, { included: event.detail.checked });
            }}
          ></wt-switch>
          <wt-price-input
            name="surcharge"
            fixed-unit
            locale=${currentLocale()}
            label=${fill("menus.set_menu_surcharge_for", { name: variant.name })}
            placeholder=${dish.surcharge === null ? t("menus.set_menu_included") : dish.surcharge}
            .value=${choice.surcharge}
            .disabled=${!choice.included || this.saving}
            .error=${this.#invalid(choice) ? codeMessage("set_menu.invalid", undefined, { field: "surcharge" }) : ""}
            @wt-change=${(event: CustomEvent<{ value: string }>) => {
              event.stopPropagation();
              this.#edit(variant.id, { surcharge: event.detail.value });
            }}
          ></wt-price-input>
        </div>`;
      },
    );
  }

  #variantFooter(dish: Dish) {
    const save = saveActionState(this.#scope);
    const invalid = this.draft.some((choice) => this.#invalid(choice));
    return html`<wt-form-actions
      slot="footer"
      .error=${this.error || (invalid ? t("menus.set_menu_check_surcharges") : "")}
    >
      ${this.#cancel()}
      <wt-button
        variant=${save.variant}
        .disabled=${save.unchanged || invalid || this.saving}
        .loading=${this.saving}
        @click=${() => void this.#saveVariants(dish)}
        >${t("action.save")}</wt-button
      >
    </wt-form-actions>`;
  }

  #addedVariants() {
    return this.selected.map((product) => {
      const variants = product.variants.filter(({ active }) => active);
      if (variants.length === 0) return nothing;
      return html`<fieldset>
        <legend>${product.name}</legend>
        ${variants.map(
          ({ id, name }) =>
            html`<label
              ><input
                type="checkbox"
                name="included"
                .checked=${!this.excluded.has(id)}
                .disabled=${this.saving}
                @change=${(event: Event) => {
                  const included = (event.target as HTMLInputElement).checked;
                  const excluded = new Set(this.excluded);
                  if (included) excluded.delete(id);
                  else excluded.add(id);
                  this.excluded = excluded;
                  this.error = "";
                }}
              />${name}</label
            >`,
        )}
      </fieldset>`;
    });
  }

  #addBody() {
    if (this.loading) return html`<p role="status">${t("menus.loading")}</p>`;
    if (this.loadError)
      return html`<p role="alert">${t("menus.set_menu_products_load_error")}</p>
        <wt-button variant="secondary" @click=${() => void this.#loadProducts()}
          >${t("menus.retry")}</wt-button
        >`;
    const pickingVariants = this.selected.length > 0;
    return html`<div ?hidden=${pickingVariants}>
        <dashboard-section-add-products
          .products=${this.products ?? []}
          .categories=${this.categories}
          .inSection=${this.details.dishes.map(({ productId }) => productId)}
          .confirmLabel=${t("menus.set_menu_add_selected")}
          .requestError=${this.error}
          .busy=${this.saving}
          @wt-add-products=${(event: CustomEvent<{ productIds: string[] }>) => this.#pick(event)}
          >${this.#cancel()}</dashboard-section-add-products
        >
      </div>
      ${pickingVariants ? this.#addedVariants() : nothing}`;
  }

  #addFooter() {
    return this.selected.length === 0
      ? nothing
      : html`<wt-form-actions slot="footer" .error=${this.error}>
          <wt-button
            slot="cancel"
            variant="secondary"
            .disabled=${this.saving}
            @click=${() => {
              this.selected = [];
              this.error = "";
            }}
            >${t("action.back")}</wt-button
          >
          <wt-button
            variant="primary"
            .disabled=${this.saving}
            .loading=${this.saving}
            @click=${() => void this.#add()}
            >${t("sections.add_products")}</wt-button
          >
        </wt-form-actions>`;
  }

  override render() {
    const dish = this.dish;
    return html`<wt-modal
      open
      size="standard"
      height="medium"
      heading=${dish ? fill("menus.set_menu_variants_for", { name: dish.name }) : t("sections.add_products")}
      .beforeClose=${this.#beforeClose}
      @wt-close=${(event: Event) => {
        if (event.target === event.currentTarget) this.#closed();
      }}
      >${dish ? this.#variantFields(dish) : this.#addBody()}
      ${dish ? this.#variantFooter(dish) : this.#addFooter()}
    </wt-modal>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-set-menu-dish-choices": SetMenuDishChoices;
  }
}
