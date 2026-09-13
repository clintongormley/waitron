import { ContentLanguageController } from "@waitron/ui";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { formatMoney } from "../i18n/format.js";
import { t } from "../i18n/t.js";
import { selectStyles } from "../select-styles.js";
import { lineGross } from "../state/order-line.js";
import { descriptionFor } from "./dish-format.js";
import { productName } from "./product-name.js";
import { resolveSnapshotText } from "@waitron/shared";
import { lineExtrasEditorStyles, renderLineExtrasEditor } from "./line-extras-editor.js";
import type { OrderLine, SelectedLineOption } from "../state/working-order.js";
import type {
  Doneness,
  TillOptionGroup,
  TillOptionItem,
  TillProduct,
  Modifier,
  ModifierSelection,
  ModifierSnapshot,
} from "../api/client.js";

export interface ModifierConfirmDetail {
  product: TillProduct;
  options: SelectedLineOption[];
  modifierSelections?: ModifierSelection[];
  modifierSnapshots?: ModifierSnapshot[];
  note?: string;
  doneness?: Doneness;
}

@customElement("till-modifier-picker")
export class TillModifierPicker extends LitElement {
  constructor() {
    super();
    new ContentLanguageController(this);
  }

  static override styles = [
    baseStyles,
    selectStyles,
    lineExtrasEditorStyles,
    css`
      textarea {
        width: 100%;
        box-sizing: border-box;
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2);
        color: var(--wt-color-text);
        background: var(--wt-color-surface);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        font: inherit;
      }
      .group {
        margin: 0 0 var(--wt-space-4);
      }

      .group-name {
        margin: 0 0 var(--wt-space-2);
        font-weight: var(--wt-font-weight-bold);
      }

      .option {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-1) 0;
        cursor: pointer;
      }

      .option input:disabled {
        cursor: not-allowed;
      }

      /* A stepper row is a plain container, not a single-control label, so it is not pointer-cued. */
      .stepper-option {
        cursor: default;
      }

      .option-name {
        flex: 1;
      }

      .option-delta {
        color: var(--wt-color-text-muted);
        font-variant-numeric: tabular-nums;
      }

      .stepper {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-2);
      }

      .stepper-count {
        min-width: var(--wt-space-5);
        text-align: center;
        font-variant-numeric: tabular-nums;
        font-weight: var(--wt-font-weight-bold);
      }

      .running {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--wt-space-3);
        padding-top: var(--wt-space-3);
        border-top: 1px solid var(--wt-color-border);
      }

      .running-label {
        color: var(--wt-color-text-muted);
        font-weight: var(--wt-font-weight-bold);
      }

      .running-amount {
        font-size: var(--wt-font-size-lg);
        font-weight: var(--wt-font-weight-bold);
        font-variant-numeric: tabular-nums;
      }
    `,
  ];

  @property({ attribute: false }) product!: TillProduct;

  @property() quantity = "1";
  @property({ attribute: false }) initialSelections?: ModifierSelection[];
  @state() private answers: Record<string, string | boolean> = {};
  #seeded = false;
  #choiceOwners = new Map<string, string>();

  override willUpdate(): void {
    // Defaults apply once, and never over an explicit reopened selection.
    if (this.#seeded || !this.product) return;
    this.#seeded = true;
    for (const modifier of this.product.modifiers ?? []) {
      if (modifier.type === "extras")
        for (const choice of modifier.choices) this.#choiceOwners.set(choice.id, modifier.id);
    }
    if (this.initialSelections !== undefined) {
      for (const selection of this.initialSelections) {
        if (selection.type === "extras")
          for (const choice of selection.choices)
            this.quantities[choice.choiceId] = choice.quantity;
        else if (selection.type === "text") this.answers[selection.modifierId] = selection.text;
        else if (selection.type === "options")
          this.answers[selection.modifierId] = selection.choiceId;
        else this.answers[selection.modifierId] = selection.value;
      }
      return;
    }
    for (const modifier of this.product.modifiers ?? []) {
      if (!modifier.available) continue;
      if (modifier.type === "yes-no") this.answers[modifier.id] = modifier.defaultValue;
      if (
        modifier.type === "options" &&
        modifier.defaultChoiceId !== null &&
        modifier.choices.some(
          (choice) => choice.id === modifier.defaultChoiceId && choice.available,
        )
      )
        this.answers[modifier.id] = modifier.defaultChoiceId;
      if (modifier.type === "extras")
        for (const choice of modifier.choices) {
          if (choice.available && choice.defaultQuantity > 0)
            this.quantities[choice.id] = choice.defaultQuantity;
        }
    }
  }

  get #modifiers(): Modifier[] {
    return (this.product.modifiers ?? []).filter((modifier) => modifier.available);
  }

