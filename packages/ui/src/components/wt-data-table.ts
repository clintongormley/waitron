import { LitElement, css, html, nothing } from "lit";
import type { PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";

export interface DataTableColumn<Row> {
  key: string;
  label: string;
  // Second parameter is OPTIONAL so every existing 1-arg column definition stays assignable.
  cell: (row: Row, context?: { ancestorOnly: boolean }) => unknown;
  sortValue?: (row: Row) => string | number | null | undefined;
  searchValue?: (row: Row) => string;
  filter?: {
    label: string;
    allLabel: string;
    value: (row: Row) => string;
    options: { value: string; label: string }[];
  };
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

      th.select,
      td.select {
        width: var(--wt-tap-min);
        text-align: center;
      }

      .select input {
        width: var(--wt-space-4);
        height: var(--wt-space-4);
        cursor: pointer;
        accent-color: var(--wt-color-primary);
      }

      .message {
        margin: 0;
        color: var(--wt-color-text-muted);
      }

      .error {
        color: var(--wt-color-danger);
      }

      .table-toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-3);
        margin-bottom: var(--wt-space-3);
      }

      .table-search {
        flex: 1 1 min(100%, var(--wt-space-6));
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-full);
        background: var(--wt-color-bg);
        color: var(--wt-color-text);
        font: inherit;
      }

      .table-filters {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }

      .table-filter {
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
      }

      .tree-toggle {
        width: var(--wt-tap-min);
        height: var(--wt-tap-min);
        padding: 0;
        border: 0;
        background: transparent;
        color: inherit;
        font-size: var(--wt-font-size-lg);
        line-height: 1;
        cursor: pointer;
      }

      .tree-toggle:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }

      .tree-spacer {
        display: inline-block;
        width: var(--wt-tap-min);
      }

      .tree-cell {
        display: inline-flex;
        align-items: center;
      }
    `,
  ];

  @property({ attribute: false }) rows: readonly Row[] = [];
  @property({ attribute: false }) columns: readonly DataTableColumn<Row>[] = [];
  @property({ attribute: false }) rowKey: (row: Row, index: number) => string = (_row, index) =>
    String(index);
  @property({ attribute: false }) rowParent?: (row: Row) => string | null;
  @property({ type: Boolean }) loading = false;
  @property() loadingMessage = "Loading";
  @property() emptyMessage = "No results";
  @property() errorMessage = "";
  @property() collapseLabel = "Collapse";
  @property() expandLabel = "Expand";
  @property({ attribute: "aria-label" }) override ariaLabel = "";
  /** When set, a leading column of checkboxes (plus a select-all header box) lets the caller pick
   * rows. Selection is controlled: the caller passes `selected` and updates it on wt-selection-change.
   * Works in both flat and tree mode — the header and every visible row (at any depth) gets a box. */
  @property({ type: Boolean }) selectable = false;
  @property({ attribute: false }) selected: readonly string[] = [];
  /** Accessible name for each row's checkbox; defaults to a generic label when not supplied. */
  @property({ attribute: false }) selectionLabel: (row: Row) => string = () => "Select row";
  @property() selectAllLabel = "Select all";

  @property() sortKey: string | null = null;
  @property() sortDirection: SortDirection = "ascending";
  /** When set, a search box is drawn above the table and only rows whose text contains the typed
   * term are shown. Which text a row exposes is each column's searchValue, or its sortValue. */
  @property({ type: Boolean }) searchable = false;
  @property() searchLabel = "Search";
  /** Placeholder text for the search box; empty means it repeats `searchLabel`. */
  @property() searchPlaceholder = "";
  @property() noMatchesMessage = "No matches";
  /** When set, the tab's session storage remembers this table's sort and filter choices under this
   * key and restores them on the next visit. Search text is never persisted. */
  @property() viewKey?: string;
  @state() private searchText = "";
  /** The chosen value for each filterable column, keyed by column key; "" (or absent) means "all". */
  @state() private filterSelections: Record<string, string> = {};
  @state() private collapsed = new Set<string>();
  #restored = false;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#restoreView();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("viewKey") || (changed.has("columns") && this.viewKey && !this.#restored)) {
      this.#restoreView();
      this.#restored = true;
    }
  }

  // columns may be assigned after connectedCallback, so the restore re-runs once they arrive.
  #restoreView(): void {
    if (!this.viewKey) return;
    let raw: string | null;
    try {
      raw = sessionStorage.getItem(this.viewKey);
    } catch {
      return; // storage blocked; defaults stand
    }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as {
        sortKey?: string | null;
        sortDirection?: SortDirection;
        filters?: Record<string, string>;
      };
      // Only adopt a stored sort column the current columns still offer as sortable.
      if (
        typeof parsed.sortKey === "string" &&
        this.columns.some((c) => c.key === parsed.sortKey && c.sortValue !== undefined)
      )
        this.sortKey = parsed.sortKey;
      if (parsed.sortDirection === "ascending" || parsed.sortDirection === "descending")
        this.sortDirection = parsed.sortDirection;
      if (parsed.filters && typeof parsed.filters === "object")
        this.filterSelections = { ...parsed.filters };
    } catch {
      // A malformed store is ignored, exactly like a first visit.
    }
  }

  #persistView(): void {
    if (!this.viewKey) return;
    try {
      sessionStorage.setItem(
        this.viewKey,
        JSON.stringify({
          sortKey: this.sortKey,
          sortDirection: this.sortDirection,
          filters: this.filterSelections,
        }),
      );
    } catch {
      // The remembered view is a convenience; the table works without it.
    }
  }

  #emitSelection(next: string[]): void {
    this.dispatchEvent(
      new CustomEvent("wt-selection-change", {
        detail: { selected: next },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #toggleRow(key: string): void {
    this.#emitSelection(
      this.selected.includes(key)
        ? this.selected.filter((each) => each !== key)
        : [...this.selected, key],
    );
  }

  #toggleAll(visibleKeys: string[]): void {
    const allSelected =
      visibleKeys.length > 0 && visibleKeys.every((key) => this.selected.includes(key));
    this.#emitSelection(
      allSelected
        ? this.selected.filter((key) => !visibleKeys.includes(key))
        : [...this.selected, ...visibleKeys.filter((key) => !this.selected.includes(key))],
    );
  }

  #sort(column: DataTableColumn<Row>): void {
    if (column.sortValue === undefined) return;
    if (this.sortKey === column.key) {
      this.sortDirection = this.sortDirection === "ascending" ? "descending" : "ascending";
    } else {
      this.sortKey = column.key;
      this.sortDirection = "ascending";
    }
    this.dispatchEvent(
      new CustomEvent("wt-sort-change", {
        detail: { sortKey: this.sortKey, sortDirection: this.sortDirection },
        bubbles: true,
        composed: true,
      }),
    );
    this.#persistView();
  }

  /**
   * The comparator both the plain and tree rendering paths share: nulls sort last, numbers
   * compare numerically, everything else compares as a locale-aware string, and a tie (or an
   * unsortable column) falls back to each row's original position in `this.rows` so the sort
   * is stable and, with no sortable column selected, a no-op.
   */
  #sortByColumn(
    rows: readonly Row[],
    column: DataTableColumn<Row> | undefined,
    indexOf: ReadonlyMap<Row, number>,
  ): Row[] {
    if (column?.sortValue === undefined) return [...rows];
    const direction = this.sortDirection === "ascending" ? 1 : -1;
    return [...rows]
      .map((row) => ({ row, index: indexOf.get(row)!, value: column.sortValue!(row) }))
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

  /** The text a row exposes to the search box: every column's searchValue, or its sortValue as a
   * fallback, joined so a term can match any column. */
  #searchHaystack(row: Row): string {
    return this.columns
      .map((column) =>
        column.searchValue
          ? column.searchValue(row)
          : column.sortValue
            ? String(column.sortValue(row) ?? "")
            : "",
      )
      .join(" ")
      .toLocaleLowerCase();
  }

  #passesSearch(row: Row): boolean {
    const term = this.searchText.trim().toLocaleLowerCase();
    return term === "" || this.#searchHaystack(row).includes(term);
  }

  /** A row passes the filters only if every active dropdown (a non-"all" selection) matches it. */
  #passesFilters(row: Row): boolean {
    for (const column of this.columns) {
      if (!column.filter) continue;
      const selected = this.filterSelections[column.key] ?? "";
      if (selected !== "" && column.filter.value(row) !== selected) return false;
    }
    return true;
  }

  /** The rows left after the toolbar: every active filter (AND), then the search term. The single
   * choke point every render path funnels through, so flat and tree mode narrow identically. */
  #visibleRows(): readonly Row[] {
    if (!this.searchable) return this.rows;
    return this.rows.filter((row) => this.#passesFilters(row) && this.#passesSearch(row));
  }

  #sortedRows(rows: readonly Row[]): Row[] {
    const column = this.columns.find(
      (candidate) => candidate.key === this.sortKey && candidate.sortValue !== undefined,
    );
    const indexOf = new Map<Row, number>();
    rows.forEach((row, index) => indexOf.set(row, index));
    return this.#sortByColumn(rows, column, indexOf);
  }

  /** In tree mode a matching row's ancestors must stay so it is not shown as a false top-level row.
   * Returns the rows to render plus the set of keys present only as an ancestor of a match. */
  #treeVisible(): { rows: readonly Row[]; ancestorOnly: ReadonlySet<string> } {
    const parentOf = this.rowParent!;
    const indexOf = new Map<Row, number>();
    this.rows.forEach((row, i) => indexOf.set(row, i));
    const keyOf = (row: Row) => this.rowKey(row, indexOf.get(row)!);
    const matched = new Set(this.#visibleRows().map(keyOf));
    const included = new Set(matched);
    for (const row of this.rows) {
      if (!matched.has(keyOf(row))) continue;
      const visited = new Set<string>();
      let current: Row | undefined = row;
      let parentKey = current ? parentOf(current) : null;
      while (parentKey && !visited.has(parentKey)) {
        visited.add(parentKey);
        included.add(parentKey);
        current = this.rows.find((r) => keyOf(r) === parentKey);
        parentKey = current ? parentOf(current) : null;
      }
    }
    const ancestorOnly = new Set([...included].filter((key) => !matched.has(key)));
    return { rows: this.rows.filter((row) => included.has(keyOf(row))), ancestorOnly };
  }

  #treeRows(
    rows: readonly Row[],
  ): { row: Row; key: string; depth: number; hasChildren: boolean }[] {
    const keyOf = (row: Row, i: number) => this.rowKey(row, i);
    const parentOf = this.rowParent!;
    const indexOf = new Map<Row, number>();
    rows.forEach((r, i) => indexOf.set(r, i));
    const present = new Set(rows.map((r) => keyOf(r, indexOf.get(r)!)));
    // group children by parent key ("" = top level, including orphans whose parent is absent)
    const childrenByParent = new Map<string, Row[]>();
    for (const row of rows) {
      const p = parentOf(row);
      const bucket = p !== null && present.has(p) ? p : "";
      (childrenByParent.get(bucket) ?? childrenByParent.set(bucket, []).get(bucket)!).push(row);
    }
    const column = this.columns.find((c) => c.key === this.sortKey && c.sortValue !== undefined);
    const out: { row: Row; key: string; depth: number; hasChildren: boolean }[] = [];
    const walk = (parentKey: string, depth: number) => {
      const siblings = this.#sortByColumn(childrenByParent.get(parentKey) ?? [], column, indexOf);
      for (const row of siblings) {
        const key = keyOf(row, indexOf.get(row)!);
        const hasChildren = (childrenByParent.get(key) ?? []).length > 0;
        out.push({ row, key, depth, hasChildren });
        if (hasChildren && !this.collapsed.has(key)) walk(key, depth + 1);
      }
    };
    walk("", 0);
    return out;
  }

  #toggle(key: string): void {
    const next = new Set(this.collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.collapsed = next;
  }

  #selectionState(visibleKeys: string[]): { allSelected: boolean; someSelected: boolean } {
    const allSelected =
      visibleKeys.length > 0 && visibleKeys.every((key) => this.selected.includes(key));
    const someSelected = visibleKeys.some((key) => this.selected.includes(key));
    return { allSelected, someSelected };
  }

  /**
   * The header both rendering paths share. The `role=` attributes are the implicit roles of
   * `thead`, `tr` and `th`, so stating them costs nothing on the plain table and keeps the tree's
   * `role="treegrid"` complete — axe wants every level named once the table's own role is
   * overridden.
   */
  #renderHead(visibleKeys: string[]) {
    const { allSelected, someSelected } = this.#selectionState(visibleKeys);
    return html`
      <thead role="rowgroup">
        <tr role="row">
          ${
            this.selectable
              ? html`<th scope="col" role="columnheader" class="select">
                  <input
                    type="checkbox"
                    data-test="select-all"
                    aria-label=${this.selectAllLabel}
                    .checked=${allSelected}
                    .indeterminate=${someSelected && !allSelected}
                    @change=${(event: Event) => {
                      event.stopPropagation();
                      this.#toggleAll(visibleKeys);
                    }}
                  />
                </th>`
              : nothing
          }
          ${this.columns.map(
            (column) => html`
              <th
                role="columnheader"
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
    `;
  }

  /** The per-row checkbox cell both rendering paths share; `role="gridcell"` only in tree mode,
   * where the table's own role is overridden to `treegrid` and every cell needs one. */
  #renderSelectCell(key: string, row: Row, isTree: boolean) {
    if (!this.selectable) return nothing;
    return html`<td class="select" role=${isTree ? "gridcell" : nothing}>
      <input
        type="checkbox"
        data-test=${`select-${key}`}
        aria-label=${this.selectionLabel(row)}
        .checked=${this.selected.includes(key)}
        @change=${(event: Event) => {
          event.stopPropagation();
          this.#toggleRow(key);
        }}
      />
    </td>`;
  }

  #renderToolbar() {
    if (!this.searchable) return nothing;
    return html`<div class="table-toolbar">
      <input
        class="table-search"
        type="search"
        autocomplete="off"
        aria-label=${this.searchLabel}
        placeholder=${this.searchPlaceholder || this.searchLabel}
        .value=${this.searchText}
        @input=${(event: Event) => {
          this.searchText = (event.target as HTMLInputElement).value;
        }}
      />
      ${
        this.columns.some((column) => column.filter)
          ? html`<div class="table-filters">
              ${this.columns.map((column) =>
                column.filter
                  ? html`<select
                      class="table-filter"
                      data-filter=${column.key}
                      aria-label=${column.filter.label}
                      .value=${this.filterSelections[column.key] ?? ""}
                      @change=${(event: Event) => {
                        this.filterSelections = {
                          ...this.filterSelections,
                          [column.key]: (event.target as HTMLSelectElement).value,
                        };
                        this.#persistView();
                      }}
                    >
                      <option value="">${column.filter.allLabel}</option>
                      ${column.filter.options.map(
                        (option) => html`<option value=${option.value}>${option.label}</option>`,
                      )}
                    </select>`
                  : nothing,
              )}
            </div>`
          : nothing
      }
    </div>`;
  }

  override render() {
    if (this.loading) return html`<p class="message" role="status">${this.loadingMessage}</p>`;
    if (this.errorMessage !== "")
      return html`<p class="message error" role="alert">${this.errorMessage}</p>`;
    const visible = this.#visibleRows();
    if (this.rows.length === 0)
      return html`${this.#renderToolbar()}
        <p class="message" role="status">${this.emptyMessage}</p>`;

    const label = this.ariaLabel || undefined;
    const isTree = this.rowParent !== undefined;
    // In tree mode kept ancestors keep a deep match on screen, so "no matches" counts the rows the
    // tree actually renders, not just the ones that matched.
    const treeVisible = isTree ? this.#treeVisible() : undefined;
    const renderedCount = isTree ? treeVisible!.rows.length : visible.length;
    if (renderedCount === 0)
      return html`${this.#renderToolbar()}
        <p class="message" role="status">${this.noMatchesMessage}</p>`;

    if (!isTree) {
      const sorted = this.#sortedRows(visible);
      const visibleKeys = sorted.map((row, index) => this.rowKey(row, index));
      return html`
        ${this.#renderToolbar()}
        <div class="scroll" tabindex="0" role="region" aria-label=${label ?? nothing}>
          <table>
            ${this.#renderHead(visibleKeys)}
            <tbody>
              ${sorted.map((row, index) => {
                const key = this.rowKey(row, index);
                return html`
                  <tr data-row-key=${key}>
                    ${this.#renderSelectCell(key, row, false)}
                    ${this.columns.map(
                      (column) => html`
                        <td data-align=${column.align ?? "start"}>
                          ${column.cell(row, { ancestorOnly: false })}
                        </td>
                      `,
                    )}
                  </tr>
                `;
              })}
            </tbody>
          </table>
        </div>
      `;
    }

    const { rows: treeRows, ancestorOnly } = treeVisible!;
    const entries = this.#treeRows(treeRows);
    const visibleKeys = entries.map((e) => e.key);
    return html`
      ${this.#renderToolbar()}
      <div class="scroll" tabindex="0" role="region" aria-label=${label ?? nothing}>
        <table role="treegrid">
          ${this.#renderHead(visibleKeys)}
          <tbody role="rowgroup">
            ${entries.map(({ row, key, depth, hasChildren }) => {
              const expanded = !this.collapsed.has(key);
              const cellContext = { ancestorOnly: ancestorOnly.has(key) };
              return html`<tr
                data-row-key=${key}
                role="row"
                aria-level=${depth + 1}
                aria-expanded=${hasChildren ? String(expanded) : nothing}
              >
                ${this.#renderSelectCell(key, row, true)}
                ${this.columns.map(
                  (column, ci) =>
                    html`<td role="gridcell" data-align=${column.align ?? "start"}>
                      ${
                        ci === 0
                          ? html`<span
                              class="tree-cell"
                              style=${`padding-inline-start: calc(${depth} * var(--wt-space-4))`}
                            >
                              ${
                                hasChildren
                                  ? html`<button
                                      class="tree-toggle"
                                      aria-label=${expanded ? this.collapseLabel : this.expandLabel}
                                      @click=${() => this.#toggle(key)}
                                    >
                                      ${expanded ? "▾" : "▸"}
                                    </button>`
                                  : html`<span class="tree-spacer"></span>`
                              }
                              ${column.cell(row, cellContext)}
                            </span>`
                          : column.cell(row, cellContext)
                      }
                    </td>`,
                )}
              </tr>`;
            })}
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
