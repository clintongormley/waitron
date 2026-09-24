import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { selectStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import { reorder } from "./reorder.js";
import { ReorderController, type ReorderModel } from "./reorder-table.js";
import type { ProductEditorVariant } from "../api/client.js";
import { t } from "../i18n/t.js";

/** One row: the variant and the key that follows it while the table is on screen. */
interface VariantRow {
  key: string;
  variant: ProductEditorVariant;
}

/** Which variants the status filter shows (spec §15.6: a removed variant is Inactive, not gone). */
type StatusFilter = "active" | "inactive" | "all";

/**
 * The product editor's list of variants — a plain `<table>` this widget owns, deliberately NOT
 * `wt-data-table`: the rows are a draft being edited in place, not an administrative collection to
 * sort and search.
 *
 * The host owns the variants. Every row action leaves as an event carrying the row's INDEX, which
 * is the same index in the array the host handed over — rows the status filter hides included. A
 * reorder is the one action the table also shows immediately: the row follows the key or the
 * finger, and `wt-reorder` tells the host to make the same move in its draft. A host that ignores
 * that event therefore drifts out of step with what is on screen.
 *
 * The name shown is the STAFF name. The customer-facing name belongs to a receipt or a menu, and
 * the fallback between them belongs to `packages/catalogue/src/product-presentation.ts`.
 */
@customElement("dashboard-variant-table")
export class VariantTable extends LitElement {
  static override styles = [
    selectStyles,
    ReorderController.styles,
    css`
      :host {
        display: block;
        container-type: inline-size;
      }
      /* Where the columns cannot fit, the table scrolls sideways inside its own box rather than
         widening the dialog. */
      .wrap {
        overflow-x: auto;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        color: var(--wt-color-text);
        font-family: var(--wt-font-family);
        font-size: var(--wt-font-size-md);
      }
      th,
      td {
        padding: var(--wt-space-2) var(--wt-space-1);
        text-align: start;
        vertical-align: middle;
        border-bottom: 1px solid var(--wt-color-border);
      }
      th {
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
      }
      /* The grip and the row menu are each a tap-target-wide button that already centres its icon,
         so their cells need no inline padding. */
      th:first-child,
      td:first-child,
      th:last-child,
      td:last-child {
        padding-inline: 0;
      }
      /* The name is the one column that may break inside a word, so it is what gives way when a
         row is short of room. */
      th:nth-child(2),
      td:nth-child(2) {
        overflow-wrap: anywhere;
      }
      td:nth-child(2) {
        max-width: var(--wt-cell-name-max-width);
      }
      .price-heading {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-1);
      }
      /* As wide as the chosen unit's name, up to the width of its column. */
      .price-heading select {
        field-sizing: content;
        width: auto;
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        max-width: 100%;
        padding-inline: var(--wt-space-1);
      }
      /* An amount never breaks inside the number. */
      .amount {
        white-space: nowrap;
      }
      /* Shown only on a narrow table, where the price moves under the name. */
      .stacked-price {
        display: none;
      }
      /* On a narrow table the price moves under the name and its own column goes, taking the
         heading's unit select with it; the price field above the table has a unit button for the
         same unit. The name column takes what the grip, Available and row menu columns leave, and
         is never narrower than its widest price. An Available heading longer than its cap runs on
         into the row menu's empty heading. Receipt: the --wt-cell-name-max-width entry in
         docs/developers/design-system.md; guard: the phone-width cases in product-editor.test.ts. */
      @container (max-width: 30rem) {
        th:nth-child(2) {
          width: 100%;
        }
        th:nth-child(3),
        td:nth-child(3) {
          display: none;
        }
        .stacked-price {
          display: block;
        }
        th:nth-child(4) {
          max-width: calc(var(--wt-tap-min) + var(--wt-space-6));
        }
      }
      /* A rejected row is marked in the row itself: a message in the summary alone does not say
         WHICH variant is wrong, and these rows have no field of their own to attach it to. */
      tr.invalid td:first-child {
        border-inline-start: 2px solid var(--wt-color-danger);
      }
      .error {
        margin: var(--wt-space-1) 0 0;
        color: var(--wt-color-danger);
        font-size: var(--wt-font-size-sm);
      }
      .filter {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
        margin-bottom: var(--wt-space-2);
        color: var(--wt-color-text);
        font-family: var(--wt-font-family);
      }
      /* A filter over the rows below, not a field of the product: sized to its choices so it does
         not read as one more full-width input in the form. */
      .filter select {
        width: auto;
      }
      .muted {
        color: var(--wt-color-text-muted);
      }
      .notice {
        margin: var(--wt-space-2) 0 0;
        color: var(--wt-color-text-muted);
        font-family: var(--wt-font-family);
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

  @property({ attribute: false }) variants: ProductEditorVariant[] = [];
  /** The product's own price, which a variant with no price of its own sells at. */
  @property() basePrice = "";
  /** True while the product has changes not yet saved: opening a variant's page would leave them
   * behind, so Open is held until they are saved. */
  @property({ type: Boolean }) openBlocked = false;
  @property({ attribute: false }) unitId: string | null = null;
  @property({ attribute: false }) unitOptions: { value: string | null; label: string }[] = [];
  @property() addUnitLabel = "";
  @property({ type: Boolean }) busy = false;
  /** A problem with one row, keyed by that row's index in `variants`. The host validates; this
   * only shows what it reports, beside the row it belongs to. */
  @property({ attribute: false }) errors: Record<number, string> = {};
  /** Every row in list order, hidden ones included. A reorder rewrites this before the host
   * confirms it. */
  @state() private rows: VariantRow[] = [];
  @state() private status: StatusFilter = "active";
  #nextKey = 0;
  /** The row whose Remove or Restore was just chosen. The host hands that variant back as a new
   * object, which re-keys the row and destroys the control holding focus, so focus is put back once
   * the new variants arrive. */
  #refocus: number | null = null;

  readonly #reorder = new ReorderController(this, {
    order: () => this.#visible().map((row) => row.key),
    move: (key, to) => this.#move(key, to),
    label: (key) => this.#label(this.rows.find((row) => row.key === key)?.variant),
    busy: () => this.busy,
    get reorderLabel(): string {
      return t("editor.reorder_variant");
    },
  } satisfies ReorderModel);

  /** Puts focus on a row's actions trigger — the way into the window where that variant's own
   * fields are edited, and the only control on the row that is not itself an edit. The Edit button
   * behind it cannot take focus while the menu is closed. A row just drawn has a trigger only once
   * its menu has rendered, so this waits for that. */
  async focusRow(index: number): Promise<void> {
    const menu = this.shadowRoot?.querySelector<LitElement>(`[data-test="actions-${index}"]`);
    await menu?.updateComplete;
    menu?.focus();
  }

  #shows(variant: ProductEditorVariant): boolean {
    return this.status === "all" || variant.active === (this.status === "active");
  }

  #visible(): VariantRow[] {
    return this.rows.filter((row) => this.#shows(row.variant));
  }

  override willUpdate(changed: PropertyValues<this>): void {
    const added = changed.has("variants") ? this.#rekey() : [];
    if (!changed.has("variants") && !changed.has("errors")) return;
    // A reported problem, or a variant just added, must never sit on a row the filter hides: the
    // person would be told something is wrong, or that they added a row, and see nothing.
    const hidden = this.rows.some(
      (row, index) =>
        !this.#shows(row.variant) &&
        (this.errors[index] !== undefined || (added.includes(row) && row.variant.id === undefined)),
    );
    if (hidden) this.status = "all";
  }

  override updated(changed: PropertyValues<this>): void {
    if (!changed.has("variants") || this.#refocus === null) return;
    const index = this.#refocus;
    this.#refocus = null;
    // The same row while it is still on screen; otherwise the next row on screen (a variant never
    // saved leaves the list, so the one after it now holds its index), then the last one, then the
    // filter, which is all that is left once no row is shown.
    const shown = this.rows.flatMap((row, i) => (this.#shows(row.variant) ? [i] : []));
    const target = shown.find((i) => i >= index) ?? shown.at(-1);
    if (target !== undefined) void this.focusRow(target);
    else this.shadowRoot?.querySelector<HTMLElement>('[name="variant-status"]')?.focus();
  }

  /** Re-reads the host's variants into rows, returning the rows it had not seen before. */
  #rekey(): VariantRow[] {
    // Keys follow the variant OBJECT, so the array coming back from a host that applied a reorder
    // carries the same keys in the same order — which is what keeps a keyboard user's focus on the
    // row they just moved. A host that rebuilds its variants mints new keys and merely loses that
    // focus; it never moves the wrong row, because a key that is gone matches no handle.
    const previous = new Map(this.rows.map((row) => [row.variant, row.key]));
    const added: VariantRow[] = [];
    this.rows = this.variants.map((variant) => {
      const key = previous.get(variant);
      if (key === undefined) {
        const row = { key: `variant-${++this.#nextKey}`, variant };
        added.push(row);
        return row;
      }
      previous.delete(variant);
      return { key, variant };
    });
    return added;
  }

  /** The staff name, or a generic one so a nameless draft row still has something to be called. */
  #label(variant: ProductEditorVariant | undefined): string {
    return variant?.name.trim() || t("editor.variant");
  }

  /** "Same as" the product's price, with the amount kept whole while the words around it wrap. */
  #sameAs() {
    const [before = "", after = ""] = t("editor.same_as").split("{value}");
    return html`${before}<span class="amount">${this.basePrice}</span>${after}`;
  }

  #emit(name: string, detail: Record<string, unknown>): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  /** `to` is a position among the rows on screen. The row lands where the visible row now at that
   * position is in the whole list, which keeps the visible rows' order what the person made it
   * while the hidden rows stay where they were relative to their neighbours. */
  #move(key: string, to: number): void {
    const from = this.rows.findIndex((row) => row.key === key);
    const target = this.#visible()[to];
    const at = target === undefined ? -1 : this.rows.indexOf(target);
    // A key that no longer names a row, or a move that lands where it started, would otherwise be
    // reported to the host as a move — one of them from index -1.
    if (from < 0 || at < 0 || from === at) return;
    this.rows = reorder(this.rows, from, at);
    this.#emit("wt-reorder", { from, to: at });
  }

  #action(
    name: string,
    index: number,
    label: string,
    variant: "secondary" | "danger",
    blocked = false,
  ) {
    return html`<wt-button
      variant=${variant}
      data-test=${`${name}-${index}`}
      .disabled=${this.busy || blocked}
      @click=${(event: Event) => {
        event.stopPropagation();
        if (this.busy || blocked) return;
        if (name === "remove" || name === "restore") this.#refocus = index;
        this.#emit(`wt-${name}`, { index });
      }}
      >${label}</wt-button
    >`;
  }

  #row(row: VariantRow, index: number) {
    const { variant } = row;
    const label = this.#label(variant);
    const error = this.errors[index] ?? "";
    const price =
      variant.unitPrice !== null
        ? html`<span class="amount">${variant.unitPrice}</span>`
        : this.basePrice
          ? html`<span class="muted">${this.#sameAs()}</span>`
          : nothing;
    return html`<tr class=${error ? "invalid" : ""} data-test=${`row-${index}`}>
      <td>${this.#reorder.handle(row.key)}</td>
      <td>
        ${label}
        ${
          variant.active
            ? nothing
            : html`<span class="muted" data-test=${`inactive-${index}`}
                >${t("product.inactive_badge")}</span
              >`
        }
        ${
          price === nothing
            ? nothing
            : html`<span class="stacked-price" data-test=${`stacked-price-${index}`}
                ><span class="visually-hidden">${t("product.price")}</span> ${price}</span
              >`
        }
        ${error ? html`<p class="error" data-test=${`error-${index}`}>${error}</p>` : nothing}
      </td>
      <td>${price}</td>
      <td>
        <wt-switch
          name=${`available-${index}`}
          data-test=${`available-${index}`}
          label=${t("editor.available")}
          hide-label
          .checked=${row.variant.available}
          .disabled=${this.busy}
          @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
            // Stop the switch's own event before re-emitting, or the host counts one change twice.
            event.stopPropagation();
            if (this.busy) return;
            this.#emit("wt-toggle-available", { index, available: event.detail.checked });
          }}
        ></wt-switch>
      </td>
      <td>
        <wt-row-actions
          align="end"
          data-test=${`actions-${index}`}
          label=${`${t("editor.variant_actions")}: ${label}`}
          >${
            variant.id === undefined
              ? nothing
              : this.#action("open", index, t("editor.open_variant"), "secondary", this.openBlocked)
          }${this.#action("edit", index, t("action.edit"), "secondary")}${
            variant.active
              ? this.#action("remove", index, t("action.remove"), "danger")
              : this.#action("restore", index, t("product.restore"), "secondary")
          }</wt-row-actions
        >
      </td>
    </tr>`;
  }

  override render() {
    // Each row keeps its index in the whole list, which is what every row action reports.
    const visible = this.rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => this.#shows(row.variant));
    return html`<label class="filter"
        >${t("editor.variants_show")}<select
          name="variant-status"
          @change=${(event: Event) => {
            event.stopPropagation();
            this.status = (event.target as HTMLSelectElement).value as StatusFilter;
          }}
        >
          ${(
            [
              ["active", t("product.active_badge")],
              ["inactive", t("product.inactive_badge")],
              ["all", t("product.filter_status_all")],
            ] as const
          ).map(
            ([value, text]) =>
              html`<option value=${value} .selected=${value === this.status}>${text}</option>`,
          )}
        </select></label
      >
      <div class="wrap">
        <table>
          <caption class="visually-hidden">
            ${t("editor.variants")}
          </caption>
          <thead>
            <tr>
              <th scope="col">
                <span class="visually-hidden">${t("editor.reorder_variant")}</span>
              </th>
              <th scope="col">${t("editor.name")}</th>
              <th scope="col">
                <span class="price-heading"
                  >${t("product.price")}<select
                    name="pricing-unit"
                    aria-label=${t("product.unit")}
                    .disabled=${this.busy}
                    @change=${(event: Event) => {
                      event.stopPropagation();
                      const select = event.target as HTMLSelectElement;
                      const value = select.value;
                      if (value === "__add__") {
                        select.value = this.unitId ?? "";
                        this.#emit("wt-add-unit", {});
                      } else this.#emit("wt-unit-change", { unitId: value || null });
                    }}
                  >
                    ${this.unitOptions.map(
                      (option) =>
                        html`<option
                          value=${option.value ?? ""}
                          .selected=${option.value === this.unitId}
                        >
                          ${option.label}
                        </option>`,
                    )}
                    ${
                      this.addUnitLabel
                        ? html`<option value="__add__">${this.addUnitLabel}</option>`
                        : nothing
                    }
                  </select></span
                >
              </th>
              <th scope="col">${t("editor.available")}</th>
              <th scope="col">
                <span class="visually-hidden">${t("editor.variant_actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            ${repeat(
              visible,
              ({ row }) => row.key,
              ({ row, index }) => this.#row(row, index),
            )}
          </tbody>
        </table>
      </div>
      ${
        visible.length
          ? nothing
          : html`<p class="notice" data-test="no-variants">${t("editor.no_variants_status")}</p>`
      }
      ${
        this.openBlocked && visible.some(({ row }) => row.variant.id !== undefined)
          ? html`<p class="notice" data-test="open-blocked">${t("editor.open_variant_blocked")}</p>`
          : nothing
      }
      ${this.#reorder.liveRegion()}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-variant-table": VariantTable;
  }
}
