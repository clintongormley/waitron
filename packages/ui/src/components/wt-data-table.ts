import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";

export interface DataTableColumn<Row> {
  key: string;
  label: string;
  cell: (row: Row) => unknown;
  sortValue?: (row: Row) => string | number | null | undefined;
  align?: "start" | "end";
}

type SortDirection = "ascending" | "descending";

@customElement("wt-data-table")
export class WtDataTable<Row = unknown> extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }

      .scroll {
        max-width: 100%;
        overflow-x: auto;
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
      }

      .scroll:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }

      table {
        width: 100%;
        min-width: max-content;
        border-collapse: collapse;
        color: var(--wt-color-text);
        background: var(--wt-color-surface);
      }

      th,
      td {
        padding: var(--wt-space-3);
        border-bottom: 1px solid var(--wt-color-border);
        text-align: start;
        vertical-align: middle;
      }

      th {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
      }

      th[data-align="end"],
      td[data-align="end"] {
        text-align: end;
      }

      tbody tr:last-child td {
        border-bottom: 0;
      }

      tbody tr:hover {
        background: var(--wt-color-surface-raised);
      }

      .sort {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-1);
        padding: 0;
        border: 0;
        color: inherit;
        background: transparent;
        font: inherit;
        cursor: pointer;
      }

      .sort:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }

      .indicator {
        width: var(--wt-font-size-md);
        text-align: center;
      }

      .message {
        margin: 0;
        color: var(--wt-color-text-muted);
      }

      .error {
        color: var(--wt-color-danger);
      }
    `,
  ];

  @property({ attribute: false }) rows: readonly Row[] = [];
  @property({ attribute: false }) columns: readonly DataTableColumn<Row>[] = [];
  @property({ attribute: false }) rowKey: (row: Row, index: number) => string = (_row, index) =>
    String(index);
  @property({ type: Boolean }) loading = false;
  @property() loadingMessage = "Loading";
  @property() emptyMessage = "No results";
  @property() errorMessage = "";
  @property({ attribute: "aria-label" }) override ariaLabel = "";

  @state() private sortKey: string | null = null;
  @state() private sortDirection: SortDirection = "ascending";

  #sort(column: DataTableColumn<Row>): void {
    if (column.sortValue === undefined) return;
    if (this.sortKey === column.key) {
      this.sortDirection = this.sortDirection === "ascending" ? "descending" : "ascending";
      return;
    }
    this.sortKey = column.key;
    this.sortDirection = "ascending";
  }

  #sortedRows(): Row[] {
    const column = this.columns.find(
      (candidate) => candidate.key === this.sortKey && candidate.sortValue !== undefined,
    );
    if (column?.sortValue === undefined) return [...this.rows];
    const direction = this.sortDirection === "ascending" ? 1 : -1;
    return this.rows
      .map((row, index) => ({ row, index, value: column.sortValue!(row) }))
      .sort((left, right) => {
        if (left.value == null && right.value == null) return left.index - right.index;
        if (left.value == null) return 1;
        if (right.value == null) return -1;
        const compared =
          typeof left.value === "number" && typeof right.value === "number"
            ? left.value - right.value
            : String(left.value).localeCompare(String(right.value), undefined, {
                numeric: true,
                sensitivity: "base",
              });
        return compared === 0 ? left.index - right.index : compared * direction;
      })
      .map(({ row }) => row);
  }

  override render() {
    if (this.loading) return html`<p class="message" role="status">${this.loadingMessage}</p>`;
    if (this.errorMessage !== "")
      return html`<p class="message error" role="alert">${this.errorMessage}</p>`;
    if (this.rows.length === 0)
      return html`<p class="message" role="status">${this.emptyMessage}</p>`;

    const label = this.ariaLabel || undefined;
    return html`
      <div class="scroll" tabindex="0" role="region" aria-label=${label ?? nothing}>
        <table aria-label=${label ?? nothing}>
          <thead>
            <tr>
              ${this.columns.map(
                (column) => html`
                  <th
                    scope="col"
                    data-align=${column.align ?? "start"}
                    aria-sort=${
                      column.sortValue === undefined
                        ? nothing
                        : this.sortKey === column.key
                          ? this.sortDirection
                          : "none"
                    }
                  >
                    ${
                      column.sortValue === undefined
                        ? column.label
                        : html`<button
                            class="sort"
                            data-sort=${column.key}
                            @click=${() => this.#sort(column)}
                          >
                            ${column.label}<span class="indicator" aria-hidden="true"
                              >${
                                this.sortKey === column.key
                                  ? this.sortDirection === "ascending"
                                    ? "▲"
                                    : "▼"
                                  : ""
                              }</span
                            >
                          </button>`
                    }
                  </th>
                `,
              )}
            </tr>
          </thead>
          <tbody>
            ${this.#sortedRows().map(
              (row, index) => html`
                <tr data-row-key=${this.rowKey(row, index)}>
                  ${this.columns.map(
                    (column) => html`
                      <td data-align=${column.align ?? "start"}>${column.cell(row)}</td>
                    `,
                  )}
                </tr>
              `,
            )}
          </tbody>
        </table>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-data-table": WtDataTable;
  }
}
