import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { styleMap } from "lit/directives/style-map.js";
import { currentLocale } from "@waitron/dashboard-kit";
import { isStationColour, type StationColour } from "@waitron/shared";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import {
  cellKey,
  followFallbacks,
  rowKey,
  targetKey,
  zoneKey,
  selectRoutingCell,
  type CellAddress,
  type RoutingModel,
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
  blankZoneCell,
  cellPeriodLines,
  collapseAll,
  collapseCategory,
  expandAll,
  expandCategory,
  pruneExpanded,
  routingLookups,
  routingSearch,
  rowInModel,
  stationDuring,
  usedStations,
  visibleRoutingRows,
  type CellPeriodLines,
  type MatchRange,
  type PeriodLineText,
  type RoutingLookups,
  type RoutingSearch,
  type SearchRow,
} from "./routing-grid-model.js";
import { stationColourStyles } from "./station-colour-styles.js";
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

/**
 * Set here; inherited in the Every zone column; inherited in a zone column and differing from the
 * row's own Every zone; or the same as it, drawn empty.
 */
type CellStyle = "set" | "inherited" | "differs" | "blank";

/**
 * A cell's content and the colour of the station it draws, if painted. `saved` is where the saved
 * routing sends work, during the chosen period if there is one, ignoring a choice still waiting.
 */
type DrawnCell = {
  saved: RouteTarget | null;
  colour: StationColour | undefined;
  content: unknown;
};

type ComboboxOption = HTMLElementTagNameMap["wt-combobox"]["options"][number];

