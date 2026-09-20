import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { baseStyles, submitOnEnter } from "@waitron/ui";
import { MAX_MODIFIER_INTEGER, isProductPrice } from "@waitron/catalogue/src/modifier-limits.js";
import type { ContentLanguages } from "@waitron/shared";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import { nonBlankNames } from "./form-fields.js";
import { reorder } from "./reorder.js";
import { ReorderController, type ReorderModel } from "./reorder-table.js";
import type { ExtraList, ExtraListInput, Product } from "../api/client.js";
import { t } from "../i18n/t.js";

/** One offered product while it is being edited. Every number is held as TEXT, so a blank
 * `maxPicks` stays "uncapped" and a blank `price` stays "inherit the product's own" rather than
 * becoming a zero on the way in. Every item has an `id` from the moment it is added — see
 * {@link ExtraListForm}. */
interface DraftItem {
  id: string;
  productId: string;
  maxQuantity: string;
  preselected: boolean;
  price: string;
}

/** A translated map with its blank languages dropped, or null when nothing was entered — the shape
 * `parseExtraListInput` reads a customer name as (packages/catalogue/src/extra-contract.ts). */
function translations(value: Record<string, string>): Record<string, string> | null {
  const named = nonBlankNames(value);
  return Object.keys(named).length ? named : null;
}

/**
 * A whole number written in plain digits, from `minimum` up to the largest an `integer` column
 * holds, or null when the text is not one. The ceiling is the contract's own
 * (`MAX_MODIFIER_INTEGER`, packages/catalogue/src/modifier-limits.ts): a larger value passes every
 * other check and reaches PostgreSQL as `22003`, which carries no field to put a message beside.
 */
function whole(text: string, minimum: number): number | null {
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return value >= minimum && value <= MAX_MODIFIER_INTEGER ? value : null;
}

/**
 * Creates and edits ONE extras list: its three names, how many picks it asks for, whether it is
 * offered, and the ordered products it offers — each with a per-dish quantity cap, a preselect
 * switch and a price that overrides the product's own.
 *
 * Writes belong to the host, which passes the server's per-field refusals back through
 * `fieldErrors`; this form owns the draft and its own refusals. Every refusal answered here is one
 * `parseExtraListInput` also refuses (packages/catalogue/src/extra-contract.ts), so the two cannot
 * drift into disagreeing about what is savable.
 *
 * A price left blank means "charge the product's own `unitPrice`", and the field shows that price
 * as its hint rather than storing it — the inheritance-hint pattern
 * (docs/superpowers/specs/2026-09-18-one-product-model-design.md §9.1). A blank is emitted as
 * `null`, which is what keeps "inherits" and "set to the same number" different rows.
 */
@customElement("dashboard-extra-list-form")
export class ExtraListForm extends LitElement {
  static override styles = [
    baseStyles,
    ReorderController.styles,
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
      /* The items table is the one element allowed to be wider than the modal; its own scroller
         keeps the dialog from scrolling sideways at phone width. It is focusable so a keyboard can
         reach the scroll, which with no items yet is the only way to: the six-column header
         overflows on its own and there is no row input to tab into. Same shape as
         packages/ui/src/components/wt-data-table.ts:753. */
      .items-wrap {
        overflow-x: auto;
      }
      .items-wrap:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th,
      td {
        padding: var(--wt-space-2) var(--wt-space-1);
        text-align: start;
        vertical-align: top;
        border-bottom: 1px solid var(--wt-color-border);
      }
      td.handle-cell {
        vertical-align: middle;
      }
      .item-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: end;
        gap: var(--wt-space-2);
      }
      .picker {
        display: grid;
        gap: var(--wt-space-1);
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }
      select {
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
      }
      .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
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
  /** The products a row can be about. The screen supplies them; this form neither loads nor filters
   * them — a product already on the list stays in the picker, because hiding it would make a
   * manager's search for it come back empty with no reason given, where offering it again produces
   * the duplicate refusal below, which says what is wrong. */
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

