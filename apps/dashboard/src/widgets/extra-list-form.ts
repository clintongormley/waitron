import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { baseStyles, submitOnEnter } from "@waitron/ui";
import { isProductPrice } from "@waitron/catalogue/src/modifier-limits.js";
import type { ContentLanguages } from "@waitron/shared";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import { optionalTextFields, translations, wholeWithin, type FieldContext } from "./form-fields.js";
import { reorder } from "./reorder.js";
import { ReorderController, type ReorderModel } from "./reorder-table.js";
import type { ExtraList, ExtraListInput, Product } from "../api/client.js";
import { t } from "../i18n/t.js";

interface DraftItem {
  id: string;
  productId: string;
  maxQuantity: string;
  preselected: boolean;
  price: string;
}

/**
 * Every refusal answered here is one `parseExtraListInput` also refuses
 * (packages/catalogue/src/extra-contract.ts).
 *
 * A blank price is emitted as `null`, which is what keeps "inherits" and "set to the same number"
 * different rows.
 */
@customElement("dashboard-extra-list-form")
export class ExtraListForm extends LitElement {
  static override styles = [
    baseStyles,
    ReorderController.styles,
    ReorderController.tableStyles,
    css`
      :host {
        display: block;
      }
      .fields {
        display: grid;
        gap: var(--wt-space-4);
      }
      .names {
        display: grid;
        gap: var(--wt-space-3);
      }
      .error {
        color: var(--wt-color-danger);
        margin: var(--wt-space-1) 0 0;
        font-size: var(--wt-font-size-sm);
      }
      .item-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: end;
        gap: var(--wt-space-2);
      }
      /* The picker's trigger fills its own box, and its open panel is sized to that trigger, so a
         narrow box wraps every product name onto two lines. It takes the row's spare width instead,
         floored at the same token the translated-name cells use. */
      .picker {
        flex: 1 1 var(--wt-cell-name-max-width);
      }
      /* A lone input in a cell has no width of its own, so the automatic table layout gives the
         column what its HEADER needs and nothing more — and "Price" is the shortest word in this
         table, which cut a two-digit price off mid-number. Same mechanism, token and fix as the
         options form's own cell-field rule; the table's own scroller absorbs the extra width. */
      .cell-field {
        min-width: var(--wt-cell-name-max-width);
      }
    `,
  ];

  @property({ type: Boolean }) open = false;
  @property({ type: Boolean }) busy = false;
  @property({ attribute: false }) languages: ContentLanguages = {
    defaultLanguage: "en",
    languages: ["en"],
  };
  @property({ attribute: false }) value: ExtraList | null = null;
  /** A product already on the list stays in the picker, because hiding it would make a manager's
   * search for it come back empty with no reason given, where offering it again produces the
   * duplicate refusal below, which says what is wrong. */
  @property({ attribute: false }) products: Product[] = [];
  /** The server's refusal, keyed by the field path `parseExtraListInput` reports. */
  @property({ attribute: false }) fieldErrors: Record<string, string> = {};
  @state() private name = "";
  @state() private customerName: Record<string, string> = {};
  @state() private kitchenName = "";
  @state() private minPicks = "0";
  @state() private maxPicks = "";
  @state() private active = true;
  @state() private items: DraftItem[] = [];
  /** The product the picker is on, "" when it is on its blank entry. */
  @state() private pick = "";
  @state() private validation: Record<string, string> = {};
  /** `fieldErrors` with each path turned into one of this form's own keys. An item's message is
   * held against the item's ID rather than the position the server named, so moving an item
   * carries its message with it. */
  @state() private serverErrors: Record<string, string> = {};

