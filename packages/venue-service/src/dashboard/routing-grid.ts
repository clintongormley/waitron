import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { styleMap } from "lit/directives/style-map.js";
import { currentLocale } from "@waitron/dashboard-kit";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import {
  cellKey,
  followFallbacks,
  rowKey,
  targetKey,
  zoneKey,
  selectRoutingCell,
  selectionRulesFromModel,
  type CellAddress,
  type GridCategory,
  type GridProduct,
  type GridRow,
  type RouteTarget,
  type RoutingRow,
  type RoutingRules,
  type RoutingSelectionRules,
  type RoutingView,
  type SelectedCell,
} from "../routing.js";
import { format } from "./hours-view.js";
import type { PeriodLine, RoutingModelCell } from "../routing-types.js";
import "./routing-cell-editor.js";
import type { RoutingCellEditorCell, RoutingCellSave } from "./routing-cell-editor.js";
import {
  cellPeriodLines,
  collapseAll,
  collapseCategory,
  expandAll,
  expandCategory,
  pruneExpanded,
  rowInModel,
  visibleRoutingRows,
  type CellPeriodLines,
} from "./routing-grid-model.js";
import { t } from "./strings.js";

/** A refused write. `code` and `params` reach the cell's editor while it is open. */
export type RoutingRefusal = {
  address: CellAddress;
  message: string;
  code?: string;
  params?: Record<string, unknown>;
};
/**
 * `periods` is present when the cell had lines or is saved with some; without it the server keeps
 * the stored lines, which are then none.
 */
export type RoutingCellChange = {
  address: CellAddress;
  target: RouteTarget | null;
  periods?: PeriodLine[];
};
/** A refused Make default, for the default cell's editor. */
export type RoutingDefaultRefusal = {
  code: string;
  params?: Record<string, unknown>;
  message: string;
};
/** A choice the host has not saved yet, shown at its address in place of the saved value. */
export type RoutingPending = RoutingCellChange;

type Zone = { id: string | null; name: string; departmentId?: string | null };

const sameAddress = (a: CellAddress, b: CellAddress) => cellKey(a) === cellKey(b);

