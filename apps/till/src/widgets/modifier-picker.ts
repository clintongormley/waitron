import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { formatMoney } from "../i18n/format.js";
import { t } from "../i18n/t.js";
import { lineGross } from "../state/order-line.js";
import { descriptionFor } from "./dish-format.js";
import { productName } from "./product-name.js";
import type { OrderLine, SelectedLineOption } from "../state/working-order.js";
import type { TillOptionGroup, TillOptionItem, TillProduct } from "../api/client.js";

/**
 * The `modifier-confirm` payload: the parent product the diner was configuring plus the modifiers they
 * chose, as the `SelectedLineOption[]` the store's `addProduct(product, "1", options)` takes. `options`
 * is `[]` when nothing was picked (every group was optional and left blank); the caller (the grid)
 * collapses that empty case to no `options` at all before adding, so a grouped-but-unmodified dish stays
 * byte-identical to a plain ring-up.
 */
export interface ModifierConfirmDetail {
  product: TillProduct;
  options: SelectedLineOption[];
}

/**
 * The "choose your modifiers" dialog — the visible centre of the ordering flow. Tapping a product that
 * carries a non-empty option group (Task 3) opens this over the till; the diner picks their options and
 * the picker rings the dish with them (via the grid, which calls `addProduct`).
 *
 * SELECTION UI, per group's `maxSelect` and per item's `maxQuantity` (per-option quantity):
 *  - a SINGLE-select group (`maxSelect === 1`) renders RADIOS — exclusive by nature, so picking a new
 *    one replaces the old and the max is enforced without disabling anything. A quantity > 1 is
 *    impossible in a single-select group (its sum is capped at 1), so its items never get a stepper
 *    however high their `maxQuantity`;
 *  - a MULTI-select group renders CHECKBOXES for `maxQuantity === 1` items, and a STEPPER (`− N +`) for
 *    an item whose `maxQuantity > 1` — the diner can take that option several times per dish. Once the
 *    group's SUMMED quantity reaches `maxSelect` the remaining unticked boxes and every stepper's `+`
 *    disable (a ticked box / a stepped item stays live so the diner can undo it); a stepper's `+` also
 *    disables at the item's own `maxQuantity`, and its `−` at 0 (where it deselects the option).
 *
 * SELECTION STATE is a flat `quantities` map keyed by `option_group_items.id` — absent/0 is unselected,
 * ≥ 1 is selected with that per-dish count. A checkbox tick is quantity 1; a radio sets its item to 1
 * and clears its siblings; a stepper sets the count directly.
 *
 * CLIENT ENFORCEMENT is UX ONLY — the server re-validates every selection authoritatively (Task 6), so
 * this never reimplements the server's rules, it only gates the button, the boxes and the steppers.
 * "Add" is disabled until every rendered group is SATISFIED: a `required` group (or one with
 * `minSelect > 0`) needs at least its minimum picked, counted as the group's SUMMED quantity. A running
 * price (dish gross + the selected deltas, each at its stepped quantity, on a quantity-1 dish) shows
 * what the line will cost — computed with the SAME `lineGross` the basket totals with, so the two agree.
 *
 * THE EMPTY-GROUP CARRY (Task 3, CLAUDE.md §5 — nothing may wedge a sale): a group whose active `items`
 * resolved to `[]` (all its items inactive, an authoring bug) is SKIPPED — never rendered, and a
 * `required`-but-empty group imposes NO constraint, so a misconfigured menu can never lock the picker.
 *
 * Events (both composed + bubbling, so the grid catches them on its wrapper):
 *  - `modifier-confirm` carrying {@link ModifierConfirmDetail} on Add;
 *  - `modifier-cancel` on Cancel or when the modal is dismissed (Escape / `wt-close`).
 *
 * It lives in the SHARED counter/table-order flow, so the #173 handheld inherits it unchanged.
 */