  readonly #reorder = new ReorderController(this, {
    order: () => this.items.map((item) => item.id),
    move: (id, to) => this.#move(id, to),
    label: (id) => {
      const item = this.items.find((each) => each.id === id);
      return item ? this.#productName(item.productId) : t("extras.product");
    },
    busy: () => this.busy,
    get reorderLabel(): string {
      return t("extras.reorder");
    },
  } satisfies ReorderModel);

  protected override willUpdate(changes: PropertyValues<this>): void {
    if (changes.has("products"))
      this.#productById = new Map(this.products.map((product) => [product.id, product]));
    if (
      (changes.has("open") && this.open) ||
      (changes.has("value") &&
        this.value?.id !== (changes.get("value") as ExtraList | null | undefined)?.id)
    ) {
      this.#reseed();
    }
    // After the reseed, so an item path resolves against the items now on screen.
    if (changes.has("fieldErrors")) this.serverErrors = this.#mapFieldErrors();
  }

  #reseed(): void {
    const value = this.value;
    this.name = value?.name ?? "";
    this.customerName = { ...value?.customerName };
    this.kitchenName = value?.kitchenName ?? "";
    this.minPicks = String(value?.minPicks ?? 0);
    this.maxPicks = value?.maxPicks == null ? "" : String(value.maxPicks);
    this.active = value?.active ?? true;
    this.items = (value?.items ?? []).map((item) => ({
      id: item.id,
      productId: item.productId,
      maxQuantity: String(item.maxQuantity),
      preselected: item.preselected,
      price: item.price ?? "",
    }));
    this.pick = "";
    this.validation = {};
  }

  #productById = new Map<string, Product>();

  #productName(productId: string): string {
    return this.#productById.get(productId)?.name ?? t("extras.unknown_product");
  }

  #inheritedPrice(productId: string): string {
    return this.#productById.get(productId)?.unitPrice ?? "";
  }

  /** The language a refusal naming a whole translated map is shown against: the first input on
   * screen. `parseExtraListInput` names the map, never the language inside it. */
  #primaryLanguage(): string {
    return this.languages.languages[0] ?? this.languages.defaultLanguage;
  }

  #mapFieldErrors(): Record<string, string> {
    const mapped: Record<string, string> = {};
    for (const [field, message] of Object.entries(this.fieldErrors))
      mapped[this.#formKey(field)] = message;
    return mapped;
  }

  /** A path naming the list as a whole or an item's id has no input of its own, so it is shown under
   * the items table with the rest of the list-level refusals. */
  #formKey(field: string): string {
    const item = /^items\.(\d+)(?:\.(.+))?$/.exec(field);
    if (item) {
      const id = this.items[Number(item[1])]?.id;
      const key = this.#itemKey(item[2] ?? "");
      return id === undefined || key === null ? "items" : `item:${id}:${key}`;
    }
    return this.#listKey(field) ?? "items";
  }

  #itemKey(field: string): string | null {
    if (field === "productId") return "product";
    if (field === "maxQuantity") return "max-quantity";
    if (field === "preselected") return "preselected";
    if (field === "price") return "price";
    return null;
  }

  #listKey(field: string): string | null {
    if (field === "name") return "name";
    if (field === "customerName") return `customer-name-${this.#primaryLanguage()}`;
    if (field === "kitchenName") return "kitchen-name";
    if (field === "minPicks") return "min-picks";
    if (field === "maxPicks") return "max-picks";
    if (field === "active") return "active";
    return null;
  }

  #errors(): Record<string, string> {
    const errors: Record<string, string> = {};
    for (const [key, message] of Object.entries(this.serverErrors)) {
      const held = /^item:([^:]+):(.+)$/.exec(key);
      if (held === null) {
        errors[key] = message;
        continue;
      }
      const index = this.items.findIndex((item) => item.id === held[1]);
      errors[index < 0 ? "items" : `item-${index}-${held[2]}`] = message;
    }
    return { ...errors, ...this.validation };
  }

  #edit(change: () => void): void {
    change();
    this.validation = {};
  }

  #editItem(id: string, patch: Partial<DraftItem>): void {
    this.#edit(() => {
      this.items = this.items.map((item) => (item.id === id ? { ...item, ...patch } : item));
    });
  }

  #addItem(): void {
    const productId = this.pick;
    if (!productId) return;
    this.#edit(() => {
      // An item is given its id HERE, not by the server. `writeItems` deletes every item of the
      // list and re-inserts the body's under `item.id ?? randomUUID()`
      // (packages/catalogue/src/extras.ts), so a row keeps its identity across a save only because
      // the body carried an id for it.
      const item: DraftItem = {
        id: crypto.randomUUID(),
        productId,
        maxQuantity: "1",
        preselected: false,
        price: "",
      };
      this.items = [...this.items, item];
      // Back to the blank entry, so a second click on Add cannot repeat the last product.
      this.pick = "";
    });
  }

  #removeItem(id: string): void {
    this.#edit(() => {
      this.items = this.items.filter((item) => item.id !== id);
    });
  }

  /** The items array order IS the saved order, so a move rewrites the array rather than a rank. */
  #move(id: string, to: number): void {
    const from = this.items.findIndex((item) => item.id === id);
    if (from < 0) return;
    this.#edit(() => {
      this.items = reorder(this.items, from, to);
    });
  }

  #emit(
    event: Event,
    type: "wt-submit" | "wt-cancel",
    detail: { value: ExtraListInput } | Record<string, never>,
  ): void {
    event.stopPropagation();
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  #submit(event: Event): void {
    event.stopPropagation();
    if (this.busy) return;
    const validation: Record<string, string> = {};
    if (!this.name.trim()) validation.name = t("extras.name_required");
    // A blank minimum is the contract's own default of 0 (`row.minPicks === undefined ? 0`), which
    // makes the list optional.
    const minPicks = wholeWithin(this.minPicks.trim() || "0", 0);
    if (minPicks === null) validation["min-picks"] = t("extras.picks_invalid");
    const capped = this.maxPicks.trim() !== "";
    const maxPicks = capped ? wholeWithin(this.maxPicks.trim(), 0) : null;
    if (capped && maxPicks === null) validation["max-picks"] = t("extras.picks_invalid");
    // The cap is what is wrong when the pair cannot both hold, so the message goes there rather
    // than on the minimum — the field `parseExtraListInput` names, and for the reason it states.
    else if (minPicks !== null && maxPicks !== null && maxPicks < minPicks)
      validation["max-picks"] = t("extras.max_picks_too_low");

    const offered = new Set<string>();
    const items = this.items.map((item, index) => {
      const maxQuantity = wholeWithin(item.maxQuantity.trim(), 1);
      if (maxQuantity === null)
        validation[`item-${index}-max-quantity`] = t("extras.quantity_invalid");
      const price = item.price.trim();
      if (price !== "" && !isProductPrice(price))
        validation[`item-${index}-price`] = t("extras.price_invalid");
      // One offer per product per list: two rows for the same product would give the diner two ways
      // to pick the same thing on different terms, which is why `parseExtraListInput` refuses the
      // second one naming `items.N.productId`.
      if (offered.has(item.productId))
        validation[`item-${index}-product`] = t("extras.duplicate_product");
      offered.add(item.productId);
      return {
        id: item.id,
        productId: item.productId,
        maxQuantity: maxQuantity ?? 1,
        preselected: item.preselected,
        price: price || null,
      };
    });
    // An active list is asked on every order of a dish carrying it and there is nothing to answer
    // it with when it offers no product. An inactive list is never asked, so it may be empty — the
    // same split the server makes.
    if (this.active && items.length === 0) validation.items = t("extras.items_required");

    this.validation = validation;
    if (minPicks === null || Object.keys(validation).length) return;
    this.#emit(event, "wt-submit", {
      value: {
        name: this.name.trim(),
        customerName: translations(this.customerName),
        kitchenName: this.kitchenName.trim() || null,
        minPicks,
        maxPicks,
        active: this.active,
        items,
      },
    });
  }

  #cancel(event: Event): void {
    if (this.busy) {
      event.stopPropagation();
      return;
    }
    this.#emit(event, "wt-cancel", {});
  }

  #fields(errors: Record<string, string>): FieldContext {
    return {
      busy: this.busy,
      locales: this.languages.languages,
      error: (key) => errors[key] ?? "",
    };
  }

  #itemRow(item: DraftItem, index: number, errors: Record<string, string>) {
    const named = this.#productName(item.productId);
    const productError = errors[`item-${index}-product`];
    return html`<tr data-item=${item.id}>
      <td class="handle-cell">${this.#reorder.handle(item.id)}</td>
      <td>
        <span data-test=${`item-${index}-product`}>${named}</span>
        ${
          productError
            ? html`<p class="error" data-test=${`item-${index}-product-error`}>${productError}</p>`
            : nothing
        }
      </td>
      <td>
        <wt-input
          name=${`item-${index}-max-quantity`}
          label=${t("extras.max_quantity")}
          required
          .disabled=${this.busy}
          .value=${item.maxQuantity}
          .error=${errors[`item-${index}-max-quantity`] ?? ""}
          .invalid=${!!errors[`item-${index}-max-quantity`]}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.#editItem(item.id, { maxQuantity: event.detail.value });
          }}
        ></wt-input>
      </td>
      <td>
        <wt-switch
          name=${`item-${index}-preselected`}
          data-test=${`item-${index}-preselected`}
          label=${t("extras.preselected")}
          .checked=${item.preselected}
          .disabled=${this.busy}
          @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
            event.stopPropagation();
            this.#editItem(item.id, { preselected: event.detail.checked });
          }}
        ></wt-switch>
      </td>
      <td>
        <wt-input
          class="cell-field"
          name=${`item-${index}-price`}
          label=${t("extras.price")}
          placeholder=${this.#inheritedPrice(item.productId)}
          .disabled=${this.busy}
          .value=${item.price}
          .error=${errors[`item-${index}-price`] ?? ""}
          .invalid=${!!errors[`item-${index}-price`]}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.#editItem(item.id, { price: event.detail.value });
          }}
        ></wt-input>
      </td>
      <td>
        <wt-button
          variant="danger"
          data-test=${`remove-item-${index}`}
          aria-label=${`${t("extras.remove_item")}: ${named}`}
          .disabled=${this.busy}
          @click=${(event: Event) => {
            event.stopPropagation();
            this.#removeItem(item.id);
          }}
          >${t("action.remove")}</wt-button
        >
      </td>
    </tr>`;
  }

  #itemsSection(errors: Record<string, string>) {
    return html`${this.#reorder.liveRegion()}
      <div class="table-wrap" tabindex="0" role="region" aria-label=${t("extras.items")}>
        <table>
          <thead>
            <tr>
              <th scope="col"><span class="visually-hidden">${t("extras.reorder")}</span></th>
              <th scope="col">${t("extras.product")}</th>
              <th scope="col">${t("extras.max_quantity")}</th>
              <th scope="col">${t("extras.preselected")}</th>
              <th scope="col">${t("extras.price")}</th>
              <th scope="col"><span class="visually-hidden">${t("action.remove")}</span></th>
            </tr>
          </thead>
          <tbody>
            ${repeat(
              this.items,
              (item) => item.id,
              (item, index) => this.#itemRow(item, index, errors),
            )}
          </tbody>
        </table>
      </div>
      ${errors.items ? html`<p class="error" data-test="items-error">${errors.items}</p>` : nothing}
      <div class="item-actions">
        <wt-combobox
          class="picker"
          name="add-product"
          data-test="add-product"
          label=${t("extras.product")}
          placeholder=${t("extras.choose_product")}
          searchPlaceholder=${t("extras.search_product")}
          noResultsLabel=${t("extras.no_products_found")}
          .disabled=${this.busy}
          .options=${this.products.map((product) => ({ value: product.id, label: product.name }))}
          .value=${this.pick}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.pick = event.detail.value;
          }}
        ></wt-combobox>
        <wt-button
          variant="secondary"
          data-test="add-item"
          .disabled=${this.busy}
          @click=${(event: Event) => {
            event.stopPropagation();
            this.#addItem();
          }}
          >${t("extras.add_item")}</wt-button
        >
      </div>`;
  }

  override render() {
    const errors = this.#errors();
    return html`<wt-modal
      .open=${this.open}
      heading=${t(this.value ? "extras.edit" : "extras.create")}
      @keydown=${(event: KeyboardEvent) => {
        if (this.busy && event.key === "Escape") event.preventDefault();
      }}
      @wt-close=${(event: Event) => this.#cancel(event)}
    >
      <div
        ?inert=${this.busy}
        class="fields"
        @keydown=${(event: KeyboardEvent) =>
          submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]'))}
      >
        <wt-form-error-summary
          heading=${t("form.error_heading")}
          .errors=${Object.values(errors)}
        ></wt-form-error-summary>
        <div class="names">
          <wt-input
            name="name"
            label=${t("extras.name")}
            required
            .disabled=${this.busy}
            .value=${this.name}
            .error=${errors.name ?? ""}
            .invalid=${!!errors.name}
            @wt-change=${(event: CustomEvent<{ value: string }>) => {
              event.stopPropagation();
              this.#edit(() => (this.name = event.detail.value));
            }}
          ></wt-input>
          ${optionalTextFields(
            this.#fields(errors),
            "customer-name",
            t("extras.customer_name"),
            this.customerName,
            (customerName) => this.#edit(() => (this.customerName = customerName)),
            this.name,
          )}
          <wt-input
            name="kitchen-name"
            label=${t("extras.kitchen_name")}
            placeholder=${this.name}
            .disabled=${this.busy}
            .value=${this.kitchenName}
            .error=${errors["kitchen-name"] ?? ""}
            .invalid=${!!errors["kitchen-name"]}
            @wt-change=${(event: CustomEvent<{ value: string }>) => {
              event.stopPropagation();
              this.#edit(() => (this.kitchenName = event.detail.value));
            }}
          ></wt-input>
          <wt-input
            name="min-picks"
            label=${t("extras.min_picks")}
            .disabled=${this.busy}
            .value=${this.minPicks}
            .error=${errors["min-picks"] ?? ""}
            .invalid=${!!errors["min-picks"]}
            @wt-change=${(event: CustomEvent<{ value: string }>) => {
              event.stopPropagation();
              this.#edit(() => (this.minPicks = event.detail.value));
            }}
          ></wt-input>
          <wt-input
            name="max-picks"
            label=${t("extras.max_picks")}
            .disabled=${this.busy}
            .value=${this.maxPicks}
            .error=${errors["max-picks"] ?? ""}
            .invalid=${!!errors["max-picks"]}
            @wt-change=${(event: CustomEvent<{ value: string }>) => {
              event.stopPropagation();
              this.#edit(() => (this.maxPicks = event.detail.value));
            }}
          ></wt-input>
          <wt-switch
            name="active"
            data-test="active"
            label=${t("extras.active")}
            .checked=${this.active}
            .disabled=${this.busy}
            @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
              event.stopPropagation();
              this.#edit(() => (this.active = event.detail.checked));
            }}
          ></wt-switch>
        </div>
        ${this.#itemsSection(errors)}
      </div>
      <wt-form-actions slot="footer"
        ><wt-button
          slot="cancel"
          data-test="cancel"
          variant="secondary"
          .disabled=${this.busy}
          @click=${(event: Event) => this.#cancel(event)}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          data-test="save"
          variant="primary"
          .disabled=${this.busy}
          @click=${(event: Event) => this.#submit(event)}
          >${t("action.save")}</wt-button
        ></wt-form-actions
      >
    </wt-modal>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-extra-list-form": ExtraListForm;
  }
}
