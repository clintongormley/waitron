import { sameValue } from "./product-editor-model.js";
import {
  draftScopeFor,
  saveActionState,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
} from "@waitron/ui";
import { ReorderController, reorder, type ReorderModel } from "@waitron/ui";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { baseStyles, focusFirstInvalid, submitOnEnter } from "@waitron/ui";
import { isProductPrice } from "@waitron/catalogue/src/modifier-limits.js";
import { priceForExtraPortion } from "@waitron/catalogue/src/extra-contract.js";
import { assertQuantityPrecision, EACH_UNIT_ID } from "@waitron/catalogue/src/unit-validation.js";
import { decimal, toScale, resolveContentText, type ContentLanguages } from "@waitron/shared";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-disclosure.js";
import "@waitron/ui/src/components/wt-icon.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-number-stepper.js";
import "@waitron/ui/src/components/wt-price-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import {
  effectiveNamesLine,
  optionalTextFields,
  textField,
  translations,
  wholeWithin,
  type FieldContext,
} from "./form-fields.js";
import type { ExtraList, ExtraListInput, Product } from "../api/client.js";
import { currentLocale, t } from "../i18n/t.js";

const decreaseLabel = (label: string) => t("action.decrease").replace("{label}", label);
const increaseLabel = (label: string) => t("action.increase").replace("{label}", label);

interface ExtraDraft {
  value: ExtraListInput;
  invalid: Record<string, string>;
}

interface DraftItem {
  id: string;
  productId: string;
  maxQuantity: string;
  preselected: boolean;
  price: string;
  portion?: string;
}

