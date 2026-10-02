import { ReorderController, reorder, type ReorderModel } from "@waitron/ui";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import type { ProductEditorVariant } from "../api/client.js";
import { t } from "../i18n/t.js";
import { priceText } from "./form-fields.js";

interface VariantRow {
  key: string;
  variant: ProductEditorVariant;
}

type StatusFilter = "active" | "inactive" | "all";

const ADD_UNIT = "__add__";
/** The dropdown's value for Each, which a product stores as no unit: the shared dropdown draws an
 * empty value as the grey prompt for nothing chosen. Translated back to `null` before it leaves. */
export const EACH_CHOICE = "__each__";

/**
 * A plain `<table>`, deliberately NOT `wt-data-table`: the rows are a draft being edited in place,
 * not an administrative collection to sort and search.
 *
 * The host owns the variants. Every row action leaves as an event carrying the row's INDEX, which
 * is the same index in the array the host handed over — rows the status filter hides included.
 *
 * The name shown is the STAFF name. The customer-facing name belongs to a receipt or a menu.
 */
@customElement("dashboard-variant-table")
export class VariantTable extends LitElement {
  static override styles = [
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
      /* An amount never breaks inside the number. */
      .amount {
        white-space: nowrap;
      }
      /* Shown only on a narrow table, where the price moves under the name. */
      .stacked-price {
        display: none;
      }
      /* On a narrow table the price moves under the name and its own column goes, taking the
         heading's unit dropdown with it; the price field above the table has a unit button for the
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
        /* A secondary line, in the small size, so a four-digit price with its sign still fits a
           320px phone with the text sizes raised. */
        .stacked-price {
          display: block;
          font-size: var(--wt-font-size-sm);
        }
        th:nth-child(4) {
          max-width: calc(var(--wt-tap-min) + var(--wt-space-6));
        }
      }
      tr {
        position: relative;
      }
      /* Not the raised surface: that is the dialog panel's own colour, so the tint would not show. */
      tr:not([data-dragging]):hover td,
      tr:not([data-dragging]):focus-within td {
        background: var(--wt-color-bg);
      }
      .row-activate {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
        cursor: pointer;
        z-index: 0;
      }
      .row-activate:disabled {
        cursor: default;
      }
      .row-activate:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      /* The row's button lies over the whole row; these controls are lifted above it so they keep
         their own clicks. A dragged row is lifted above them, because the reorder controller's own
         lift of 1 would tie with them. */
      td :is(.handle, wt-switch, wt-row-actions) {
        position: relative;
        z-index: 1;
      }
      tr[data-dragging] {
        z-index: 2;
      }
      /* A rejected row is marked in the row itself: a message above Save alone does not say
         WHICH variant is wrong, and these rows have no field of their own to attach it to. */
      tr.invalid td:first-child {
        border-inline-start: 2px solid var(--wt-color-danger);
      }
      .error {
        margin: var(--wt-space-1) 0 0;
        color: var(--wt-color-danger);
        font-size: var(--wt-font-size-sm);
      }
      /* A filter over the rows below, not a field of the product: narrower than the form's fields
         so it does not read as one more of them. */
      .filter {
        max-width: calc(var(--wt-space-6) * 7);
        margin-bottom: var(--wt-space-2);
      }
      .muted {
        color: var(--wt-color-text-muted);
      }
      .inherited {
        font-style: italic;
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

  readonly #reorder = new ReorderController(
    this,
    {
      order: () => this.#visible().map((row) => row.key),
      move: (key, to) => this.#move(key, to),
      label: (key) => this.#label(this.rows.find((row) => row.key === key)?.variant),
      busy: () => this.busy,
      get reorderLabel(): string {
        return t("editor.reorder_variant");
      },
    } satisfies ReorderModel,
    { announce: () => t("action.reordered") },
  );

  /** Puts focus on a row's actions trigger. A row just drawn has a trigger only once its menu has
   * rendered, so this waits for that. */
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

  #label(variant: ProductEditorVariant | undefined): string {
    return variant?.name.trim() || t("editor.variant");
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
        ? html`<span class="amount">${priceText(variant.unitPrice)}</span>`
        : this.basePrice
          ? html`<span class="muted inherited"
              ><span class="amount">${priceText(this.basePrice)}</span></span
            >`
          : nothing;
    return html`<tr class=${error ? "invalid" : ""} data-test=${`row-${index}`}>
      <td>${this.#reorder.handle(row.key)}</td>
      <td>
        <button
          type="button"
          class="row-activate"
          data-test=${`edit-row-${index}`}
          aria-label=${`${t("action.edit")}: ${label}`}
          .disabled=${this.busy}
          @click=${(event: Event) => {
            event.stopPropagation();
            this.#emit("wt-edit", { index });
          }}
        ></button>
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
          .accessibleName=${variant.name}
          hide-label
          .checked=${variant.available}
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
    const noUnit = this.unitOptions.find((option) => option.value === null)?.label ?? "";
    return html`<wt-combobox
        class="filter"
        name="variant-status"
        label=${t("editor.variants_show")}
        search="auto"
        searchPlaceholder=${t("categories.combobox_search")}
        noResultsLabel=${t("categories.combobox_no_results")}
        .options=${[
          { value: "active", label: t("product.active_badge") },
          { value: "inactive", label: t("product.inactive_badge") },
          { value: "all", label: t("product.filter_status_all") },
        ]}
        .value=${this.status}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          this.status = event.detail.value as StatusFilter;
        }}
      ></wt-combobox>
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
                  >${t("product.price")}<wt-combobox
                    name="pricing-unit"
                    label=${t("product.unit")}
                    hide-label
                    search="auto"
                    searchPlaceholder=${t("categories.combobox_search")}
                    noResultsLabel=${t("categories.combobox_no_results")}
                    placeholder=${noUnit}
                    .options=${[
                      ...this.unitOptions.map((option) => ({
                        value: option.value ?? EACH_CHOICE,
                        label: option.label,
                      })),
                      ...(this.addUnitLabel
                        ? [{ value: ADD_UNIT, label: this.addUnitLabel, action: true as const }]
                        : []),
                    ]}
                    .value=${this.unitId ?? EACH_CHOICE}
                    .disabled=${this.busy}
                    @wt-change=${(event: CustomEvent<{ value: string }>) => {
                      event.stopPropagation();
                      const value = event.detail.value;
                      this.#emit("wt-unit-change", {
                        unitId: value === EACH_CHOICE ? null : value,
                      });
                    }}
                    @wt-combobox-action=${(event: Event) => {
                      event.stopPropagation();
                      this.#emit("wt-add-unit", {});
                    }}
                  ></wt-combobox
                ></span>
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