  @state() private quantities: Record<string, number> = {};

  @state() private note = "";

  @state() private doneness: Doneness | "" = "";

  @state() private variantId = "";

  get #variants() {
    return (this.product.variants ?? []).filter((variant) => variant.available);
  }

  get #selectedProduct(): TillProduct {
    const variant = this.#variants.find((candidate) => candidate.id === this.variantId);
    if (variant === undefined) return this.product;
    const productFallback = Object.keys(this.product.descriptions)[0] ?? "en";
    const variantFallback = Object.keys(variant.name)[0] ?? productFallback;
    const descriptions = Object.fromEntries(
      [...new Set([...Object.keys(this.product.descriptions), ...Object.keys(variant.name)])].map(
        (locale) => [
          locale,
          `${resolveSnapshotText(this.product.descriptions, locale, productFallback)} · ${resolveSnapshotText(variant.name, locale, variantFallback)}`,
        ],
      ),
    );
    return {
      ...this.product,
      descriptions,
      unitPrice: variant.unitPrice,
      variantId: variant.id,
      variantName: variant.name,
    };
  }

  // Available required modifiers keep their constraint even when every choice is unavailable.
  get #renderableGroups(): TillOptionGroup[] {
    if (this.product.modifiers !== undefined)
      return this.#modifiers.flatMap((modifier) =>
        modifier.type === "extras"
          ? [
              {
                id: modifier.id,
                name: modifier.name,
                required: modifier.required,
                minSelect: modifier.required ? 1 : 0,
                maxSelect: modifier.maxTotalQuantity ?? Infinity,
                items: modifier.choices
                  .filter((choice) => choice.available)
                  .map((choice) => ({
                    ...choice,
                    vatClass: choice.vatClass ?? null,
                    addAllergens: choice.addAllergens ?? null,
                    removeAllergens: choice.removeAllergens ?? null,
                    addOrigins: choice.addOrigins ?? null,
                    removeOrigins: choice.removeOrigins ?? null,
                  })),
              },
            ]
          : [],
      );
    return (this.product.optionGroups ?? []).filter((group) => group.items.length > 0);
  }

  #minFor(group: TillOptionGroup): number {
    return group.required ? Math.max(group.minSelect, 1) : group.minSelect;
  }

  #groupQuantity(group: TillOptionGroup): number {
    return group.items.reduce((sum, item) => sum + (this.quantities[item.id] ?? 0), 0);
  }

  #hasStepper(group: TillOptionGroup, item: TillOptionItem): boolean {
    return (this.product.modifiers !== undefined || group.maxSelect > 1) && item.maxQuantity > 1;
  }

  #satisfied(group: TillOptionGroup): boolean {
    return this.#groupQuantity(group) >= this.#minFor(group);
  }

  #staleExtra(modifier: Extract<Modifier, { type: "extras" }>): boolean {
    return Object.entries(this.quantities).some(
      ([id, quantity]) =>
        quantity > 0 &&
        this.#choiceOwners.get(id) === modifier.id &&
        !modifier.choices.some((choice) => choice.id === id && choice.available),
    );
  }

  get #allSatisfied(): boolean {
    return (
      (this.#variants.length === 0 || this.variantId !== "") &&
      this.#renderableGroups.every(
        (group) => this.#satisfied(group) && this.#groupQuantity(group) <= group.maxSelect,
      ) &&
      this.#modifiers.every((modifier) => {
        if (modifier.type === "text") return String(this.answers[modifier.id] ?? "").length <= 500;
        if (modifier.type === "options")
          return modifier.choices.some(
            (choice) => choice.available && choice.id === this.answers[modifier.id],
          );
        if (modifier.type === "extras")
          return (
            !this.#staleExtra(modifier) &&
            modifier.choices.every((choice) => {
              const quantity = this.quantities[choice.id] ?? 0;
              return (
                Number.isInteger(quantity) &&
                quantity >= 0 &&
                quantity <= choice.maxQuantity &&
                (quantity === 0 || choice.available)
              );
            })
          );
        return typeof this.answers[modifier.id] === "boolean";
      })
    );
  }

  #selectedOptions(): SelectedLineOption[] {
    const options: SelectedLineOption[] = [];
    for (const group of this.#renderableGroups) {
      for (const item of group.items) {
        const quantity = this.quantities[item.id] ?? 0;
        if (quantity >= 1) {
          options.push({
            optionGroupItemId: item.id,
            name: { ...item.name },
            priceDelta: item.priceDelta,
            ...(quantity > 1 ? { quantity } : {}),
          });
        }
      }
    }
    return options;
  }

  get #runningPrice(): string {
    const previewLine: OrderLine = {
      product: this.#selectedProduct,
      quantity: this.quantity,
      options: this.#selectedOptions(),
    };
    return formatMoney(lineGross(previewLine));
  }

  #setQuantity(itemId: string, quantity: number): void {
    const next = { ...this.quantities };
    if (quantity >= 1) {
      next[itemId] = quantity;
    } else {
      delete next[itemId];
    }
    this.quantities = next;
  }

  #chooseRadio(group: TillOptionGroup, itemId: string): void {
    const next = { ...this.quantities };
    for (const item of group.items) delete next[item.id];
    next[itemId] = 1;
    this.quantities = next;
  }

  #toggleCheckbox(itemId: string, checked: boolean): void {
    this.#setQuantity(itemId, checked ? 1 : 0);
  }

  #step(item: TillOptionItem, delta: number): void {
    const current = this.quantities[item.id] ?? 0;
    const clamped = Math.max(0, Math.min(item.maxQuantity, current + delta));
    this.#setQuantity(item.id, clamped);
  }

  #confirm(e?: Event): void {
    if (!this.#allSatisfied) return;
    e?.stopPropagation();
    const detail: ModifierConfirmDetail = {
      product: this.#selectedProduct,
      options: this.#selectedOptions(),
      ...(this.product.modifiers === undefined ? {} : this.#selectedModifiers()),
    };
    const note = this.note.trim();
    if (note !== "") {
      detail.note = note;
    }
    if (this.doneness !== "") {
      detail.doneness = this.doneness;
    }
    this.dispatchEvent(
      new CustomEvent<ModifierConfirmDetail>("wt-modifier-confirm", {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }

  #cancel(event: Event): void {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("wt-modifier-cancel", { detail: {}, bubbles: true, composed: true }),
    );
  }

  override render() {
    return html`<wt-dialog
      .open=${true}
      .heading=${productName(this.product)}
      @wt-close=${(event: Event) => this.#cancel(event)}
    >
      ${
        this.#variants.length === 0
          ? nothing
          : html`<fieldset class="group">
              <legend class="group-name">${t("modifier.variant")} *</legend>
              ${this.#variants.map(
                (variant) =>
                  html`<label class="option">
                    <input
                      type="radio"
                      name="product-variant"
                      value=${variant.id}
                      .checked=${this.variantId === variant.id}
                      @change=${(event: Event) => {
                        event.stopPropagation();
                        this.variantId = variant.id;
                      }}
                    />
                    <span class="option-name">${descriptionFor(variant.name, variant.id)}</span>
                    <span class="option-delta">${formatMoney(variant.unitPrice)}</span>
                  </label>`,
              )}
            </fieldset>`
      }
      ${this.product.modifiers === undefined ? this.#renderableGroups.map((group) => this.#renderGroup(group)) : this.#modifiers.map((modifier) => this.#renderModifier(modifier))}
      ${
        this.initialSelections !== undefined
          ? nothing
          : renderLineExtrasEditor({
              product: this.product,
              note: this.note,
              doneness: this.doneness,
              onNoteChange: (note) => {
                this.note = note;
              },
              onDonenessChange: (doneness) => {
                this.doneness = doneness;
              },
            })
      }
      <div class="running">
        <span class="running-label">${t("label.total")}</span>
        <span class="running-amount">${this.#runningPrice}</span>
      </div>
      <wt-button
        slot="footer"
        class="cancel"
        variant="secondary"
        @click=${(event: Event) => this.#cancel(event)}
      >
        ${t("action.cancel")}
      </wt-button>
      <wt-button
        slot="footer"
        class="confirm"
        variant="primary"
        ?disabled=${!this.#allSatisfied}
        @click=${(e: Event) => this.#confirm(e)}
      >
        ${t(this.initialSelections === undefined ? "action.add" : "modifier.save")}
      </wt-button>
    </wt-dialog>`;
  }

  #selectedModifiers(): {
    modifierSelections: ModifierSelection[];
    modifierSnapshots: ModifierSnapshot[];
  } {
    const modifierSelections: ModifierSelection[] = [];
    const modifierSnapshots: ModifierSnapshot[] = [];
    for (const modifier of this.#modifiers) {
      const common = { modifierId: modifier.id, name: modifier.name };
      if (modifier.type === "text") {
        const text = String(this.answers[modifier.id] ?? "");
        if (!text.trim()) continue;
        modifierSelections.push({ modifierId: modifier.id, type: "text", text });
        modifierSnapshots.push({ ...common, type: "text", text });
      } else if (modifier.type === "options") {
        const choice = modifier.choices.find((choice) => choice.id === this.answers[modifier.id])!;
        modifierSelections.push({ modifierId: modifier.id, type: "options", choiceId: choice.id });
        modifierSnapshots.push({
          ...common,
          type: "options",
          choiceId: choice.id,
          choiceName: choice.name,
        });
      } else if (modifier.type === "yes-no") {
        const value = this.answers[modifier.id] === true;
        modifierSelections.push({ modifierId: modifier.id, type: "yes-no", value });
        modifierSnapshots.push({
          ...common,
          type: "yes-no",
          value,
          label: value ? modifier.yesLabel : modifier.noLabel,
        });
      } else {
        const choices = modifier.choices
          .filter((choice) => (this.quantities[choice.id] ?? 0) > 0)
          .map((choice) => ({ choiceId: choice.id, quantity: this.quantities[choice.id]! }));
        modifierSelections.push({ modifierId: modifier.id, type: "extras", choices });
        modifierSnapshots.push({
          ...common,
          type: "extras",
          choices: choices.map((choice) => ({
            ...choice,
            name: modifier.choices.find((item) => item.id === choice.choiceId)!.name,
          })),
        });
      }
    }
    return { modifierSelections, modifierSnapshots: structuredClone(modifierSnapshots) };
  }

  #renderModifier(modifier: Modifier) {
    const name = descriptionFor(modifier.name, modifier.id);
    const required =
      modifier.type === "options" || (modifier.type === "extras" && modifier.required);
    const noChoices =
      (modifier.type === "options" || modifier.type === "extras") &&
      !modifier.choices.some((choice) => choice.available);
    if (modifier.type === "extras")
      return html`${this.#renderGroup(this.#renderableGroups.find((group) => group.id === modifier.id)!)}${this.#staleExtra(modifier) ? html`<p role="alert">${name}: ${t("modifier.selection_changed")}</p>` : required && noChoices ? html`<p role="alert">${name}: ${t("modifier.unavailable_choices")}</p>` : nothing}`;
    return html`<fieldset class="group">
      <legend class="group-name">${name}${required ? " *" : ""}</legend>
      ${
        modifier.type === "text"
          ? html`<textarea
              name=${`modifier-${modifier.id}`}
              aria-label=${name}
              maxlength="500"
              .value=${String(this.answers[modifier.id] ?? "")}
              @input=${(event: Event) => {
                event.stopPropagation();
                this.answers = {
                  ...this.answers,
                  [modifier.id]: (event.target as HTMLTextAreaElement).value,
                };
              }}
            ></textarea>`
          : modifier.type === "options"
            ? modifier.choices
                .filter((choice) => choice.available)
                .map(
                  (choice) =>
                    html`<label class="option"
                      ><input
                        type="radio"
                        name=${`modifier-${modifier.id}`}
                        .checked=${this.answers[modifier.id] === choice.id}
                        @change=${(event: Event) => {
                          event.stopPropagation();
                          this.answers = { ...this.answers, [modifier.id]: choice.id };
                        }}
                      />${descriptionFor(choice.name, choice.id)}</label
                    >`,
                )
            : [false, true].map(
                (value) =>
                  html`<label class="option"
                    ><input
                      type="radio"
                      name=${`modifier-${modifier.id}`}
                      .checked=${this.answers[modifier.id] === value}
                      @change=${(event: Event) => {
                        event.stopPropagation();
                        this.answers = { ...this.answers, [modifier.id]: value };
                      }}
                    />${descriptionFor(value ? modifier.yesLabel : modifier.noLabel, String(value))}</label
                  >`,
              )
      }
      ${required && noChoices ? html`<p role="alert">${name}: ${t("modifier.unavailable_choices")}</p>` : nothing}
    </fieldset>`;
  }

  #renderGroup(group: TillOptionGroup) {
    const single = this.product.modifiers === undefined && group.maxSelect === 1;
    // Measured against the group's SUMMED quantity now that an option can be taken several times.
    const atGroupMax = this.#groupQuantity(group) >= group.maxSelect;
    return html`
      <fieldset class="group">
        <legend class="group-name">
          ${descriptionFor(group.name, group.id)}${group.required ? " *" : ""}
        </legend>
        ${this.product.modifiers !== undefined ? html`<p class="selected-total">${t("modifier.selected_total")}: ${this.#groupQuantity(group)}${Number.isFinite(group.maxSelect) ? ` / ${group.maxSelect}` : ""}</p>` : nothing}
        ${group.items.map((item) =>
          this.#hasStepper(group, item)
            ? this.#renderStepper(item, atGroupMax)
            : this.#renderChoice(group, item, single, atGroupMax),
        )}
      </fieldset>
    `;
  }

  #deltaOf(item: TillOptionItem) {
    return Number(item.priceDelta) !== 0 ? formatMoney(item.priceDelta) : nothing;
  }

  #renderChoice(
    group: TillOptionGroup,
    item: TillOptionItem,
    single: boolean,
    atGroupMax: boolean,
  ) {
    const checked = (this.quantities[item.id] ?? 0) >= 1;
    // A multi-select group at its summed max disables its remaining unticked boxes; radios stay live
    // (selecting one just replaces the other), so they never disable.
    const disabled = !single && !checked && atGroupMax;
    return html`
      <label class="option">
        <input
          id="opt-${item.id}"
          type=${single ? "radio" : "checkbox"}
          name=${group.id}
          .checked=${checked}
          ?disabled=${disabled}
          @change=${(e: Event) =>
            single
              ? this.#chooseRadio(group, item.id)
              : this.#toggleCheckbox(item.id, (e.target as HTMLInputElement).checked)}
        />
        <span class="option-name">${descriptionFor(item.name, item.id)}</span>
        <span class="option-delta">${this.#deltaOf(item)}</span>
      </label>
    `;
  }

  #renderStepper(item: TillOptionItem, atGroupMax: boolean) {
    const count = this.quantities[item.id] ?? 0;
    const name = descriptionFor(item.name, item.id);
    return html`
      <div class="option stepper-option">
        <span class="option-name">${name}</span>
        <span class="option-delta">${this.#deltaOf(item)}</span>
        <span class="stepper">
          <wt-button
            class="step"
            size="sm"
            data-test="opt-${item.id}-dec"
            aria-label=${`${t("modifier.decrease")} ${name}`}
            ?disabled=${count <= 0}
            @click=${() => this.#step(item, -1)}
          >
            −
          </wt-button>
          <span class="stepper-count" data-test="opt-${item.id}-count">${count}</span>
          <wt-button
            class="step"
            size="sm"
            data-test="opt-${item.id}-inc"
            aria-label=${`${t("modifier.increase")} ${name}`}
            ?disabled=${count >= item.maxQuantity || atGroupMax}
            @click=${() => this.#step(item, 1)}
          >
            +
          </wt-button>
        </span>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-modifier-picker": TillModifierPicker;
  }
}