/**
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
        container-type: inline-size;
      }
      .names {
        display: grid;
        gap: var(--wt-space-3);
      }
      .picks {
        min-inline-size: 0;
        margin: 0;
        padding: 0;
        border: 0;
      }
      .group-label {
        padding: 0;
        margin-block-end: var(--wt-space-3);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
        text-transform: uppercase;
      }
      .picks-row {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, max-content));
        gap: var(--wt-space-3);
        align-items: start;
      }
      @container (max-width: 30rem) {
        .picks-row {
          grid-template-columns: minmax(0, 1fr);
        }
        /* The unit moves under the amount as text, breaking inside a word where it must. */
        td wt-price-input::part(unit) {
          flex-basis: 100%;
          min-width: 0;
          overflow-wrap: anywhere;
        }
      }
      .required,
      .error {
        color: var(--wt-color-danger);
      }
      .required {
        margin-inline-start: var(--wt-space-1);
      }
      .error {
        margin: var(--wt-space-1) 0 0;
        font-size: var(--wt-font-size-sm);
      }
      .portion-warning {
        color: var(--wt-color-warning);
        font-size: var(--wt-font-size-sm);
        margin: var(--wt-space-1) 0;
      }
      .item-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: end;
        gap: var(--wt-space-2);
      }
      .picker {
        flex: 1 1 var(--wt-cell-name-max-width);
      }
      table {
        table-layout: fixed;
        min-width: calc(
          var(--wt-cell-name-max-width) + var(--wt-stepper-field-width) +
            var(--wt-price-field-width) * 2 + var(--wt-tap-min) * 5 + var(--wt-space-5) +
            var(--wt-space-4) * 2
        );
      }
      col:first-child,
      col:last-child {
        width: var(--wt-tap-min);
      }
      col:nth-child(3) {
        width: calc(var(--wt-stepper-field-width) + var(--wt-tap-min) + var(--wt-space-4));
      }
      col:nth-child(4) {
        width: var(--wt-tap-min);
      }
      col:nth-child(5) {
        width: calc(var(--wt-price-field-width) + var(--wt-space-4));
      }
      col:nth-child(6) {
        width: calc(var(--wt-price-field-width) + var(--wt-tap-min) + var(--wt-space-5));
      }
      td:nth-child(2) {
        overflow-wrap: anywhere;
      }
      .quantity-heading {
        display: inline-block;
        max-width: var(--wt-stepper-field-width);
        position: relative;
        inset-inline-end: calc(var(--wt-space-6) + var(--wt-space-1));
      }
      /* The grip and the bin are each a tap-target-wide button that already centres its icon. */
      th:first-child,
      td:first-child,
      td:last-child {
        padding-inline: 0;
      }
      /* The last heading spans Price and Remove, so only the Remove cell takes its own width. */
      th:first-child,
      td:first-child,
      th:nth-child(4),
      td:last-child {
        width: 1%;
        white-space: nowrap;
      }
      td:nth-child(4) {
        width: 1%;
      }
      td wt-input[name$="-portion"] {
        display: block;
      }
      th:nth-child(4) {
        position: relative;
      }
      .preselected-heading {
        position: absolute;
        inset-inline-end: var(--wt-space-1);
        inset-block-start: var(--wt-space-2);
        white-space: nowrap;
      }
    `,
  ];

  @property({ type: Boolean }) open = false;
  @property({ attribute: false }) draftParent?: object;
  @property({ type: Boolean }) busy = false;
  @property({ attribute: false }) languages: ContentLanguages = {
    defaultLanguage: "en",
    languages: ["en"],
  };
  @property({ attribute: false }) value: ExtraList | null = null;
  @property({ attribute: false }) products: Product[] = [];
  /** The server's refusal, keyed by the field path `parseExtraListInput` reports. */
  @property({ attribute: false }) fieldErrors: Record<string, string> = {};
  @state() private name = "";
  @state() private customerName: Record<string, string> = {};
  @state() private kitchenName = "";
  @state() private minPicks = "";
  @state() private maxPicks = "";
  @state() private active = true;
  @state() private items: DraftItem[] = [];
  @state() private addedMessage = "";
  @state() private attempted = false;
  /** `serverErrors` keys the operator has since changed the field of, or submitted past. */
  @state() private dismissed = new Set<string>();
  /** `fieldErrors` with each path turned into one of this form's own keys. An item's message is
   * held against the item's ID rather than the position the server named, so moving an item
   * carries its message with it. */
  @state() private serverErrors: Record<string, string> = {};

  #scope?: DraftScope<ExtraDraft>;
  #leave?: LeaveCoordinator;
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.busy &&
    (await this.#leave!.request({ scopes: [this], reason, proceed() {} })) === "proceeded";

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    super.disconnectedCallback();
  }

  #registerDraft(): void {
    if (!this.open) {
      this.#scope?.dispose();
      this.#scope = undefined;
      this.#leave = undefined;
    } else if (this.isConnected && !this.#scope) {
      const { coordinator, scope } = draftScopeFor<ExtraDraft>(this, {
        id: this,
        parent: this.draftParent,
        current: () => this.#comparisonValue(),
        snapshot: (value) => structuredClone(value),
        equal: (a, b) => sameValue(this.#canonicalDraft(a), this.#canonicalDraft(b)),
        restore: (value) => this.#restoreDraft(value),
      });
      this.#leave = coordinator;
      this.#scope = scope;
    }
  }

  readonly #reorder = new ReorderController(
    this,
    {
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
    } satisfies ReorderModel,
    { announce: () => t("action.reordered") },
  );

  protected override willUpdate(changes: PropertyValues<this>): void {
    if (changes.has("products"))
      this.#productById = new Map(this.products.map((product) => [product.id, product]));
    if (
      (changes.has("open") && this.open) ||
      (changes.has("value") &&
        this.value?.id !== (changes.get("value") as ExtraList | null | undefined)?.id)
    ) {
      this.#scope?.dispose();
      this.#scope = undefined;
      this.#reseed();
    }
    // After the reseed, so an item path resolves against the items now on screen.
    if (changes.has("fieldErrors")) {
      this.serverErrors = this.#mapFieldErrors();
      this.dismissed = new Set();
    }
    this.#registerDraft();
  }

  protected override updated(changes: PropertyValues<this>): void {
    if (changes.has("fieldErrors") && this.#messages().fieldKeys.size > 0)
      void this.#focusFirstInvalid();
  }

  /** A message under the items table or a row's product has no control of its own, so focus goes to
   * the table when no control is invalid. */
  async #focusFirstInvalid(): Promise<void> {
    await this.updateComplete;
    if ((await focusFirstInvalid(this.shadowRoot!)) === null)
      this.shadowRoot!.querySelector<HTMLElement>(".table-wrap")?.focus();
  }

  #reseed(): void {
    const value = this.value;
    this.name = value?.name ?? "";
    this.customerName = { ...value?.customerName };
    this.kitchenName = value?.kitchenName ?? "";
    // A minimum of 0 is no minimum, which the box shows empty.
    this.minPicks = value?.minPicks ? String(value.minPicks) : "";
    this.maxPicks = value?.maxPicks == null ? "" : String(value.maxPicks);
    this.active = value?.active ?? true;
    this.items = (value?.items ?? []).map((item) => ({
      id: item.id,
      productId: item.productId,
      maxQuantity: item.maxQuantity === null ? "" : String(item.maxQuantity),
      preselected: item.preselected,
      price: item.price ?? "",
      ...(item.portion === undefined ? {} : { portion: item.portion }),
    }));
    this.addedMessage = "";
    this.attempted = false;
    this.dismissed = new Set();
  }

  #productById = new Map<string, Product>();

  #productName(productId: string): string {
    return this.#productById.get(productId)?.name ?? t("extras.unknown_product");
  }

  /** The server refuses a list naming a product with an Active variant, Available or not
   * (`assertNoParentsWithVariants`, packages/catalogue/src/extras.ts). */
  #hasActiveVariant(productId: string): boolean {
    return this.#productById.get(productId)?.variants.some((variant) => variant.active) ?? false;
  }

  #inheritedPrice(item: DraftItem): string {
    const unitPrice = this.#productById.get(item.productId)?.unitPrice;
    if (this.#portionKind(item.productId) === "each")
      return priceForExtraPortion({ price: null }, unitPrice) ?? "";
    if (item.portion === "") return "";
    if (item.portion) {
      try {
        assertQuantityPrecision(item.portion, 3, { positive: true });
      } catch {
        return "";
      }
    }
    return (
      priceForExtraPortion(
        { price: null, ...(item.portion ? { portion: item.portion } : {}) },
        unitPrice,
      ) ?? ""
    );
  }

  /** Each is told from a measure by the unit's identity alone: a millilitre or a gram has no
   * decimals either, and its portion still sets the price. A stored unit seeded as `each`, which the
   * server's `isEachUnit` also counts as Each, reads here as a measure; setup seeds none. Null for a
   * product this form was given no row for. */
  #portionKind(productId: string): "each" | "measured" | null {
    const product = this.#productById.get(productId);
    if (product === undefined) return null;
    return !product.unit || product.unit.id === EACH_UNIT_ID ? "each" : "measured";
  }

  /** A unit-sold item is always one unit, whatever portion an earlier unit left saved on it. */
  #asksPortion(item: DraftItem): boolean {
    const kind = this.#portionKind(item.productId);
    return kind === "measured" || (kind === null && item.portion !== undefined);
  }

  #savedPortionOverPrecision(item: DraftItem): boolean {
    if (
      !this.#asksPortion(item) ||
      item.portion === undefined ||
      item.portion !== this.value?.items.find((saved) => saved.id === item.id)?.portion
    )
      return false;
    try {
      assertQuantityPrecision(
        item.portion,
        this.#productById.get(item.productId)?.unit?.precision ?? 0,
        { positive: true },
      );
      return false;
    } catch {
      return true;
    }
  }

  /** The abbreviation, else the name, and Each for a product with no unit — the word the product
   * editor's price button shows for one. A product this form was given no row for claims no
   * unit. */
  #unitLabel(productId: string): string {
    const product = this.#productById.get(productId);
    if (!product) return "";
    const unit = product.unit;
    if (!unit) return t("editor.unit_each");
    const language = this.#primaryLanguage();
    return (
      resolveContentText(unit.abbreviation, language, language) ||
      resolveContentText(unit.name, language, language)
    );
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
   * the items table with the rest of the list-level refusals. `_form` names no field, and is shown
   * above Save alone. */
  #formKey(field: string): string {
    if (field === "_form") return field;
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
    if (field === "portion") return "portion";
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

  /**
   * Every message on screen, keyed as the form shows it, and the keys among them that are a field's.
   * A refusal held for an item the operator has since removed is shown under the items table but
   * marks no field: removing the item was the change to it. `active`, `_form`
   * and an item's preselection (`wt-switch` draws no error text) name nothing this form shows a
   * message under.
   */
  #messages(): { errors: Record<string, string>; fieldKeys: Set<string> } {
    const errors: Record<string, string> = {};
    const fieldKeys = new Set<string>();
    const shown = new Set([
      "name",
      "kitchen-name",
      "min-picks",
      "max-picks",
      "items",
      ...this.languages.languages.map((locale) => `customer-name-${locale}`),
    ]);
    const rowShown = new Set(["product", "max-quantity", "price", "portion"]);
    const removed: string[] = [];
    for (const [key, message] of Object.entries(this.serverErrors)) {
      if (this.dismissed.has(key)) continue;
      const held = /^item:([^:]+):(.+)$/.exec(key);
      if (held === null) {
        errors[key] = message;
        if (shown.has(key)) fieldKeys.add(key);
        continue;
      }
      const index = this.items.findIndex((item) => item.id === held[1]);
      if (index < 0) {
        removed.push(message);
        continue;
      }
      errors[`item-${index}-${held[2]}`] = message;
      if (rowShown.has(held[2]!)) fieldKeys.add(`item-${index}-${held[2]}`);
    }
    if (removed.length > 0 && errors.items === undefined) errors.items = removed.at(-1)!;
    if (this.attempted)
      for (const [key, message] of Object.entries(this.#validate())) {
        errors[key] = message;
        fieldKeys.add(key);
      }
    return { errors, fieldKeys };
  }

  #edit(change: () => void, ...keys: string[]): void {
    change();
    this.#scope?.changed();
    this.dismissed = new Set([...this.dismissed, ...keys]);
  }

  /** A change to the items answers a refusal about them as a whole. */
  #editItems(change: () => void, ...keys: string[]): void {
    this.#edit(change, "items", ...keys);
  }

  /** `cell` is the refusal the change answers; a preselection's is shown above Save alone, and goes
   * only when the list is submitted again. */
  #editItem(id: string, patch: Partial<DraftItem>, cell?: string): void {
    this.#editItems(
      () => {
        this.items = this.items.map((item) => (item.id === id ? { ...item, ...patch } : item));
      },
      ...(cell ? [`item:${id}:${cell}`] : []),
    );
  }

  #addItem(productId: string): void {
    if (this.busy || !productId) return;
    this.#editItems(() => {
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
        ...(this.#portionKind(productId) === "measured" ? { portion: "" } : {}),
      };
      this.items = [...this.items, item];
      this.addedMessage = t("extras.product_added").replace("{name}", this.#productName(productId));
    });
  }

  #removeItem(id: string): void {
    this.#editItems(() => {
      this.items = this.items.filter((item) => item.id !== id);
      this.addedMessage = "";
    });
  }

  /** The items array order IS the saved order, so a move rewrites the array rather than a rank. */
  #move(id: string, to: number): void {
    const from = this.items.findIndex((item) => item.id === id);
    if (from < 0) return;
    this.#editItems(() => {
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

  #validate(): Record<string, string> {
    const validation: Record<string, string> = {};
    if (!this.name.trim()) validation.name = t("extras.name_required");
    // A blank minimum is the contract's own default of 0 (`row.minPicks === undefined ? 0`), which
    // makes the list optional.
    const minPicks = this.#minPicks();
    if (minPicks === null) validation["min-picks"] = t("extras.picks_invalid");
    const capped = this.maxPicks.trim() !== "";
    const maxPicks = this.#maxPicks();
    if (capped && maxPicks === null) validation["max-picks"] = t("extras.picks_invalid");
    else if (maxPicks === 0) validation["max-picks"] = t("extras.max_picks_zero");
    // The cap is what is wrong when the pair cannot both hold, so the message goes there rather
    // than on the minimum — the field `parseExtraListInput` names, and for the reason it states.
    else if (minPicks !== null && maxPicks !== null && maxPicks < minPicks)
      validation["max-picks"] = t("extras.max_picks_too_low");

    const offered = new Set<string>();
    this.items.forEach((item, index) => {
      if (item.maxQuantity.trim() !== "" && wholeWithin(item.maxQuantity.trim(), 1) === null)
        validation[`item-${index}-max-quantity`] = t("extras.quantity_invalid");
      const price = item.price.trim();
      if (price !== "" && !isProductPrice(price))
        validation[`item-${index}-price`] = t("extras.price_invalid");
      if (this.#asksPortion(item)) {
        if (!item.portion?.trim())
          validation[`item-${index}-portion`] = t("extras.portion_required");
        else if (
          item.portion !== this.value?.items.find((saved) => saved.id === item.id)?.portion
        ) {
          try {
            assertQuantityPrecision(
              item.portion,
              this.#productById.get(item.productId)?.unit?.precision ?? 0,
              { positive: true },
            );
          } catch {
            validation[`item-${index}-portion`] = t("extras.portion_invalid");
          }
        }
      }
      // One offer per product per list: two rows for the same product would give the diner two ways
      // to pick the same thing on different terms, which is why `parseExtraListInput` refuses the
      // second one naming `items.N.productId`.
      if (offered.has(item.productId))
        validation[`item-${index}-product`] = t("extras.duplicate_product");
      else if (this.#hasActiveVariant(item.productId))
        validation[`item-${index}-product`] = t("extras.has_variants_remove");
      offered.add(item.productId);
    });
    // An active list is asked on every order of a dish carrying it and there is nothing to answer
    // it with when it offers no product. An inactive list is never asked, so it may be empty — the
    // same split the server makes.
    if (this.active && this.items.length === 0) validation.items = t("extras.items_required");
    return validation;
  }

  #minPicks(): number | null {
    return wholeWithin(this.minPicks.trim() || "0", 0);
  }

  #maxPicks(): number | null {
    return this.maxPicks.trim() === "" ? null : wholeWithin(this.maxPicks.trim(), 0);
  }

  #value(): ExtraListInput {
    return {
      name: this.name.trim(),
      customerName: translations(this.customerName),
      kitchenName: this.kitchenName.trim() || null,
      minPicks: this.#minPicks()!,
      maxPicks: this.#maxPicks(),
      active: this.active,
      items: this.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        maxQuantity:
          item.maxQuantity.trim() === "" ? null : wholeWithin(item.maxQuantity.trim(), 1)!,
        preselected: item.preselected,
        price: item.price.trim() || null,
        ...(item.portion === undefined || !this.#asksPortion(item)
          ? {}
          : { portion: item.portion.trim() }),
      })),
    };
  }

  #comparisonValue(): ExtraDraft {
    const invalid: Record<string, string> = {};
    if (this.#minPicks() === null) invalid["min-picks"] = this.minPicks;
    if (this.maxPicks.trim() !== "" && this.#maxPicks() === null)
      invalid["max-picks"] = this.maxPicks;
    this.items.forEach((item) => {
      if (item.maxQuantity.trim() !== "" && wholeWithin(item.maxQuantity.trim(), 1) === null)
        invalid[`quantity:${item.id}`] = item.maxQuantity;
    });
    return { value: this.#value(), invalid };
  }

  #canonicalDraft(draft: ExtraDraft): ExtraDraft {
    return {
      ...draft,
      value: {
        ...draft.value,
        items: draft.value.items.map((item) => ({
          ...item,
          price:
            item.price !== null && isProductPrice(item.price)
              ? toScale(decimal(item.price), 2)
              : item.price,
        })),
      },
    };
  }

  #restoreDraft(draft: ExtraDraft): void {
    const { value, invalid } = draft;
    this.name = value.name;
    this.customerName = { ...value.customerName };
    this.kitchenName = value.kitchenName ?? "";
    this.minPicks = invalid["min-picks"] ?? (value.minPicks ? String(value.minPicks) : "");
    this.maxPicks = invalid["max-picks"] ?? (value.maxPicks === null ? "" : String(value.maxPicks));
    this.active = value.active;
    this.items = value.items.map((item) => ({
      ...item,
      id: item.id!,
      maxQuantity:
        invalid[`quantity:${item.id}`] ??
        (item.maxQuantity === null ? "" : String(item.maxQuantity)),
      price: item.price ?? "",
    }));
  }

  commitSaved(submitted: ExtraListInput): void {
    this.#scope?.commit({ value: submitted, invalid: {} });
  }
  closeSaved(submitted: ExtraListInput): void {
    this.commitSaved(submitted);
    this.open = false;
    this.shadowRoot!.querySelector("wt-modal")!.closeAfter("saved");
  }

  #submit(event: Event): void {
    event.stopPropagation();
    if (this.busy) return;
    if (saveActionState(this.#scope).unchanged) return;
    this.attempted = true;
    this.dismissed = new Set(Object.keys(this.serverErrors));
    if (Object.keys(this.#validate()).length) {
      void this.#focusFirstInvalid();
      return;
    }
    this.#emit(event, "wt-submit", { value: this.#value() });
  }

  #cancel(event: Event): void {
    event.stopPropagation();
    if (this.busy || !this.open) return;
    if (this.#leave) void this.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel");
    else this.#reportCancel();
  }

  #reportCancel(): void {
    if (this.busy || !this.open) return;
    this.dispatchEvent(new CustomEvent("wt-cancel", { detail: {}, bubbles: true, composed: true }));
  }

  #fields(errors: Record<string, string>): FieldContext {
    return {
      busy: this.busy,
      locales: this.languages.languages,
      error: (key) => errors[key] ?? "",
    };
  }

  #namesSection(errors: Record<string, string>) {
    const locales = this.languages.languages;
    const hasError = locales.some((locale) => !!errors[`customer-name-${locale}`]);
    return html`<wt-disclosure
      data-test="names-section"
      heading=${t("extras.customer_names")}
      .summaryFields=${effectiveNamesLine(
        locales,
        this.customerName,
        this.languages.defaultLanguage,
        this.name,
      )}
      .hasError=${hasError}
    >
      <div class="names">
        ${optionalTextFields(
          this.#fields(errors),
          "customer-name",
          t("extras.customer_name"),
          this.customerName,
          (customerName) =>
            this.#edit(
              () => (this.customerName = customerName),
              ...locales
                .filter((locale) => customerName[locale] !== this.customerName[locale])
                .map((locale) => `customer-name-${locale}`),
            ),
          this.name,
          this.languages.defaultLanguage,
        )}
      </div>
    </wt-disclosure>`;
  }

  #itemRow(item: DraftItem, index: number, errors: Record<string, string>) {
    const named = this.#productName(item.productId);
    // Shown before any save too: the server would refuse the list for it.
    const productError =
      errors[`item-${index}-product`] ??
      (this.#hasActiveVariant(item.productId) ? t("extras.has_variants_remove") : undefined);
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
        <wt-number-stepper
          name=${`item-${index}-max-quantity`}
          label=${t("extras.max_quantity")}
          hide-label
          placeholder="∞"
          clearable
          .min=${1}
          .decreaseLabel=${decreaseLabel}
          .increaseLabel=${increaseLabel}
          .disabled=${this.busy}
          .value=${item.maxQuantity}
          .error=${errors[`item-${index}-max-quantity`] ?? ""}
          .invalid=${!!errors[`item-${index}-max-quantity`]}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.#editItem(item.id, { maxQuantity: event.detail.value }, "max-quantity");
          }}
        ></wt-number-stepper>
      </td>
      <td>
        <wt-switch
          name=${`item-${index}-preselected`}
          data-test=${`item-${index}-preselected`}
          label=${t("extras.preselected")}
          hide-label
          .checked=${item.preselected}
          .disabled=${this.busy}
          @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
            event.stopPropagation();
            this.#editItem(item.id, { preselected: event.detail.checked });
          }}
        ></wt-switch>
      </td>
      <td data-test=${`item-${index}-portion-cell`}>
        ${
          this.#asksPortion(item)
            ? html`<wt-input
                name=${`item-${index}-portion`}
                decimal-locale=${currentLocale()}
                label=${t("extras.portion")}
                hide-label
                required
                hint=${this.#unitLabel(item.productId)}
                .disabled=${this.busy}
                .value=${item.portion ?? ""}
                .error=${errors[`item-${index}-portion`] ?? ""}
                @wt-change=${(event: CustomEvent<{ value: string }>) => {
                  event.stopPropagation();
                  this.#editItem(item.id, { portion: event.detail.value }, "portion");
                }}
              ></wt-input>`
            : this.#portionKind(item.productId) === "each"
              ? html`<span class="fixed-portion" data-test=${`item-${index}-portion-fixed`}
                  >1</span
                >`
              : nothing
        }
        ${
          this.#savedPortionOverPrecision(item)
            ? html`<p class="portion-warning" data-test=${`item-${index}-portion-warning`}>
                ${t("extras.portion_saved_warning").replace("{amount}", item.portion ?? "")}
              </p>`
            : nothing
        }
      </td>
      <td>
        <wt-price-input
          name=${`item-${index}-price`}
          label=${t("extras.price")}
          hide-label
          fixed-unit
          unit=${this.#unitLabel(item.productId)}
          locale=${currentLocale()}
          placeholder=${this.#inheritedPrice(item)}
          .disabled=${this.busy}
          .value=${item.price}
          .error=${errors[`item-${index}-price`] ?? ""}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.#editItem(item.id, { price: event.detail.value }, "price");
          }}
        ></wt-price-input>
      </td>
      <td>
        <wt-button
          variant="ghost"
          data-test=${`remove-item-${index}`}
          aria-label=${`${t("extras.remove_item")}: ${named}`}
          .disabled=${this.busy}
          @click=${(event: Event) => {
            event.stopPropagation();
            this.#removeItem(item.id);
          }}
          ><wt-icon name="bin"></wt-icon
        ></wt-button>
      </td>
    </tr>`;
  }

  #itemsSection(errors: Record<string, string>) {
    // A list holds each product once (`extra_list_items_list_product_uq`), so one it holds already
    // is not offered again.
    const listed = new Set(this.items.map((item) => item.productId));
    const offered = this.products.filter((product) => product.active && !listed.has(product.id));
    return html`${this.#reorder.liveRegion()}
      <div data-test="added-status" role="status" aria-live="polite" class="visually-hidden">
        ${this.addedMessage}
      </div>
      <div class="table-wrap" tabindex="0" role="region" aria-label=${t("extras.items")}>
        <table>
          <colgroup>
            <col />
            <col />
            <col />
            <col />
            <col />
            <col />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th scope="col"><span class="visually-hidden">${t("extras.reorder")}</span></th>
              <th scope="col">${t("extras.product")}</th>
              <th scope="col">
                <span class="quantity-heading">${t("extras.max_quantity")}</span>
              </th>
              <th scope="col">
                <span class="preselected-heading">${t("extras.preselected")}</span>
              </th>
              <th scope="col">
                ${t("extras.portion")}${
                  this.items.some((item) => this.#asksPortion(item))
                    ? html`<span class="required" aria-hidden="true">*</span>`
                    : nothing
                }
              </th>
              <th scope="col" colspan="2">${t("extras.price")}</th>
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
          noResultsLabel=${
            offered.length === 0 && this.products.length > 0
              ? t("extras.all_products_listed")
              : t("extras.no_products_found")
          }
          .disabled=${this.busy}
          .options=${offered.map((product) => ({
            value: product.id,
            label: product.name,
            ...(this.#hasActiveVariant(product.id)
              ? { disabled: true, description: t("extras.has_variants") }
              : {}),
          }))}
          .value=${""}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.#addItem(event.detail.value);
            (event.currentTarget as HTMLElementTagNameMap["wt-combobox"]).value = "";
          }}
        ></wt-combobox>
      </div>`;
  }

  override render() {
    const { errors, fieldKeys } = this.#messages();
    const fields = this.#fields(errors);
    // The items table shows its own message, even one that marks no field.
    const bottom = [
      ...Object.entries(errors)
        .filter(([key, message]) => message && key !== "items" && !fieldKeys.has(key))
        .map(([, message]) => message),
      ...(fieldKeys.size > 0 ? [t("form.fix_fields")] : []),
    ].join(" ");
    const invalid = this.attempted && Object.keys(this.#validate()).length > 0;
    const saveAction = saveActionState(this.#scope);
    return html`<wt-modal
      size="wide"
      .open=${this.open}
      .beforeClose=${this.#leave ? this.#beforeClose : undefined}
      heading=${t(this.value ? "extras.edit" : "extras.create")}
      @keydown=${(event: KeyboardEvent) => {
        if (this.busy && event.key === "Escape") event.preventDefault();
      }}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.#reportCancel();
      }}
    >
      <div
        ?inert=${this.busy}
        class="fields"
        @keydown=${(event: KeyboardEvent) =>
          submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>('[data-test="save"]'))}
      >
        <div class="names">
          ${textField(
            fields,
            "name",
            t("extras.name"),
            this.name,
            (name) => this.#edit(() => (this.name = name), "name"),
            true,
          )}
          ${textField(
            fields,
            "kitchen-name",
            t("extras.kitchen_name"),
            this.kitchenName,
            (kitchenName) => this.#edit(() => (this.kitchenName = kitchenName), "kitchen-name"),
            false,
            this.name,
          )}
          ${this.#namesSection(errors)}
          <fieldset class="picks" data-test="picks">
            <legend class="group-label">${t("extras.picks_heading")}</legend>
            <div class="picks-row" data-test="picks-row">
              <wt-number-stepper
                name="min-picks"
                label=${t("extras.min_picks")}
                placeholder=${t("extras.picks_none")}
                clearable
                .min=${1}
                .decreaseLabel=${decreaseLabel}
                .increaseLabel=${increaseLabel}
                .disabled=${this.busy}
                .value=${this.minPicks}
                .error=${errors["min-picks"] ?? ""}
                .invalid=${!!errors["min-picks"]}
                @wt-change=${(event: CustomEvent<{ value: string }>) => {
                  event.stopPropagation();
                  this.#edit(() => (this.minPicks = event.detail.value), "min-picks");
                }}
              ></wt-number-stepper>
              <wt-number-stepper
                name="max-picks"
                label=${t("extras.max_picks")}
                placeholder=${t("extras.picks_none")}
                clearable
                .min=${1}
                .decreaseLabel=${decreaseLabel}
                .increaseLabel=${increaseLabel}
                .disabled=${this.busy}
                .value=${this.maxPicks}
                .error=${errors["max-picks"] ?? ""}
                .invalid=${!!errors["max-picks"]}
                @wt-change=${(event: CustomEvent<{ value: string }>) => {
                  event.stopPropagation();
                  this.#edit(() => (this.maxPicks = event.detail.value), "max-picks");
                }}
              ></wt-number-stepper>
            </div>
          </fieldset>
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
      <wt-form-actions slot="footer" .error=${bottom}
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
          variant=${saveAction.variant}
          .disabled=${saveAction.unchanged || this.busy || invalid}
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
