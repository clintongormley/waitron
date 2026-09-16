import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import { reorder } from "./reorder.js";
import { ReorderController, type ReorderModel } from "./reorder-table.js";
import { priceLabel } from "./form-fields.js";
import type { ProductEditorVariant } from "../api/client.js";
import { t } from "../i18n/t.js";

/** One rendered row: the variant and the key that follows it while the table is on screen. */
interface VariantRow {
  key: string;
  variant: ProductEditorVariant;
}

/**
 * The product editor's list of variants — a plain `<table>` this widget owns, deliberately NOT
 * `wt-data-table`: the rows are a draft being edited in place, not an administrative collection to
 * sort and search.
 *
 * The host owns the variants. Every row action leaves as an event carrying the row's INDEX, which
 * is the same index in the array the host handed over. A reorder is the one action the table also
 * shows immediately: the row follows the key or the finger, and `wt-reorder` tells the host to make
 * the same move in its draft. A host that ignores that event therefore drifts out of step with what
 * is on screen.
 *
 * The name shown is the STAFF name. The customer-facing name belongs to a receipt or a menu, and
 * the fallback between them belongs to `packages/catalogue/src/product-presentation.ts`.
 */
@customElement("dashboard-variant-table")
export class VariantTable extends LitElement {
  static override styles = [
    ReorderController.styles,
    css`
      :host {
        display: block;
      }
      /* The table may be wider than the form around it; its own scroller keeps the page from
         scrolling sideways at phone width. */
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
        font-weight: var(--wt-font-weight-bold);
      }
      /* The name is the widest cell; capping it keeps the switch and the row menu on screen at
         phone width instead of pushing the row into a horizontal scroll. */
      td:nth-child(2) {
        max-width: var(--wt-cell-name-max-width);
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
  /** The product's pricing unit, named once in the price column's header. */
  @property() unitLabel = "";
  @property({ type: Boolean }) busy = false;
  /** A problem with one row, keyed by that row's index in `variants`. The host validates; this
   * only shows what it reports, beside the row it belongs to. */
  @property({ attribute: false }) errors: Record<number, string> = {};
  /** The rows in display order. A reorder rewrites this before the host confirms it. */
  @state() private rows: VariantRow[] = [];
  #nextKey = 0;

  readonly #reorder = new ReorderController(this, {
    order: () => this.rows.map((row) => row.key),
    move: (key, to) => this.#move(key, to),
    label: (key) => this.#label(this.rows.find((row) => row.key === key)?.variant),
    busy: () => this.busy,
    get reorderLabel(): string {
      return t("editor.reorder_variant");
    },
  } satisfies ReorderModel);

  /** Puts focus on a row's actions trigger — the way into the window where that variant's own
   * fields are edited, and the only control on the row that is not itself an edit. The Edit button
   * behind it cannot take focus while the menu is closed. */
  focusRow(index: number): void {
    this.shadowRoot?.querySelector<HTMLElement>(`[data-test="actions-${index}"]`)?.focus();
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has("variants")) return;
    // Keys follow the variant OBJECT, so the array coming back from a host that applied a reorder
    // carries the same keys in the same order — which is what keeps a keyboard user's focus on the
    // row they just moved. A host that rebuilds its variants mints new keys and merely loses that
    // focus; it never moves the wrong row, because a key that is gone matches no handle.
    const previous = new Map(this.rows.map((row) => [row.variant, row.key]));
    this.rows = this.variants.map((variant) => {
      const key = previous.get(variant);
      if (key === undefined) return { key: `variant-${++this.#nextKey}`, variant };
      previous.delete(variant);
      return { key, variant };
    });
  }

  /** The staff name, or a generic one so a nameless draft row still has something to be called. */
  #label(variant: ProductEditorVariant | undefined): string {
    return variant?.name.trim() || t("editor.variant");
  }

  #emit(name: string, detail: Record<string, unknown>): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  #move(key: string, to: number): void {
    const from = this.rows.findIndex((row) => row.key === key);
    // A key that no longer names a row, or a move that lands where it started, would otherwise be
    // reported to the host as a move — one of them from index -1.
    if (from < 0 || from === to) return;
    this.rows = reorder(this.rows, from, to);
    this.#emit("wt-reorder", { from, to });
  }

  #row(row: VariantRow, index: number) {
    const label = this.#label(row.variant);
    const error = this.errors[index] ?? "";
    return html`<tr class=${error ? "invalid" : ""} data-test=${`row-${index}`}>
      <td>${this.#reorder.handle(row.key)}</td>
      <td>
        ${label}
        ${error ? html`<p class="error" data-test=${`error-${index}`}>${error}</p>` : nothing}
      </td>
      <td>${row.variant.unitPrice}</td>
      <td>
        <wt-switch
          name=${`available-${index}`}
          data-test=${`available-${index}`}
          label=${t("editor.available")}
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
          ><wt-button
            variant="secondary"
            data-test=${`edit-${index}`}
            .disabled=${this.busy}
            @click=${(event: Event) => {
              event.stopPropagation();
              if (this.busy) return;
              this.#emit("wt-edit", { index });
            }}
            >${t("action.edit")}</wt-button
          ><wt-button
            variant="danger"
            data-test=${`remove-${index}`}
            .disabled=${this.busy}
            @click=${(event: Event) => {
              event.stopPropagation();
              if (this.busy) return;
              this.#emit("wt-remove", { index });
            }}
            >${t("action.remove")}</wt-button
          ></wt-row-actions
        >
      </td>
    </tr>`;
  }

  override render() {
    return html`<div class="wrap">
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
              <th scope="col">${priceLabel(this.unitLabel)}</th>
              <th scope="col">${t("editor.available")}</th>
              <th scope="col">
                <span class="visually-hidden">${t("editor.variant_actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            ${repeat(
              this.rows,
              (row) => row.key,
              (row, index) => this.#row(row, index),
            )}
          </tbody>
        </table>
      </div>
      ${this.#reorder.liveRegion()}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-variant-table": VariantTable;
  }
}