@customElement("venue-routing-grid")
export class RoutingGrid extends LitElement {
  static override styles = [
    baseStyles,
    stationColourStyles,
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
          --routing-indent: var(--wt-space-2);
        }
      }
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
        margin-block-end: var(--wt-space-3);
      }
      .toolbar wt-input {
        flex: 1 1 calc(var(--wt-space-6) * 8);
        max-inline-size: calc(var(--wt-space-6) * 12);
      }
      .toolbar wt-combobox {
        flex: 0 1 calc(var(--wt-space-6) * 6);
        min-inline-size: 0;
      }
      .count {
        color: var(--wt-color-text-muted);
      }
      mark {
        background: var(--wt-color-highlight);
        color: var(--wt-color-on-highlight);
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
      td[data-station-colour] {
        background: var(--station-fill);
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
      /* The label or its toggle carries the block padding, so the padding is inside the toggle's tap area. */
      tbody th {
        font-weight: var(--wt-font-weight-normal);
        padding-block: 0;
        padding-inline-start: calc(
          var(--routing-pad, var(--wt-space-2)) + var(--routing-indent, var(--wt-space-4)) *
            var(--routing-depth, 0)
        );
      }
      tbody tr.heading th {
        font-weight: var(--wt-font-weight-medium);
        background: var(--wt-color-surface-sunken);
      }
      .toggle {
        display: inline-flex;
        align-items: flex-start;
        gap: var(--wt-space-1);
        min-inline-size: 0;
        min-block-size: var(--wt-tap-min);
        padding: var(--routing-pad, var(--wt-space-2)) 0;
        border: 0;
        background: none;
        color: inherit;
        font: inherit;
        font-weight: var(--wt-font-weight-medium);
        text-align: start;
        cursor: pointer;
      }
      /* The large arrow takes up only a text-sized height, so it centres on the name's first line. */
      .arrow {
        display: inline-flex;
        flex: none;
        justify-content: center;
        inline-size: var(--wt-space-5);
        margin-block: calc((var(--wt-font-size-md) - var(--wt-font-size-xl)) / 2);
        font-size: var(--wt-font-size-xl);
        line-height: 1;
      }
      .toggle:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      .note {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      /* The No category heading keeps its colour: muted text is under 4.5:1 on its sunken fill. */
      tbody tr:not(.heading) .label.parent {
        color: var(--wt-color-text-muted);
      }
      /* Top-aligned with a zone cell's padding, so a name's first line meets its station's. */
      .label {
        display: flex;
        align-items: flex-start;
        min-block-size: var(--wt-tap-min);
        padding-block: var(--routing-pad, var(--wt-space-2));
      }
      .label:has(> .toggle) {
        padding-block: 0;
      }
      /* One inline run, so a mark never splits the name; a word breaks only when it cannot fit. */
      .name {
        min-inline-size: 0;
        overflow-wrap: break-word;
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
        /* The cell keeps its padding and the button spreads over it, so the whole cell is the target. */
        inline-size: calc(100% + var(--routing-pad, var(--wt-space-2)) * 2);
        block-size: calc(100% + var(--routing-pad, var(--wt-space-2)) * 2);
        min-block-size: var(--wt-tap-min);
        margin: calc(var(--routing-pad, var(--wt-space-2)) * -1);
        padding: var(--routing-pad, var(--wt-space-2));
        border: 0;
        background: transparent;
        color: var(--wt-color-text);
        font: inherit;
        text-align: start;
        cursor: pointer;
      }
      /* A definite height, which the row then grows, lets the button's percentage height resolve. */
      td:has(> .cell) {
        block-size: 1px;
      }
      /* Drawn inside the cell, so the outline never covers a neighbour. */
      .cell:hover,
      .cell:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: calc(var(--wt-focus-offset) * -1);
      }
      /* Untinted under a refusal: the danger colour falls under 4.5:1 on the tint in the dark theme. */
      .cell:hover:not(:has(.cell-error)) {
        background: var(--wt-color-surface-lifted);
      }
      .notes {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
      }
      .cell .warning,
      .cell .repair,
      .cell .cell-error {
        margin: 0;
      }
      .cell[data-style="set"] .station,
      .cell[data-style="set"] .line {
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-text);
      }
      .station.inherited,
      .line.inherited {
        color: var(--wt-color-text-muted);
      }
      .station.differs,
      .line.differs {
        font-style: italic;
      }
      .line {
        font-size: var(--wt-font-size-sm);
      }
      .dot {
        display: inline-block;
        inline-size: var(--wt-space-2);
        block-size: var(--wt-space-2);
        margin-inline-end: var(--wt-space-1);
        border-radius: var(--wt-radius-full);
        background: var(--station-dot);
      }
      .key {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2) var(--wt-space-4);
        margin: var(--wt-space-3) 0 0;
        padding: 0;
        list-style: none;
      }
      .key li {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
      }
      .swatch {
        inline-size: var(--wt-space-4);
        block-size: var(--wt-space-4);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        background: var(--station-fill);
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
  /** A refused write: its message shows in that cell and once at the bottom of the grid. */
  @property({ attribute: false }) refusal: RoutingRefusal | null = null;
  /** Set by the host while it previews or saves a choice, and cleared when that settles. */
  @property({ attribute: false }) pending: RoutingPending | null = null;
  @property({ attribute: false }) defaultRefusal: RoutingDefaultRefusal | null = null;

  /** Never written while a search is shown, so clearing the search restores the tree as it was. */
  @state() private expanded: ReadonlySet<string> = new Set();
  @state() private query = "";
  /** The categories open in the search view; `null` until the person opens or closes one. */
  @state() private searchOpen: ReadonlySet<string> | null = null;
  /** The period whose stations the cells show; `null` shows every period's lines. */
  @state() private period: string | null = null;
  /** The cell whose editor is open. */
  @state() private editing: CellAddress | null = null;

  #lookups: RoutingLookups | null = null;
  #rules: RoutingSelectionRules | null = null;
  #fallbackRules: RoutingRules | null = null;
  #cells: ReadonlyMap<string, RoutingModelCell> = new Map();
  #products = new Map<string, GridProduct>();
  #categories = new Map<string, GridCategory>();
  #stations = new Map<string, RoutingModel["stations"][number]>();
  #allRows: ReadonlyMap<string, GridRow> | null = null;
  #blank: ReturnType<typeof blankZoneCell> | null = null;
  #searchOf: ReturnType<typeof routingSearch> | null = null;
  /** The last search, kept while the model, the query and the search's open set stay the same. */
  #searched: {
    query: string;
    open: ReadonlySet<string> | null;
    result: RoutingSearch | undefined;
  } | null = null;
  /** Rebuilt with the model and the language, which the lines' words are in. */
  #lines: {
    model: RoutingView;
    locale: string;
    of: ReturnType<typeof cellPeriodLines>;
  } | null = null;
  #used: { model: RoutingModel; stations: RoutingModel["stations"] } | null = null;
  /** Kept so the Period field is handed the same list, and does not redraw, on each render. */
  #periodOptions: { model: RoutingModel; locale: string; options: ComboboxOption[] } | null = null;

  override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (!changed.has("model") || this.model === null) return;
    const model = this.model;
    const lookups = (this.#lookups = routingLookups(model));
    this.#rules = lookups.rules;
    this.#fallbackRules = null;
    this.#cells = lookups.cells;
    this.#products = new Map(model.products.map((product) => [product.id, product]));
    this.#categories = new Map(model.categories.map((category) => [category.id, category]));
    this.#stations = new Map(model.stations.map((station) => [station.id, station]));
    this.#allRows = null;
    this.#blank = blankZoneCell(model, lookups);
    this.#searchOf = routingSearch(model);
    this.#searched = null;
    this.expanded = pruneExpanded(model, this.expanded);
    if (this.period !== null && !offeredPeriods(model).some(({ id }) => id === this.period)) {
      this.period = null;
    }
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

  #periodLines(
    row: RoutingRow,
    zoneId: string | null,
    waiting: RoutingPending | undefined,
    inherited: SelectedCell,
  ): CellPeriodLines {
    const model = this.model!;
    const locale = currentLocale();
    if (this.#lines?.model !== model || this.#lines.locale !== locale) {
      this.#lines = {
        model,
        locale,
        of: cellPeriodLines(model, (target) => this.#targetText(target), this.#lookups!),
      };
    }
    return this.#lines.of(row, zoneId, waiting, inherited);
  }

  #station(id: string) {
    return this.#stations.get(id);
  }

  /** The colour a target paints in; none for No preparation, a missing or a disabled station. */
  #colourOf(target: RouteTarget | null): StationColour | undefined {
    if (target?.kind !== "station") return undefined;
    const station = this.#station(target.stationId);
    return station?.active === true && isStationColour(station.colour) ? station.colour : undefined;
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

  /** Period lines and their marks show in the cell's button and are read as part of its name. */
  #labelWithNote(label: string, ...notes: (string | null)[]): string {
    return notes.reduce<string>(
      (named, note) =>
        note === null ? named : format("routing.cell_label_note", { label: named, note }),
      label,
    );
  }

  #fallbackSentence(stationId: string): string {
    this.#fallbackRules ??= {
      ...this.#rules!,
      timing: new Map(this.model!.stationTimes.map((times) => [times.stationId, { today: null }])),
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
      ? null
      : html`<span class="cell-error" data-test="cell-error">${message}</span>`;
  }

  /** `notes` are drawn inside the button, so the whole cell stays the target. */
  #button(
    address: CellAddress,
    label: string,
    target: RouteTarget | null,
    style: CellStyle,
    station: string,
    lines: readonly PeriodLineText[],
    notes: readonly (TemplateResult | null)[] = [],
  ) {
    const shownNotes = notes.filter((note) => note !== null);
    const notesId = `notes-${encodeURIComponent(cellKey(address))}`;
    const blank = style === "blank";
    const look = {
      set: "",
      inherited: " inherited",
      differs: " inherited differs",
      blank: " inherited",
    }[style];
    return html`<button
      type="button"
      class="cell"
      data-test="routing-cell"
      data-target=${targetKey(target)}
      data-style=${style}
      aria-label=${label}
      aria-describedby=${shownNotes.length === 0 ? nothing : notesId}
      @click=${() => {
        this.editing = address;
      }}
    >
      <span class=${`station${look}`}>${blank ? "" : station}</span>
      ${(blank ? [] : lines).map((line) => {
        const dot = this.#colourOf(line.target);
        return html`<span class=${`line${look}`}
            >${
              dot === undefined
                ? nothing
                : html`<span class="dot" aria-hidden="true" data-station-colour=${dot}></span>`
            }${line.text}</span
          >${
            line.flagText === undefined
              ? nothing
              : html`<span class="warning" data-test="period-flag">${line.flagText}</span>`
          }`;
      })}
      ${shownNotes.length === 0 ? nothing : html`<span class="notes" id=${notesId}>${shownNotes}</span>`}
    </button>`;
  }

  /** `every` is the row's Every zone's `saved`; a period view names a blank cell that differs. */
  #cell(entry: GridRow, zone: Zone, every: RouteTarget | null): DrawnCell {
    const address: CellAddress = { row: entry.row, zoneId: zone.id };
    const own = this.#cells.get(cellKey(address));
    const selected = this.#inherited(entry.row, zone.id);
    const inherited = selected.target;
    const waiting =
      this.pending !== null && sameAddress(this.pending.address, address)
        ? this.pending
        : undefined;
    const shown = waiting === undefined ? (own?.target ?? null) : waiting.target;
    const disabled =
      shown?.kind === "station" && this.#station(shown.stationId)?.active !== true ? shown : null;
    const periodLines = this.#periodLines(entry.row, zone.id, waiting, selected);
    const period = this.period;
    const target =
      period === null
        ? (shown ?? inherited)
        : stationDuring(periodLines.lines, period, shown ?? inherited);
    const lines = period === null ? periodLines.lines : [];
    const saved =
      waiting === undefined
        ? target
        : period === null
          ? (own?.target ?? inherited)
          : stationDuring(
              this.#periodLines(entry.row, zone.id, undefined, selected).lines,
              period,
              own?.target ?? inherited,
            );
    const text = this.#targetText(target);
    const label = this.#labelWithNote(
      format("routing.cell_label", {
        row: this.#rowName(entry),
        zone: zone.name,
        value: text,
        state: t(shown === null ? "routing.inherited" : "routing.set_here"),
      }),
      ...lines.flatMap((line) => [line.text, line.flagText ?? null]),
    );
    const style: CellStyle =
      shown !== null
        ? "set"
        : zone.id === null
          ? "inherited"
          : !this.#blank!(entry.row, zone.id, selected)
            ? "differs"
            : period !== null && targetKey(target) !== targetKey(every)
              ? "differs"
              : "blank";
    const content = this.#button(address, label, shown, style, text, lines, [
      this.#error(address),
      disabled === null
        ? null
        : html`<span class="warning" data-test="disabled-target"
            >${format("routing.disabled_target", {
              station: this.#station(disabled.stationId)?.name ?? disabled.stationId,
            })}
            ${this.#fallbackSentence(disabled.stationId)}</span
          >`,
    ]);
    return { saved, colour: this.#colourOf(target), content };
  }

  #defaultTarget(): RouteTarget | null {
    const id = this.model!.defaultStationId;
    return id !== null && this.#station(id)?.active === true
      ? { kind: "station", stationId: id }
      : null;
  }

  /** All categories × Every zone is the default station: Make default, never cleared. */
  #defaultCell(): DrawnCell {
    const model = this.model!;
    const address: CellAddress = { row: { kind: "all" }, zoneId: null };
    const target = this.#defaultTarget();
    const colour = this.#colourOf(target);
    const name = target === null ? null : this.#targetText(target);
    const repair =
      target !== null
        ? null
        : html`<span class="repair" data-test="default-repair"
            >${t("routing.default_repair")}</span
          >`;
    if (!model.canMakeDefault) {
      return {
        saved: target,
        colour,
        content: html`${name !== null ? html`<span>${name}</span> ` : nothing}${repair}
          <span class="note">${t("routing.default_read_only")}</span>`,
      };
    }
    const text = name ?? t("routing.no_station");
    const label = this.#labelWithNote(
      format("routing.cell_label", {
        row: t("routing.all_categories"),
        zone: t("routing.every_zone"),
        value: text,
        state: t("routing.default_state"),
      }),
    );
    return {
      saved: target,
      colour,
      content: this.#button(
        address,
        label,
        target,
        "set",
        text,
        [],
        [this.#error(address), repair],
      ),
    };
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

  #search(): RoutingSearch | undefined {
    const { query, searchOpen: open } = this;
    const memo = this.#searched;
    if (memo?.query === query && memo.open === open) return memo.result;
    const result = this.#searchOf!(query, open ?? undefined);
    this.#searched = { query, open, result };
    return result;
  }

  #setOpen(search: RoutingSearch | undefined, next: ReadonlySet<string>): void {
    if (search === undefined) this.expanded = next;
    else this.searchOpen = next;
  }

  #rowLabel(entry: GridRow, found: SearchRow | undefined, search: RoutingSearch | undefined) {
    if (entry.row.kind === "all" || entry.row.kind === "no_category") {
      return html`<span class="name">${this.#rowName(entry)}</span>`;
    }
    const name = html`<span class="name">${highlighted(entry.name, found?.ranges ?? [])}</span>`;
    if (entry.row.kind === "product") return name;
    const id = entry.row.categoryId;
    const open = search === undefined ? this.expanded : search.open;
    const expanded = open.has(id);
    return html`<button
      type="button"
      class="toggle"
      data-category=${id}
      aria-expanded=${expanded ? "true" : "false"}
      @click=${() => {
        this.#setOpen(search, expanded ? collapseCategory(open, id) : expandCategory(open, id));
      }}
    >
      <span class="arrow" aria-hidden="true">${expanded ? "▾" : "▸"}</span> ${name}
    </button>`;
  }

  #row(
    { entry, found }: { entry: GridRow; found?: SearchRow },
    zones: readonly Zone[],
    search: RoutingSearch | undefined,
  ) {
    const heading = entry.row.kind === "no_category";
    let every: RouteTarget | null = null;
    return html`<tr class=${heading ? "heading" : ""}>
      <th
        scope=${heading ? "rowgroup" : "row"}
        style=${styleMap({ "--routing-depth": String(entry.path.length) })}
      >
        <span class=${found?.parent ? "label parent" : "label"}
          >${this.#rowLabel(entry, found, search)}</span
        >
      </th>
      ${repeat(
        zones,
        (zone) => zoneKey(zone.id),
        (zone) => {
          const { saved, colour, content } =
            entry.row.kind === "all" && zone.id === null
              ? this.#defaultCell()
              : this.#cell(entry, zone, every);
          if (zone.id === null) every = saved;
          return html`<td
            data-row=${rowKey(entry.row)}
            data-zone=${zoneKey(zone.id)}
            data-station-colour=${colour ?? nothing}
          >
            ${content}
          </td>`;
        },
      )}
    </tr>`;
  }

  #rows(
    rows: readonly { entry: GridRow; found?: SearchRow }[],
    zones: readonly Zone[],
    search: RoutingSearch | undefined,
  ) {
    return repeat(
      rows,
      ({ entry }) => rowKey(entry.row),
      (row) => this.#row(row, zones, search),
    );
  }

  #key(model: RoutingModel) {
    if (this.#used?.model !== model) {
      const stations = usedStations(model).filter((station) => isStationColour(station.colour));
      this.#used = { model, stations };
    }
    const { stations } = this.#used;
    if (stations.length === 0) return nothing;
    return html`<ul class="key" aria-label=${t("routing.colour_key")}>
      ${stations.map(
        (station) =>
          html`<li>
            <span class="swatch" aria-hidden="true" data-station-colour=${station.colour}></span
            >${station.name}
          </li>`,
      )}
    </ul>`;
  }

  #periodField(model: RoutingModel) {
    const locale = currentLocale();
    if (this.#periodOptions?.model !== model || this.#periodOptions.locale !== locale) {
      const periods = offeredPeriods(model);
      const grouped = new Set(periods.map(({ departmentId }) => departmentId)).size > 1;
      const options: ComboboxOption[] =
        periods.length === 0
          ? []
          : [
              { value: "", label: t("routing.all_periods") },
              ...periods.map(({ id, name, departmentName }) =>
                grouped
                  ? { value: id, label: name, group: departmentName }
                  : { value: id, label: name },
              ),
            ];
      this.#periodOptions = { model, locale, options };
    }
    const { options } = this.#periodOptions;
    if (options.length === 0) return nothing;
    return html`<wt-combobox
      name="period"
      label=${t("routing.period")}
      search="auto"
      show-empty-option
      .options=${options}
      .value=${this.period ?? ""}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        this.period = event.detail.value === "" ? null : event.detail.value;
      }}
    ></wt-combobox>`;
  }

  override render() {
    const model = this.model;
    if (model === null) return nothing;
    const search = this.#search();
    const rows: readonly { entry: GridRow; found?: SearchRow }[] =
      search === undefined
        ? visibleRoutingRows(model, this.expanded).map((entry) => ({ entry }))
        : search.rows.map((found) => ({ entry: found.entry, found }));
    const zones: Zone[] = [{ id: null, name: t("routing.every_zone") }, ...model.zones];
    const heading = rows.findIndex(({ entry }) => entry.row.kind === "no_category");
    const tree = heading < 0 ? rows : rows.slice(0, heading);
    const uncategorised = heading < 0 ? [] : rows.slice(heading);
    return html`<div class="toolbar">
        <wt-input
          type="search"
          name="search"
          hide-label
          autocomplete="off"
          label=${t("routing.search")}
          placeholder=${t("routing.search")}
          .value=${this.query}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.query = event.detail.value;
            this.searchOpen = null;
          }}
        ></wt-input
        >${this.#periodField(model)}<wt-button
          variant="secondary"
          data-test="expand-all"
          @click=${() => this.#setOpen(search, expandAll(model))}
          >${t("routing.expand_all")}</wt-button
        ><wt-button
          variant="secondary"
          data-test="collapse-all"
          @click=${() => this.#setOpen(search, collapseAll())}
          >${t("routing.collapse_all")}</wt-button
        ><span class="count" role="status"
          >${search === undefined ? "" : matchCount(search.count)}</span
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
            ${this.#rows(tree, zones, search)}
          </tbody>
          ${
            heading < 0
              ? nothing
              : html`<tbody>
                  ${this.#rows(uncategorised, zones, search)}
                </tbody>`
          }
        </table>
      </div>
      ${this.#key(model)}
      <wt-form-actions
        .error=${this.refusal === null ? "" : this.#refusalText(this.refusal)}
      ></wt-form-actions>
      ${this.#editorDialog()}`;
  }
}

/** The periods the Period field offers: those of an active department, in the model's order. */
function offeredPeriods(model: RoutingModel): RoutingModel["periods"] {
  return model.periods.filter((period) => period.departmentInactive !== true);
}

function matchCount(count: number): string {
  if (count === 0) return t("routing.matches_none");
  if (count === 1) return t("routing.matches_one");
  return format("routing.matches_many", { count: String(count) });
}

function highlighted(name: string, ranges: readonly MatchRange[]) {
  if (ranges.length === 0) return name;
  const parts = [];
  let at = 0;
  for (const { start, end } of ranges) {
    parts.push(name.slice(at, start), html`<mark>${name.slice(start, end)}</mark>`);
    at = end;
  }
  parts.push(name.slice(at));
  return parts;
}

declare global {
  interface HTMLElementTagNameMap {
    "venue-routing-grid": RoutingGrid;
  }
}
