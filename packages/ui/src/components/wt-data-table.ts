import { LitElement, css, html, nothing } from "lit";
import type { PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { baseStyles, selectStyles } from "../base-styles.js";

export interface DataTableColumn<Row> {
  key: string;
  label: string;
  cell: (row: Row, context: { ancestorOnly: boolean }) => unknown;
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
    selectStyles,
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

      tr.clickable {
        position: relative;
      }

      tr.clickable:hover td,
      tr.clickable:focus-within td {
        background: var(--wt-color-surface-raised);
        cursor: pointer;
      }

      /* The stretched activator covers the whole row so a mouse user can click anywhere; it is a
         real focusable button so keyboard/AT users tab to it and Enter/Space activate the row. It
         sits at the base layer… */
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

      .row-activate:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }

      /* …and every other interactive control in a clickable row sits ABOVE it, so a click on the
         Edit/Delete menu or the selection checkbox never activates the row. */
      tr.clickable td :is(button, a, input, select, label, wt-row-actions):not(.row-activate) {
        position: relative;
        z-index: 1;
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

      /* The basis is the narrowest the search box may be while sharing its line with the filters;
         any narrower and the filters wrap below it and the search box fills its own line. A media
         or container query cannot read a token, so the wrap is sized by the controls, not by a
         breakpoint. */
      .table-search {
        flex: 1 1 calc(var(--wt-tap-min) * 8);
        min-width: 0;
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
        max-width: 100%;
      }

      .table-filter {
        width: auto;
        max-width: 100%;
        min-height: var(--wt-tap-min);
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
  /** When set (plain, non-tree tables only), each row becomes activatable: a stretched, focusable
   * button covers the row and calls this on click. Per-row controls (the selection checkbox, the
   * Edit/Delete menu) sit above the activator, so they are never swallowed. A tree table ignores it. */
  @property({ attribute: false }) rowClick?: (row: Row) => void;
  /** The accessible name for each row's activator button; defaults to a generic label. */
  @property({ attribute: false }) rowClickLabel: (row: Row) => string = () => "Open row";
  @property({ type: Boolean }) loading = false;
  @property() loadingMessage = "Loading";
  @property() emptyMessage = "No results";
  @property() errorMessage = "";
  @property() collapseLabel = "Collapse";
  @property() expandLabel = "Expand";
  /** In tree mode, seed each branch as collapsed the first time that branch appears. A person can
   * still expand it normally, and later row refreshes do not collapse it again. */
  @property({ type: Boolean }) initiallyCollapsed = false;
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
   * term are shown. Which text a row exposes is each column's searchValue, or its sortValue. A
   * column's filter dropdown is drawn whether or not this is set. */
  @property({ type: Boolean }) searchable = false;
  @property() searchLabel = "Search";
  /** Placeholder text for the search box; empty means it repeats `searchLabel`. */
  @property() searchPlaceholder = "";
  @property() noMatchesMessage = "No matches";
  /** When set, the tab's session storage remembers this table's sort and filter choices under this
   * key and restores them on the next visit. Search text is never persisted. */
  @property() viewKey?: string;
  @state() private searchText = "";
  /** Every filter choice, chosen or restored, keyed by column key; an absent key means "all". A
   * choice filters rows only while its column offers it (see #activeFilter), and #judgeFilters
   * removes one its column's options no longer include. */
  @state() private filterSelections: Record<string, string> = {};
  @state() private collapsed = new Set<string>();
  private readonly seededBranches = new Set<string>();
  #restored = false;

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (
      this.initiallyCollapsed &&
      this.rowParent &&
      (changed.has("rows") || changed.has("rowParent") || changed.has("initiallyCollapsed"))
    ) {
      const keys = new Set(this.rows.map((row, index) => this.rowKey(row, index)));
      const next = new Set(this.collapsed);
      let seeded = false;
      for (const row of this.rows) {
        const parent = this.rowParent(row);
        if (parent === null || !keys.has(parent) || this.seededBranches.has(parent)) continue;
        this.seededBranches.add(parent);
        next.add(parent);
        seeded = true;
      }
      if (seeded) this.collapsed = next;
    }
    if (changed.has("viewKey")) this.#restored = false;
    if (!changed.has("viewKey") && !changed.has("columns")) return;
    this.#restoreView();
    if (this.#judgeFilters()) this.#persistView();
  }

  /** Reads the stored view once there are columns to check it against. A stored sort is adopted
   * only if a current column can sort by it, and its direction only together with that column.
   * Stored filter strings join filterSelections, to be judged like any other choice. */
  #restoreView(): void {
    if (!this.viewKey || this.columns.length === 0) return;
    if (!this.#restored) {
      this.#restored = true;
      let raw: string | null;
      try {
        raw = sessionStorage.getItem(this.viewKey);
      } catch {
        return; // storage blocked; defaults stand
      }
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as {
          sortKey?: unknown;
          sortDirection?: unknown;
          filters?: unknown;
        };
        if (
          typeof parsed.sortKey === "string" &&
          this.columns.some((c) => c.key === parsed.sortKey && c.sortValue !== undefined)
        ) {
          this.sortKey = parsed.sortKey;
          if (parsed.sortDirection === "ascending" || parsed.sortDirection === "descending")
            this.sortDirection = parsed.sortDirection;
        }
        if (parsed.filters && typeof parsed.filters === "object") {
          const stored = Object.entries(parsed.filters as Record<string, unknown>).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "",
          );
          this.filterSelections = { ...this.filterSelections, ...Object.fromEntries(stored) };
        }
      } catch {
        // A malformed store is ignored, exactly like a first visit.
      }
    }
  }

  /** The options a column's filter currently offers, or undefined while it offers none: the column
   * is absent, has no filter, or has an empty list (a consumer still loading the data behind it). */
  #offered(key: string): { value: string }[] | undefined {
    const options = this.columns.find((column) => column.key === key)?.filter?.options;
    return options && options.length > 0 ? options : undefined;
  }

  /** Removes every choice whose column offers options that do not include it, and reports whether it
   * removed any. A choice whose column offers none waits, kept and stored but not applied, until the
   * column offers a non-empty list to judge it by. */
  #judgeFilters(): boolean {
    const kept = Object.entries(this.filterSelections).filter(([key, value]) => {
      const options = this.#offered(key);
      return !options || options.some((option) => option.value === value);
    });
    if (kept.length === Object.keys(this.filterSelections).length) return false;
    this.filterSelections = Object.fromEntries(kept);
    return true;
  }

  /** The choice that narrows rows for this column, or "" when there is none or it is waiting. */
  #activeFilter(column: DataTableColumn<Row>): string {
    return this.#offered(column.key) ? (this.filterSelections[column.key] ?? "") : "";
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
    const term = this.searchable ? this.searchText.trim().toLocaleLowerCase() : "";
    return term === "" || this.#searchHaystack(row).includes(term);
  }

  /** The rows left after the toolbar: every active filter (AND), then the search term. The single
   * choke point every render path funnels through, so flat and tree mode narrow identically. */
  #visibleRows(): readonly Row[] {
    const active = this.columns.flatMap((column) => {
      const selected = this.#activeFilter(column);
      return selected === "" ? [] : [{ value: column.filter!.value, selected }];
    });
    return this.rows.filter(
      (row) =>
        active.every(({ value, selected }) => value(row) === selected) && this.#passesSearch(row),
    );
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
   * Takes the rows that passed the toolbar and returns the rows to render plus the set of keys
   * present only as an ancestor of a match. */
  #treeVisible(visible: readonly Row[]): {
    rows: readonly Row[];
    ancestorOnly: ReadonlySet<string>;
  } {
    const parentOf = this.rowParent!;
    const keys = this.rows.map((row, index) => this.rowKey(row, index));
    const keyByRow = new Map<Row, string>();
    const rowByKey = new Map<string, Row>();
    this.rows.forEach((row, index) => {
      keyByRow.set(row, keys[index]!);
      if (!rowByKey.has(keys[index]!)) rowByKey.set(keys[index]!, row);
    });
    const matched = new Set(visible.map((row) => keyByRow.get(row)!));
    const included = new Set(matched);
    this.rows.forEach((row, index) => {
      if (!matched.has(keys[index]!)) return;
      const visited = new Set<string>();
      let parentKey = parentOf(row);
      while (parentKey && !visited.has(parentKey)) {
        visited.add(parentKey);
        included.add(parentKey);
        const parent = rowByKey.get(parentKey);
        parentKey = parent ? parentOf(parent) : null;
      }
    });
    const ancestorOnly = new Set([...included].filter((key) => !matched.has(key)));
    return { rows: this.rows.filter((_row, index) => included.has(keys[index]!)), ancestorOnly };
  }

  #treeRows(
    rows: readonly Row[],
    forcedOpen: ReadonlySet<string> = new Set(),
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
        if (hasChildren && (!this.collapsed.has(key) || forcedOpen.has(key))) walk(key, depth + 1);
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
                        @click=${(event: Event) => {
                          event.stopPropagation();
                          this.#sort(column);
                        }}
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
    const hasFilters = this.columns.some((column) => column.filter);
    if (!this.searchable && !hasFilters) return nothing;
    return html`<div class="table-toolbar">
      ${
        this.searchable
          ? html`<input
              class="table-search"
              type="search"
              name="search"
              autocomplete="off"
              aria-label=${this.searchLabel}
              placeholder=${this.searchPlaceholder || this.searchLabel}
              .value=${this.searchText}
              @input=${(event: Event) => {
                this.searchText = (event.target as HTMLInputElement).value;
              }}
            />`
          : nothing
      }
      ${
        hasFilters
          ? html`<div class="table-filters">
              ${this.columns.map((column) => {
                const active = this.#activeFilter(column);
                return column.filter
                  ? html`<select
                      class="table-filter"
                      name=${`${column.key}-filter`}
                      data-filter=${column.key}
                      aria-label=${column.filter.label}
                      @change=${(event: Event) => {
                        const next = { ...this.filterSelections };
                        const value = (event.target as HTMLSelectElement).value;
                        if (value === "") delete next[column.key];
                        else next[column.key] = value;
                        this.filterSelections = next;
                        this.#persistView();
                      }}
                    >
                      <option value="" .selected=${active === ""}>${column.filter.allLabel}</option>
                      ${column.filter.options.map(
                        (option) =>
                          html`<option value=${option.value} .selected=${active === option.value}>
                            ${option.label}
                          </option>`,
                      )}
                    </select>`
                  : nothing;
              })}
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
    const treeVisible = isTree ? this.#treeVisible(visible) : undefined;
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
                  <tr
                    data-row-key=${key}
                    class=${classMap({ clickable: this.rowClick !== undefined })}
                  >
                    ${this.#renderSelectCell(key, row, false)}
                    ${this.columns.map(
                      (column, ci) => html`
                        <td data-align=${column.align ?? "start"}>
                          ${
                            ci === 0 && this.rowClick !== undefined
                              ? html`<button
                                    class="row-activate"
                                    aria-label=${this.rowClickLabel(row)}
                                    @click=${() => this.rowClick!(row)}
                                  ></button
                                  >${column.cell(row, { ancestorOnly: false })}`
                              : column.cell(row, { ancestorOnly: false })
                          }
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
    const entries = this.#treeRows(treeRows, ancestorOnly);
    const visibleKeys = entries.map((e) => e.key);
    return html`
      ${this.#renderToolbar()}
      <div class="scroll" tabindex="0" role="region" aria-label=${label ?? nothing}>
        <table role="treegrid">
          ${this.#renderHead(visibleKeys)}
          <tbody role="rowgroup">
            ${entries.map(({ row, key, depth, hasChildren }) => {
              const expanded = !this.collapsed.has(key) || ancestorOnly.has(key);
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