@customElement("venue-routing-grid")
export class RoutingGrid extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        --routing-first: calc(var(--wt-cell-name-max-width) * 1.5);
        --routing-zone: calc(var(--wt-space-6) * 5);
        display: block;
        min-width: 0;
        container-type: inline-size;
      }
      @container (max-width: 40rem) {
        .scroll {
          --routing-first: calc(var(--wt-space-6) * 3);
          --routing-zone: calc(var(--wt-space-6) * 3.25);
          --routing-pad: var(--wt-space-1);
        }
      }
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
        margin-block-end: var(--wt-space-3);
      }
      .scroll {
        overflow-x: auto;
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
      }
      /* Fixed layout: a long warning or label wraps inside its column instead of widening it. */
      table {
        table-layout: fixed;
        border-collapse: separate;
        border-spacing: 0;
        inline-size: max(
          100%,
          calc(var(--routing-first) + var(--routing-zone) * var(--routing-zones))
        );
      }
      th,
      td {
        padding: var(--routing-pad, var(--wt-space-2));
        border-block-end: 1px solid var(--wt-color-border);
        text-align: start;
        vertical-align: top;
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        overflow-wrap: anywhere;
      }
      thead th {
        font-weight: var(--wt-font-weight-medium);
        font-size: var(--wt-font-size-sm);
      }
      thead th:first-child {
        inline-size: var(--routing-first);
      }
      th:first-child {
        position: sticky;
        inset-inline-start: 0;
        z-index: 1;
        border-inline-end: 1px solid var(--wt-color-border);
      }
      tbody th {
        font-weight: var(--wt-font-weight-normal);
        padding-inline-start: calc(
          var(--routing-pad, var(--wt-space-2)) + var(--wt-space-4) * var(--routing-depth, 0)
        );
      }
      tbody tr.heading th {
        font-weight: var(--wt-font-weight-medium);
        background: var(--wt-color-surface-sunken);
      }
      .toggle {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-1);
        min-block-size: var(--wt-tap-min);
        padding: 0;
        border: 0;
        background: none;
        color: inherit;
        font: inherit;
        text-align: start;
        cursor: pointer;
      }
      .arrow {
        display: inline-flex;
        justify-content: center;
        inline-size: var(--wt-space-5);
        font-size: var(--wt-font-size-xl);
        line-height: 1;
      }
      .toggle:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      .path,
      .hidden,
      .note {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .label {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        column-gap: var(--wt-space-1);
        min-block-size: var(--wt-field-height);
      }
      .hidden {
        flex-basis: 100%;
      }
      .note,
      .warning,
      .repair {
        display: block;
        margin: var(--wt-space-1) 0 0;
        font-size: var(--wt-font-size-sm);
      }
      .warning,
      .repair {
        color: var(--wt-color-warning);
      }
      wt-form-actions {
        margin-block-start: var(--wt-space-2);
      }
      .cell {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: var(--wt-space-1);
        inline-size: 100%;
        min-block-size: var(--wt-field-height);
        padding: var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
        text-align: start;
        cursor: pointer;
      }
      .cell:hover {
        background: var(--wt-color-surface-sunken);
      }
      .cell:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      .cell .note {
        margin: 0;
      }
      .station.inherited,
      .line.inherited {
        color: var(--wt-color-text-muted);
        font-style: italic;
      }
      .line {
        font-size: var(--wt-font-size-sm);
      }
      .cell-error {
        display: block;
        margin: var(--wt-space-1) 0 0;
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-danger);
      }
    `,
  ];

  @property({ attribute: false }) model: RoutingView | null = null;
  /** A refused write: its message shows beside that cell and once at the bottom of the grid. */
  @property({ attribute: false }) refusal: RoutingRefusal | null = null;
  /** Set by the host while it previews or saves a choice, and cleared when that settles. */
  @property({ attribute: false }) pending: RoutingPending | null = null;
  @property({ attribute: false }) defaultRefusal: RoutingDefaultRefusal | null = null;

  @state() private expanded: ReadonlySet<string> = new Set();
  /** The cell whose editor is open. */
  @state() private editing: CellAddress | null = null;

  #rules: RoutingSelectionRules | null = null;
  #fallbackRules: RoutingRules | null = null;
  #cells = new Map<string, RoutingModelCell>();
  #products = new Map<string, GridProduct>();
  #categories = new Map<string, GridCategory>();
  #allRows: ReadonlyMap<string, GridRow> | null = null;
  /** Rebuilt with the model and the language, which the lines' words are in. */
  #lines: {
    model: RoutingView;
    locale: string;
    of: ReturnType<typeof cellPeriodLines>;
  } | null = null;

  override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (!changed.has("model") || this.model === null) return;
    const model = this.model;
    this.#rules = selectionRulesFromModel(model);
    this.#fallbackRules = null;
    this.#cells = new Map(model.cells.map((c) => [cellKey(c), c]));
    this.#products = new Map(model.products.map((product) => [product.id, product]));
    this.#categories = new Map(model.categories.map((category) => [category.id, category]));
    this.#allRows = null;
    this.expanded = pruneExpanded(model, this.expanded);
    const editing = this.editing;
    if (
      editing !== null &&
      ((editing.zoneId !== null && !model.zones.some((zone) => zone.id === editing.zoneId)) ||
        !rowInModel(model, editing.row))
    ) {
      const waiting = this.pending !== null && sameAddress(this.pending.address, editing);
      if (!waiting && this.shadowRoot?.querySelector("routing-cell-editor")?.dirty) {
        this.#emit("routing-draft-lost", { address: editing });
      }
      this.editing = null;
    }
  }

  /** Closes the open editor, as its host does once the editor's choice is saved. */
  closeEditor(): void {
    this.editing = null;
  }

  #periodLines(row: RoutingRow, zoneId: string | null, waiting?: RoutingPending): CellPeriodLines {
    const model = this.model!;
    const locale = currentLocale();
    if (this.#lines?.model !== model || this.#lines.locale !== locale) {
      this.#lines = {
        model,
        locale,
        of: cellPeriodLines(model, (target) => this.#targetText(target)),
      };
    }
    return this.#lines.of(row, zoneId, waiting);
  }

  #station(id: string) {
    return this.model!.stations.find((station) => station.id === id);
  }

  #targetText(target: RouteTarget | null): string {
    if (target === null) return t("routing.no_station");
    if (target.kind === "no_preparation") return t("prep.no_preparation");
    const station = this.#station(target.stationId);
    const name = station?.name ?? target.stationId;
    return station?.active === false ? format("routing.disabled_station", { station: name }) : name;
  }

  #categoryOf(row: RoutingRow): string | null {
    if (row.kind !== "product") return null;
    return this.#products.get(row.productId)?.categoryId ?? null;
  }

  /** What the coordinate would show with no cell of its own. */
  #inherited(row: RoutingRow, zoneId: string | null): SelectedCell {
    return selectRoutingCell(this.#rules!, row, zoneId, this.#categoryOf(row), { skipOwn: true });
  }

  /**
   * How an extra is made where the cell's choice is the default station's fall-through or No
   * preparation: with its dish (`chooseExtraMaker`).
   */
  #extraNoteText(shown: RouteTarget | null, inherited: SelectedCell): string | null {
    const choice = shown ?? inherited.target;
    if (choice?.kind === "no_preparation") return t("routing.extra_no_preparation");
    if (shown === null && inherited.decidedBy?.kind === "default") {
      return format("routing.extra_default", { station: this.#targetText(choice) });
    }
    return null;
  }

  /** The lines and the note are drawn in the cell's button and read as part of its name. */
  #labelWithNote(label: string, ...notes: (string | null)[]): string {
    return notes.reduce<string>(
      (named, note) =>
        note === null ? named : format("routing.cell_label_note", { label: named, note }),
      label,
    );
  }

  #extraNote(note: string | null, { inName }: { inName: boolean }) {
    if (note === null) return nothing;
    return html`<span class="note" data-test="extra-note" aria-hidden=${inName ? "true" : nothing}
      >${note}</span
    >`;
  }

  /** Where a disabled station's work goes, before any opening hours are applied. */
  #fallbackSentence(stationId: string): string {
    this.#fallbackRules ??= {
      ...this.#rules!,
      timing: new Map(
        this.model!.stationTimes.map((times) => [
          times.stationId,
          { fallbackId: times.fallbackStationId, hours: [], today: null },
        ]),
      ),
    };
    const { stationId: receiver } = followFallbacks(this.#fallbackRules, stationId, null);
    return receiver === null
      ? t("prep.no_replacement_ask")
      : format("prep.work_goes_to", {
          station: this.#targetText({ kind: "station", stationId: receiver }),
        });
  }

  #rowName(entry: GridRow): string {
    if (entry.row.kind === "all") return t("routing.all_categories");
    if (entry.row.kind === "no_category") return t("routing.no_category");
    return [...entry.path, entry.name].join(" › ");
  }

  /** The refused cell named by its row path and zone, whether or not its row is shown. */
  #refusalText(refusal: RoutingRefusal): string {
    const model = this.model!;
    this.#allRows ??= new Map(
      visibleRoutingRows(model, expandAll(model)).map((entry) => [rowKey(entry.row), entry]),
    );
    const entry = this.#allRows.get(rowKey(refusal.address.row));
    const zoneId = refusal.address.zoneId;
    const zone =
      zoneId === null
        ? t("routing.every_zone")
        : model.zones.find((candidate) => candidate.id === zoneId)?.name;
    if (entry === undefined || zone === undefined) return refusal.message;
    return format("routing.refusal_at", {
      row: this.#rowName(entry),
      zone,
      message: refusal.message,
    });
  }

  #refusalAt(address: CellAddress): string {
    return this.refusal !== null && sameAddress(this.refusal.address, address)
      ? this.refusal.message
      : "";
  }

  #emit<T>(name: string, detail: T): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  #error(address: CellAddress) {
    const message = this.#refusalAt(address);
    return message === ""
      ? nothing
      : html`<span class="cell-error" data-test="cell-error">${message}</span>`;
  }

  #button(
    address: CellAddress,
    label: string,
    target: RouteTarget | null,
    station: { text: string; inherited: boolean },
    lines: { texts: readonly string[]; inherited: boolean },
    note: string | null,
  ) {
    return html`<button
      type="button"
      class="cell"
      data-test="routing-cell"
      data-target=${targetKey(target)}
      aria-label=${label}
      @click=${() => {
        this.editing = address;
      }}
    >
      <span class=${station.inherited ? "station inherited" : "station"}>${station.text}</span>
      ${lines.texts.map(
        (line) => html`<span class=${lines.inherited ? "line inherited" : "line"}>${line}</span>`,
      )}
      ${this.#extraNote(note, { inName: true })}
    </button>`;
  }

  #cell(entry: GridRow, zone: Zone) {
    const address: CellAddress = { row: entry.row, zoneId: zone.id };
    const own = this.#cells.get(cellKey(address));
    const selected = this.#inherited(entry.row, zone.id);
    const inherited = selected.target;
    const waiting =
      this.pending !== null && sameAddress(this.pending.address, address)
        ? this.pending
        : undefined;
    const shown = waiting === undefined ? (own?.target ?? null) : waiting.target;
    const note = this.#extraNoteText(shown, selected);
    const disabled =
      shown?.kind === "station" && this.#station(shown.stationId)?.active !== true ? shown : null;
    const periodLines = this.#periodLines(entry.row, zone.id, waiting);
    const lines = periodLines.lines.map((line) => line.text);
    const text = this.#targetText(shown ?? inherited);
    const label = this.#labelWithNote(
      format("routing.cell_label", {
        row: this.#rowName(entry),
        zone: zone.name,
        value: text,
        state: t(shown === null ? "routing.inherited" : "routing.set_here"),
      }),
      ...lines,
      note,
    );
    return html`${this.#button(
      address,
      label,
      shown,
      { text, inherited: shown === null },
      { texts: lines, inherited: periodLines.inherited },
      note,
    )}${this.#error(address)}${
      disabled === null
        ? nothing
        : html`<span class="warning" data-test="disabled-target"
            >${format("routing.disabled_target", {
              station: this.#station(disabled.stationId)?.name ?? disabled.stationId,
            })}
            ${this.#fallbackSentence(disabled.stationId)}</span
          >`
    }`;
  }

  #defaultTarget(): RouteTarget | null {
    const model = this.model!;
    const active = model.stations.find(
      (station) => station.id === model.defaultStationId && station.active,
    );
    return active ? { kind: "station", stationId: active.id } : null;
  }

  /** All categories × Every zone is the default station: Make default, never cleared. */
  #defaultCell() {
    const model = this.model!;
    const address: CellAddress = { row: { kind: "all" }, zoneId: null };
    const target = this.#defaultTarget();
    const name = target === null ? null : this.#targetText(target);
    const repair =
      target !== null
        ? nothing
        : html`<span class="repair" data-test="default-repair"
            >${t("routing.default_repair")}</span
          >`;
    const note = name === null ? null : format("routing.extra_default", { station: name });
    if (!model.canMakeDefault) {
      return html`${name !== null ? html`<span>${name}</span> ` : nothing}${this.#extraNote(note, {
          inName: false,
        })}${repair} <span class="note">${t("routing.default_read_only")}</span>`;
    }
    const text = name ?? t("routing.no_station");
    const label = this.#labelWithNote(
      format("routing.cell_label", {
        row: t("routing.all_categories"),
        zone: t("routing.every_zone"),
        value: text,
        state: t("routing.default_state"),
      }),
      note,
    );
    return html`${this.#button(address, label, target, { text, inherited: false }, { texts: [], inherited: false }, note)}${this.#error(address)}${repair}`;
  }

  /** The row's name as the grid draws it, whether or not the row is shown. */
  #rowNameOf(row: RoutingRow): string {
    const model = this.model!;
    this.#allRows ??= new Map(
      visibleRoutingRows(model, expandAll(model)).map((entry) => [rowKey(entry.row), entry]),
    );
    const entry = this.#allRows.get(rowKey(row));
    return entry === undefined ? "" : this.#rowName(entry);
  }

  #zoneName(zoneId: string | null): string {
    return zoneId === null
      ? t("routing.every_zone")
      : (this.model!.zones.find((zone) => zone.id === zoneId)?.name ?? zoneId);
  }

  /** Where an inherited choice comes from: its own row's column, another cell, or the default. */
  #source(address: CellAddress, selected: SelectedCell): string {
    const decidedBy = selected.decidedBy;
    if (decidedBy?.kind !== "cell") return t("routing.default_state");
    const zone = this.#zoneName(decidedBy.address.zoneId);
    return rowKey(decidedBy.address.row) === rowKey(address.row)
      ? zone
      : format("routing.cell_place", { row: this.#rowNameOf(decidedBy.address.row), zone });
  }

  #rowProducts: { model: RoutingView; row: string; ids: string[] } | null = null;

  /** One array per model and row, so the open editor's memo of the row's periods holds. */
  #rowProductIds(row: RoutingRow): string[] {
    const model = this.model!;
    const key = rowKey(row);
    const memo = this.#rowProducts;
    if (memo?.model === model && memo.row === key) return memo.ids;
    const ids = this.#productsOfRow(row);
    this.#rowProducts = { model, row: key, ids };
    return ids;
  }

  /** The active products the row covers: a category's are those of its whole subtree. */
  #productsOfRow(row: RoutingRow): string[] {
    const products = this.model!.products;
    if (row.kind === "all") return products.map((product) => product.id);
    if (row.kind === "product") return [row.productId];
    if (row.kind === "no_category") {
      return products
        .filter(({ categoryId }) => categoryId === null || !this.#categories.has(categoryId))
        .map((product) => product.id);
    }
    const children = new Map<string, string[]>();
    for (const category of this.#categories.values()) {
      if (category.parentId === null) continue;
      const list = children.get(category.parentId);
      if (list === undefined) children.set(category.parentId, [category.id]);
      else list.push(category.id);
    }
    const within = new Set([row.categoryId]);
    for (const id of within) for (const child of children.get(id) ?? []) within.add(child);
    return products
      .filter(({ categoryId }) => categoryId !== null && within.has(categoryId))
      .map((product) => product.id);
  }

  #editorCell(address: CellAddress, isDefault: boolean): RoutingCellEditorCell {
    const label = format("routing.cell_place", {
      row: this.#rowNameOf(address.row),
      zone: this.#zoneName(address.zoneId),
    });
    if (isDefault) return { address, label, target: this.#defaultTarget() };
    const own = this.#cells.get(cellKey(address));
    if (own !== undefined) return { address, label, target: own.target, periods: own.periods };
    const selected = this.#inherited(address.row, address.zoneId);
    const deciding =
      selected.decidedBy?.kind === "cell"
        ? this.#cells.get(cellKey(selected.decidedBy.address))
        : undefined;
    return {
      address,
      label,
      target: selected.target,
      periods: deciding?.periods ?? [],
      inheritedFrom: this.#source(address, selected),
    };
  }

  #refusalFor(address: CellAddress, isDefault: boolean) {
    if (isDefault && this.defaultRefusal !== null) return this.defaultRefusal;
    const refusal = this.refusal;
    return refusal?.code !== undefined && sameAddress(refusal.address, address)
      ? (refusal as RoutingRefusal & { code: string })
      : undefined;
  }

  #save(address: CellAddress, isDefault: boolean, { target, periods }: RoutingCellSave): void {
    if (isDefault) {
      if (target.kind === "station") {
        this.#emit("routing-make-default", { stationId: target.stationId });
      }
      return;
    }
    const stored = this.#cells.get(cellKey(address))?.periods ?? [];
    this.#emit<RoutingCellChange>(
      "routing-cell-change",
      periods.length > 0 || stored.length > 0 ? { address, target, periods } : { address, target },
    );
  }

  #editorDialog() {
    const address = this.editing;
    if (address === null) return nothing;
    const model = this.model!;
    const isDefault = address.row.kind === "all" && address.zoneId === null;
    const pending = this.pending;
    const zoneDepartmentId =
      address.zoneId === null
        ? null
        : (model.zones.find((zone) => zone.id === address.zoneId)?.departmentId ?? null);
    return html`<routing-cell-editor
      .open=${true}
      .busy=${pending !== null && sameAddress(pending.address, address)}
      .cell=${this.#editorCell(address, isDefault)}
      .periods=${model.periods}
      .stations=${model.stations}
      .rowProductIds=${this.#rowProductIds(address.row)}
      .zoneDepartmentId=${zoneDepartmentId}
      .zoneWithoutDepartment=${address.zoneId !== null && zoneDepartmentId === null}
      .isDefaultCell=${isDefault}
      .refusal=${this.#refusalFor(address, isDefault)}
      @routing-cell-save=${(event: CustomEvent<RoutingCellSave>) => {
        event.stopPropagation();
        this.#save(address, isDefault, event.detail);
      }}
      @routing-cell-clear=${(event: Event) => {
        event.stopPropagation();
        this.#emit<RoutingCellChange>("routing-cell-change", { address, target: null });
      }}
      @routing-cell-close=${(event: Event) => {
        event.stopPropagation();
        if (this.editing === address) this.editing = null;
      }}
    ></routing-cell-editor>`;
  }

  /** A closed editor hands focus back to its cell's button, when the cell is still drawn. */
  protected override updated(changed: Map<PropertyKey, unknown>): void {
    const closed = changed.get("editing") as CellAddress | null | undefined;
    if (!changed.has("editing") || this.editing !== null || !closed) return;
    this.shadowRoot!.querySelector<HTMLElement>(
      `td[data-row="${rowKey(closed.row)}"][data-zone="${zoneKey(closed.zoneId)}"] button`,
    )?.focus();
  }

  #hiddenText(entry: GridRow): string {
    const parts: string[] = [];
    if (entry.hiddenProducts > 0) {
      parts.push(
        entry.hiddenProducts === 1
          ? t("routing.more_product")
          : format("routing.more_products", { count: String(entry.hiddenProducts) }),
      );
    }
    if (entry.hiddenCategories > 0) {
      parts.push(
        entry.hiddenCategories === 1
          ? t("routing.more_category")
          : format("routing.more_categories", { count: String(entry.hiddenCategories) }),
      );
    }
    return parts.join(", ");
  }

  #rowLabel(entry: GridRow, open: ReadonlySet<string>) {
    if (entry.row.kind === "all" || entry.row.kind === "no_category") return this.#rowName(entry);
    const row = entry.row;
    const parent =
      row.kind === "category"
        ? (this.#categories.get(row.categoryId)?.parentId ?? null)
        : this.#categoryOf(row);
    const path =
      entry.path.length > 0 && (parent === null || !open.has(parent))
        ? html`<span class="path">${entry.path.join(" › ")} › </span>`
        : nothing;
    if (entry.row.kind === "product") return html`${path}${entry.name}`;
    const id = entry.row.categoryId;
    const expanded = this.expanded.has(id);
    const hidden = this.#hiddenText(entry);
    return html`${path}<button
        type="button"
        class="toggle"
        data-category=${id}
        aria-expanded=${expanded ? "true" : "false"}
        @click=${() => {
          this.expanded = expanded
            ? collapseCategory(this.expanded, id)
            : expandCategory(this.expanded, id);
        }}
      >
        <span class="arrow" aria-hidden="true">${expanded ? "▾" : "▸"}</span> ${entry.name}</button
      >${hidden ? html` <span class="hidden">${hidden}</span>` : nothing}`;
  }

  #row(entry: GridRow, zones: readonly Zone[], open: ReadonlySet<string>) {
    const heading = entry.row.kind === "no_category";
    return html`<tr class=${heading ? "heading" : ""}>
      <th
        scope=${heading ? "rowgroup" : "row"}
        style=${styleMap({ "--routing-depth": String(entry.path.length) })}
      >
        <span class="label">${this.#rowLabel(entry, open)}</span>
      </th>
      ${repeat(
        zones,
        (zone) => zoneKey(zone.id),
        (zone) =>
          html`<td data-row=${rowKey(entry.row)} data-zone=${zoneKey(zone.id)}>
            ${
              entry.row.kind === "all" && zone.id === null
                ? this.#defaultCell()
                : this.#cell(entry, zone)
            }
          </td>`,
      )}
    </tr>`;
  }

  #rows(entries: readonly GridRow[], zones: readonly Zone[], open: ReadonlySet<string>) {
    return repeat(
      entries,
      (entry) => rowKey(entry.row),
      (entry) => this.#row(entry, zones, open),
    );
  }

  override render() {
    const model = this.model;
    if (model === null) return nothing;
    const entries = visibleRoutingRows(model, this.expanded);
    const zones: Zone[] = [{ id: null, name: t("routing.every_zone") }, ...model.zones];
    // A category's children follow it in place only when it is shown and expanded.
    const open = new Set(
      entries.flatMap((entry) =>
        entry.row.kind === "category" && this.expanded.has(entry.row.categoryId)
          ? [entry.row.categoryId]
          : [],
      ),
    );
    const heading = entries.findIndex((entry) => entry.row.kind === "no_category");
    const tree = heading < 0 ? entries : entries.slice(0, heading);
    const uncategorised = heading < 0 ? [] : entries.slice(heading);
    return html`<div class="toolbar">
        <wt-button
          variant="secondary"
          data-test="expand-all"
          @click=${() => (this.expanded = expandAll(model))}
          >${t("routing.expand_all")}</wt-button
        ><wt-button
          variant="secondary"
          data-test="collapse-all"
          @click=${() => (this.expanded = collapseAll())}
          >${t("routing.collapse_all")}</wt-button
        >
      </div>
      <div class="scroll" data-test="grid-scroll">
        <table
          aria-label=${t("routing.grid")}
          style=${styleMap({ "--routing-zones": String(zones.length) })}
        >
          <thead>
            <tr>
              <th scope="col">${t("routing.row_heading")}</th>
              ${repeat(
                zones,
                (zone) => zoneKey(zone.id),
                (zone) => html`<th scope="col">${zone.name}</th>`,
              )}
            </tr>
          </thead>
          <tbody>
            ${this.#rows(tree, zones, open)}
          </tbody>
          ${
            heading < 0
              ? nothing
              : html`<tbody>
                  ${this.#rows(uncategorised, zones, open)}
                </tbody>`
          }
        </table>
      </div>
      <wt-form-actions
        .error=${this.refusal === null ? "" : this.#refusalText(this.refusal)}
      ></wt-form-actions>
      ${this.#editorDialog()}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "venue-routing-grid": RoutingGrid;
  }
}