  /** The product's STAFF name — the dashboard surface's name of the three (products.md). A list
   * can outlive the products the screen handed over, so a row with no product to read names what
   * is missing rather than rendering an empty cell. */
  #productName(productId: string): string {
    return (
      this.products.find((product) => product.id === productId)?.name ?? t("extras.unknown_product")
    );
  }

  /** The price the item falls back to, shown as the price field's hint. Blank when there is no
   * product row to read one from. */
  #inheritedPrice(productId: string): string {
    return this.products.find((product) => product.id === productId)?.unitPrice ?? "";
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

  /** One of `parseExtraListInput`'s field paths as this form's own key. A path naming the list as
   * a whole or an item's id has no input of its own, so it is shown under the items table with the
   * rest of the list-level refusals. An unrecognised path is kept as it came, so it still reaches
   * the summary rather than disappearing. */
  #formKey(field: string): string {
    const item = /^items\.(\d+)(?:\.(.+))?$/.exec(field);
    if (item) {
      const id = this.items[Number(item[1])]?.id;
      const key = this.#itemKey(item[2] ?? "");
      return id === undefined || key === null ? "items" : `item:${id}:${key}`;
    }
    return this.#listKey(field) ?? "items";
  }

  /** The cell key for one of an item's fields, or null when the path names no cell. */
  #itemKey(field: string): string | null {
    if (field === "productId") return "product";
    if (field === "maxQuantity") return "max-quantity";
    if (field === "preselected") return "preselected";
    if (field === "price") return "price";
    return null;
  }

  /** The input key for one of the list's own fields, or null when the path names no input. */
  #listKey(field: string): string | null {
    if (field === "name") return "name";
    if (field === "customerName") return `customer-name-${this.#primaryLanguage()}`;
    if (field === "kitchenName") return "kitchen-name";
    if (field === "minPicks") return "min-picks";
    if (field === "maxPicks") return "max-picks";
    if (field === "active") return "active";
    return null;
  }

  /** Every message on screen, keyed by input name: the server's, then this form's own on top. An
   * item's message is placed by the item's CURRENT position, so it stays on its own row. */
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

  /** Every draft edit goes through here: a change invalidates what the last Save complained about,
   * and the messages are recomputed by the next Save. */
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
      // the body carried an id for it — and before the first save the id is already what keys the
      // row's reorder handle and the server message held against it.
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
    const minPicks = whole(this.minPicks.trim() || "0", 0);
    if (minPicks === null) validation["min-picks"] = t("extras.picks_invalid");
    const capped = this.maxPicks.trim() !== "";
    const maxPicks = capped ? whole(this.maxPicks.trim(), 0) : null;
    if (capped && maxPicks === null) validation["max-picks"] = t("extras.picks_invalid");
    // The cap is what is wrong when the pair cannot both hold, so the message goes there rather
    // than on the minimum — the field `parseExtraListInput` names, and for the reason it states.
    else if (minPicks !== null && maxPicks !== null && maxPicks < minPicks)
      validation["max-picks"] = t("extras.max_picks_too_low");

    const offered = new Set<string>();
    const items = this.items.map((item, index) => {
      const maxQuantity = whole(item.maxQuantity.trim(), 1);
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

  /** One optional translated name, shown with the staff name as its placeholder: blank means it
   * falls back to that name, which is the inheritance hint the spec asks every fallback field to
   * carry (2026-09-18-one-product-model-design.md §9.1). */
  #translatedField(
    key: string,
    label: string,
    value: Record<string, string>,
    errors: Record<string, string>,
    fallback: string,
    change: (value: Record<string, string>) => void,
  ) {
    return this.languages.languages.map(
      (locale) =>
        html`<wt-input
          name=${`${key}-${locale}`}
          label=${`${label} (${locale})`}
          placeholder=${fallback}
          .disabled=${this.busy}
          .value=${value[locale] ?? ""}
          .error=${errors[`${key}-${locale}`] ?? ""}
          .invalid=${!!errors[`${key}-${locale}`]}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            change({ ...value, [locale]: event.detail.value });
          }}
        ></wt-input>`,
    );
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
      <div class="items-wrap" tabindex="0" role="region" aria-label=${t("extras.items")}>
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
        <label class="picker"
          >${t("extras.choose_product")}
          <select
            name="add-product"
            data-test="add-product"
            ?disabled=${this.busy}
            @change=${(event: Event) => {
              this.pick = (event.target as HTMLSelectElement).value;
            }}
          >
            <option value="" .selected=${this.pick === ""}>${t("extras.choose_product")}</option>
            ${this.products.map(
              (product) =>
                html`<option value=${product.id} .selected=${product.id === this.pick}>
                  ${product.name}
                </option>`,
            )}
          </select>
        </label>
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
          ${this.#translatedField(
            "customer-name",
            t("extras.customer_name"),
            this.customerName,
            errors,
            this.name,
            (customerName) => this.#edit(() => (this.customerName = customerName)),
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