@customElement("till-modifier-picker")
export class TillModifierPicker extends LitElement {
  static override styles = [
    baseStyles,
    css`
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

  /** The product being configured — supplied by the grid when it opens the picker. Its `optionGroups`
   * drive the whole dialog; the confirm event carries it straight back so the grid rings THIS product. */
  @property({ attribute: false }) product!: TillProduct;

  /**
   * The chosen per-dish COUNT of each option, keyed by `option_group_items.id` (per-option quantity):
   * absent or 0 = unselected, ≥ 1 = selected with that count. A radio/checkbox pick is a count of 1; a
   * stepper sets the count directly (up to the item's `maxQuantity` and the group's remaining `maxSelect`
   * allowance). Held as a fresh object on each change (never mutated in place) so Lit's dirty check
   * re-renders; a count that reaches 0 is DELETED from the map, so an unselected item leaves no key.
   */
  @state() private quantities: Record<string, number> = {};

  /** The product's groups that actually have something to pick — the empty-group carry drops `items: []`
   * groups here, so they are neither rendered nor counted as a constraint. */
  get #renderableGroups(): TillOptionGroup[] {
    return (this.product.optionGroups ?? []).filter((group) => group.items.length > 0);
  }

  /** The minimum a group needs picked to be satisfied: its `minSelect`, floored at 1 when `required`
   * (a required group must have at least one, whatever its declared minimum). */
  #minFor(group: TillOptionGroup): number {
    return group.required ? Math.max(group.minSelect, 1) : group.minSelect;
  }

  /** The group's SUMMED quantity across its items — the count `maxSelect`/`minSelect` are measured
   * against now that an option can be taken several times (per-option quantity). */
  #groupQuantity(group: TillOptionGroup): number {
    return group.items.reduce((sum, item) => sum + (this.quantities[item.id] ?? 0), 0);
  }

  /** Whether an item shows a STEPPER rather than a checkbox/radio: only in a multi-select group
   * (`maxSelect > 1`) AND when the option may be taken more than once (`maxQuantity > 1`). A
   * single-select group caps its sum at 1, so a quantity > 1 is impossible there. */
  #hasStepper(group: TillOptionGroup, item: TillOptionItem): boolean {
    return group.maxSelect > 1 && item.maxQuantity > 1;
  }

  /** Whether a group has its minimum picked — counted as the SUMMED quantity. An empty group never
   * reaches here (it is not rendered). */
  #satisfied(group: TillOptionGroup): boolean {
    return this.#groupQuantity(group) >= this.#minFor(group);
  }

  /** Whether every rendered group is satisfied — the gate on "Add". Vacuously true when no group needs
   * anything (all optional, or all empty and skipped), so a modifier-free-but-grouped dish still adds. */
  get #allSatisfied(): boolean {
    return this.#renderableGroups.every((group) => this.#satisfied(group));
  }

  /** The modifiers picked so far, in group-then-item order, as the wire/display `SelectedLineOption[]`.
   * Emits every item with a count ≥ 1, carrying `quantity` ONLY when it is > 1 — a single-count option
   * omits the field, so a plain modifier's wire stays byte-identical to before (per-option quantity). */
  #selectedOptions(): SelectedLineOption[] {
    const options: SelectedLineOption[] = [];
    for (const group of this.#renderableGroups) {
      for (const item of group.items) {
        const quantity = this.quantities[item.id] ?? 0;
        if (quantity >= 1) {
          options.push({
            optionGroupItemId: item.id,
            name: item.name,
            priceDelta: item.priceDelta,
            ...(quantity > 1 ? { quantity } : {}),
          });
        }
      }
    }
    return options;
  }

  /** The running line price: the dish + every selected delta at quantity 1, via the SAME `lineGross` the
   * basket sums with, so the figure here equals the basket row the add produces. */
  get #runningPrice(): string {
    const previewLine: OrderLine = {
      product: this.product,
      quantity: "1",
      options: this.#selectedOptions(),
    };
    return formatMoney(lineGross(previewLine));
  }

  /** Set an item's count, writing a fresh `quantities` object; a count of 0 (or less) DELETES the key so
   * an unselected item leaves nothing behind. The single mutation point for radios, checkboxes and
   * steppers alike. */
  #setQuantity(itemId: string, quantity: number): void {
    const next = { ...this.quantities };
    if (quantity >= 1) {
      next[itemId] = quantity;
    } else {
      delete next[itemId];
    }
    this.quantities = next;
  }

  /** Pick a radio: it becomes the group's sole selection (count 1), clearing every sibling in the group. */
  #chooseRadio(group: TillOptionGroup, itemId: string): void {
    const next = { ...this.quantities };
    for (const item of group.items) delete next[item.id];
    next[itemId] = 1;
    this.quantities = next;
  }

  /** Toggle a checkbox: select the item at count 1, or deselect it when unticked. The template disables
   * an unticked box once the group's summed quantity is at `maxSelect`, so a check that would exceed the
   * bound never fires. */
  #toggleCheckbox(itemId: string, checked: boolean): void {
    this.#setQuantity(itemId, checked ? 1 : 0);
  }

  /** Step an item's count by ±1 (per-option quantity), clamped to `[0, item.maxQuantity]`. The template
   * disables `−` at 0 and `+` at the item's `maxQuantity` or the group's summed `maxSelect`, so a step
   * past a bound never fires; the clamp is a belt-and-braces guard. */
  #step(item: TillOptionItem, delta: number): void {
    const current = this.quantities[item.id] ?? 0;
    const clamped = Math.max(0, Math.min(item.maxQuantity, current + delta));
    this.#setQuantity(item.id, clamped);
  }

  /** Emit the parent product + the chosen options. Guarded so a force-click past the disabled state can
   * never confirm an unsatisfied selection. */
  #confirm(): void {
    if (!this.#allSatisfied) return;
    this.dispatchEvent(
      new CustomEvent<ModifierConfirmDetail>("modifier-confirm", {
        detail: { product: this.product, options: this.#selectedOptions() },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Emit the cancel so the grid tears the dialog down (which unmounts this element). */
  #cancel(): void {
    this.dispatchEvent(new CustomEvent("modifier-cancel", { bubbles: true, composed: true }));
  }

  override render() {
    return html`<wt-dialog
      .open=${true}
      .heading=${productName(this.product)}
      @wt-close=${() => this.#cancel()}
    >
      ${this.#renderableGroups.map((group) => this.#renderGroup(group))}
      <div class="running">
        <span class="running-label">${t("label.total")}</span>
        <span class="running-amount">${this.#runningPrice}</span>
      </div>
      <wt-button slot="footer" class="cancel" variant="secondary" @click=${() => this.#cancel()}>
        ${t("action.cancel")}
      </wt-button>
      <wt-button
        slot="footer"
        class="confirm"
        variant="primary"
        ?disabled=${!this.#allSatisfied}
        @click=${() => this.#confirm()}
      >
        ${t("action.add")}
      </wt-button>
    </wt-dialog>`;
  }

  #renderGroup(group: TillOptionGroup) {
    const single = group.maxSelect === 1;
    // Measured against the group's SUMMED quantity now that an option can be taken several times.
    const atGroupMax = this.#groupQuantity(group) >= group.maxSelect;
    return html`
      <fieldset class="group">
        <legend class="group-name">${descriptionFor(group.name, group.id)}</legend>
        ${group.items.map((item) =>
          this.#hasStepper(group, item)
            ? this.#renderStepper(item, atGroupMax)
            : this.#renderChoice(group, item, single, atGroupMax),
        )}
      </fieldset>
    `;
  }

  /** The shared modifier delta chip: the formatted price change, or nothing for a free option. */
  #deltaOf(item: TillOptionItem) {
    return Number(item.priceDelta) !== 0 ? formatMoney(item.priceDelta) : nothing;
  }

  /** A radio (single-select group) or checkbox (multi-select, `maxQuantity === 1`) row. */
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

  /** A `− N +` stepper row for a multi-select item takeable more than once (per-option quantity). `−`
   * disables at 0 (where a further step would deselect); `+` disables at the item's `maxQuantity` or when
   * the group's summed quantity has reached `maxSelect`. Both buttons carry an accessible name. */
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
