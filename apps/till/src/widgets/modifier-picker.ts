import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { formatMoney } from "../i18n/format.js";
import { t } from "../i18n/t.js";
import { lineGross } from "../state/order-line.js";
import { descriptionFor } from "./dish-format.js";
import { productName } from "./product-name.js";
import type { OrderLine, SelectedLineOption } from "../state/working-order.js";
import type { TillOptionGroup, TillProduct } from "../api/client.js";

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
 * SELECTION UI, per group's `maxSelect`:
 *  - a SINGLE-select group (`maxSelect === 1`) renders RADIOS — exclusive by nature, so picking a new
 *    one replaces the old and the max is enforced without disabling anything;
 *  - a MULTI-select group renders CHECKBOXES, and once `maxSelect` are ticked the REMAINING unticked
 *    boxes disable (the ticked ones stay live so the diner can undo them).
 *
 * CLIENT ENFORCEMENT is UX ONLY — the server re-validates every selection authoritatively (Task 6), so
 * this never reimplements the server's rules, it only gates the button and the boxes. "Add" is disabled
 * until every rendered group is SATISFIED: a `required` group (or one with `minSelect > 0`) needs at
 * least its minimum picked. A running price (dish gross + the selected deltas, at quantity 1) shows what
 * the line will cost — computed with the SAME `lineGross` the basket totals with, so the two agree.
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

      .option-name {
        flex: 1;
      }

      .option-delta {
        color: var(--wt-color-text-muted);
        font-variant-numeric: tabular-nums;
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
   * The chosen item ids per group, keyed by group id. A radio group holds at most one; a checkbox group
   * holds up to its `maxSelect`. Held as a fresh object on each change (never mutated in place) so Lit's
   * dirty check re-renders. Groups absent from the map have nothing selected.
   */
  @state() private selection: Record<string, string[]> = {};

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

  /** Whether a group has its minimum picked. An empty group never reaches here (it is not rendered). */
  #satisfied(group: TillOptionGroup): boolean {
    return (this.selection[group.id]?.length ?? 0) >= this.#minFor(group);
  }

  /** Whether every rendered group is satisfied — the gate on "Add". Vacuously true when no group needs
   * anything (all optional, or all empty and skipped), so a modifier-free-but-grouped dish still adds. */
  get #allSatisfied(): boolean {
    return this.#renderableGroups.every((group) => this.#satisfied(group));
  }

  /** The modifiers picked so far, in group-then-item order, as the wire/display `SelectedLineOption[]`. */
  #selectedOptions(): SelectedLineOption[] {
    const options: SelectedLineOption[] = [];
    for (const group of this.#renderableGroups) {
      const picked = this.selection[group.id] ?? [];
      for (const item of group.items) {
        if (picked.includes(item.id)) {
          options.push({
            optionGroupItemId: item.id,
            name: item.name,
            priceDelta: item.priceDelta,
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

  /** Pick a radio: it becomes the group's sole selection. */
  #chooseRadio(groupId: string, itemId: string): void {
    this.selection = { ...this.selection, [groupId]: [itemId] };
  }

  /** Toggle a checkbox: add the item, or remove it when unticked. The template disables an unticked box
   * at `maxSelect`, so a check that would exceed the bound never fires. */
  #toggleCheckbox(groupId: string, itemId: string, checked: boolean): void {
    const current = this.selection[groupId] ?? [];
    const next = checked ? [...current, itemId] : current.filter((id) => id !== itemId);
    this.selection = { ...this.selection, [groupId]: next };
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
    const picked = this.selection[group.id] ?? [];
    const atMax = picked.length >= group.maxSelect;
    return html`
      <fieldset class="group">
        <legend class="group-name">${descriptionFor(group.name, group.id)}</legend>
        ${group.items.map((item) => {
          const checked = picked.includes(item.id);
          // A multi-select group at its max disables its remaining unticked boxes; radios stay live
          // (selecting one just replaces the other), so they never disable.
          const disabled = !single && !checked && atMax;
          const delta = Number(item.priceDelta) !== 0 ? formatMoney(item.priceDelta) : nothing;
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
                    ? this.#chooseRadio(group.id, item.id)
                    : this.#toggleCheckbox(
                        group.id,
                        item.id,
                        (e.target as HTMLInputElement).checked,
                      )}
              />
              <span class="option-name">${descriptionFor(item.name, item.id)}</span>
              <span class="option-delta">${delta}</span>
            </label>
          `;
        })}
      </fieldset>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-modifier-picker": TillModifierPicker;
  }
}
