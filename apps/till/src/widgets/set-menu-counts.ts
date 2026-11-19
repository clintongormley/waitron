import { css, html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { repeat } from "lit/directives/repeat.js";
import { baseStyles, type WtNumberStepper } from "@waitron/ui";
import "@waitron/ui/src/components/wt-number-stepper.js";
import type { BillSetMenuState, ServedSetMenuCopy } from "@waitron/shared";
import { codeMessage } from "../i18n/codes.js";
import { fill, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { draftNamesLosingPlace, menusWithCopies } from "../state/set-menus.js";
import type { OrderLine } from "../state/working-order.js";

type Count = { id: string; name: string; lineIds: string[] };

@customElement("till-set-menu-counts")
export class TillSetMenuCounts extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }
      wt-number-stepper {
        --wt-stepper-field-width: calc(var(--wt-tap-min) * 4);
      }
    `,
  ];

  @property({ attribute: false }) bill: BillSetMenuState | null = null;
  @property({ attribute: false }) draft: readonly OrderLine[] = [];
  @property({ attribute: false }) onSale: readonly ServedSetMenuCopy[] = [];
  /** Apply an accepted bill before resolving. A refusal returns the wording for this stepper. */
  @property({ attribute: false }) saveCount?: (
    id: string,
    count: number,
  ) => Promise<string | undefined>;
  @property({ type: Boolean }) busy = false;
  @state() private pending: { id: string; value: string } | null = null;
  @state() private errors = new Map<string, string>();
  #counts = new Map<string, Count>();

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  protected override willUpdate(changed: ReadonlyMap<PropertyKey, unknown>) {
    if (!changed.has("bill") && !changed.has("onSale")) return;
    const counts = new Map<string, Count>();
    if (this.bill !== null) {
      for (const { menu, copy } of menusWithCopies(this.bill)) {
        const count = counts.get(copy.setMenuId) ?? {
          id: copy.setMenuId,
          name: copy.name,
          lineIds: [],
        };
        count.lineIds.push(menu.lineId);
        counts.set(count.id, count);
      }
    }
    for (const { menuId, name } of this.onSale) {
      if (!counts.has(menuId)) counts.set(menuId, { id: menuId, name, lineIds: [] });
    }
    for (const id of this.errors.keys()) {
      if (this.#counts.get(id)?.lineIds.length !== counts.get(id)?.lineIds.length)
        this.errors.delete(id);
    }
    this.#counts = counts;
  }

  override render() {
    return html`${repeat(
        this.#counts.values(),
        ({ id }) => id,
        (menu) => html`
          <wt-number-stepper
            name="set-menu-count"
            .min=${0}
            .max=${99}
            .value=${live(this.pending?.id === menu.id ? this.pending.value : String(menu.lineIds.length))}
            .label=${menu.name}
            .disabled=${this.busy || this.pending !== null || this.saveCount === undefined}
            .error=${this.errors.get(menu.id) ?? ""}
            .decreaseLabel=${(label: string) => fill(t("action.decrease"), { label })}
            .increaseLabel=${(label: string) => fill(t("action.increase"), { label })}
            @wt-change=${(event: CustomEvent<{ value: string }>) => void this.#change(menu, event)}
          ></wt-number-stepper>
        `,
      )}<slot name="help"></slot>`;
  }

  async #change(menu: Count, event: CustomEvent<{ value: string }>) {
    event.stopPropagation();
    const save = this.saveCount;
    if (save === undefined || this.pending !== null || this.busy) return;
    const stepper = event.currentTarget as WtNumberStepper;
    const value = event.detail.value.trim();
    const count = Number(value);
    const previous = menu.lineIds.length;
    let error = "";
    if (!/^\d{1,2}$/.test(value)) {
      error = t("set_menu.count_invalid");
    } else if (count < previous && this.bill !== null) {
      const occupied = new Set(this.bill.dishes.map(({ setMenuLineId }) => setMenuLineId));
      const empty = menu.lineIds.filter((id) => !occupied.has(id));
      if (empty.length >= previous - count) {
        const names = draftNamesLosingPlace(this.bill, this.draft, empty.slice(count - previous));
        if (names.length > 0)
          error = codeMessage("set_menu.needed_by_draft", undefined, {
            setMenuName: menu.name,
            dishNames: names,
          });
      }
    }
    this.errors = new Map(this.errors).set(menu.id, error);
    if (error !== "" || count === previous) {
      stepper.value = String(previous);
      return;
    }

    this.pending = { id: menu.id, value: String(count) };
    try {
      error = (await save(menu.id, count)) ?? "";
    } catch {
      error = codeMessage("server.error");
    } finally {
      if (this.#counts.get(menu.id)?.lineIds.length === previous)
        this.errors = new Map(this.errors).set(menu.id, error);
      this.pending = null;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-set-menu-counts": TillSetMenuCounts;
  }
}
