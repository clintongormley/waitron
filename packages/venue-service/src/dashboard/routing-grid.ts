import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { repeat } from "lit/directives/repeat.js";
import { styleMap } from "lit/directives/style-map.js";
import { currentLocale } from "@waitron/dashboard-kit";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import type { ComboboxOption } from "@waitron/ui/src/components/wt-combobox.js";
import {
  followFallbacks,
  selectRoutingCell,
  selectionRulesFromModel,
  type CellAddress,
  type GridCategory,
  type GridProduct,
  type GridRow,
  type RouteTarget,
  type RoutingCell,
  type RoutingRow,
  type RoutingRules,
  type RoutingSelectionRules,
} from "../routing.js";
import { format } from "./hours-view.js";
import type { RoutingView } from "./routing-client.js";
import {
  collapseAll,
  collapseCategory,
  expandAll,
  expandCategory,
  pruneExpanded,
  visibleRoutingRows,
} from "./routing-grid-model.js";
import { t } from "./strings.js";

export type RoutingRefusal = { address: CellAddress; message: string };
export type RoutingCellChange = { address: CellAddress; target: RouteTarget | null };
/** A choice the host has not saved yet, shown at its address in place of the saved value. */
export type RoutingPending = RoutingCellChange;

function rowKey(row: RoutingRow): string {
  return row.kind === "all"
    ? "all"
    : row.kind === "no_category"
      ? "no_category"
      : row.kind === "category"
        ? `c:${row.categoryId}`
        : `p:${row.productId}`;
}

type Zone = { id: string | null; name: string };
const zoneKey = (zoneId: string | null) => zoneId ?? "every";
const coordinate = (row: RoutingRow, zoneId: string | null) => `${rowKey(row)}|${zoneKey(zoneId)}`;

const NO_PREPARATION = "no_preparation";
const STATION = "station:";

function encode(target: RouteTarget | null): string {
  if (target === null) return "";
  return target.kind === "no_preparation" ? NO_PREPARATION : `${STATION}${target.stationId}`;
}

/** `undefined` for a value no option carries; "" is Clear setting, never a station. */
function decode(value: string): RouteTarget | null | undefined {
  if (value === "") return null;
  if (value === NO_PREPARATION) return { kind: "no_preparation" };
  if (value.startsWith(STATION) && value.length > STATION.length) {
    return { kind: "station", stationId: value.slice(STATION.length) };
  }
  return undefined;
}

const sameAddress = (a: CellAddress, b: CellAddress) =>
  coordinate(a.row, a.zoneId) === coordinate(b.row, b.zoneId);

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
          --routing-first: var(--wt-cell-name-max-width);
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
        padding: var(--wt-space-2);
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
        padding-inline-start: calc(var(--wt-space-2) + var(--wt-space-4) * var(--routing-depth, 0));
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
    `,
  ];

  @property({ attribute: false }) model: RoutingView | null = null;
  /** A refused write: its message shows beside that cell and once at the bottom of the grid. */
  @property({ attribute: false }) refusal: RoutingRefusal | null = null;
  /** Set by the host while it previews or saves a choice, and cleared when that settles. */
  @property({ attribute: false }) pending: RoutingPending | null = null;

  @state() private expanded: ReadonlySet<string> = new Set();

  #rules: RoutingSelectionRules | null = null;
  #fallbackRules: RoutingRules | null = null;
  #cells = new Map<string, RoutingCell>();
  #products = new Map<string, GridProduct>();
  #categories = new Map<string, GridCategory>();
  #allRows: ReadonlyMap<string, GridRow> | null = null;
  /** Reused while the model and language hold, so an unchanged combobox sees the same array. */
  #options: {
    model: RoutingView;
    locale: string;
    cell: ComboboxOption[];
    stations: ComboboxOption[];
  } | null = null;

  override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (!changed.has("model") || this.model === null) return;
    const model = this.model;
    this.#rules = selectionRulesFromModel(model);
    this.#fallbackRules = {
      ...this.#rules,
      timing: new Map(
        model.stationTimes.map((times) => [
          times.stationId,
          { fallbackId: times.fallbackStationId, hours: [], today: null },
        ]),
      ),
    };
    this.#cells = new Map(model.cells.map((c) => [coordinate(c.row, c.zoneId), c]));
    this.#products = new Map(model.products.map((product) => [product.id, product]));
    this.#categories = new Map(model.categories.map((category) => [category.id, category]));
    this.#allRows = null;
    this.expanded = pruneExpanded(model, this.expanded);
  }

  #optionLists() {
    const model = this.model!;
    const locale = currentLocale();
    if (this.#options?.model !== model || this.#options.locale !== locale) {
      const stations = this.#activeStations().map((station) => ({
        value: `${STATION}${station.id}`,
        label: station.name,
      }));
      this.#options = {
        model,
        locale,
        stations,
        cell: [
          { value: "", label: t("routing.clear") },
          ...stations,
          { value: NO_PREPARATION, label: t("prep.no_preparation") },
        ],
      };
    }
    return this.#options;
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
  #inherited(row: RoutingRow, zoneId: string | null) {
    return selectRoutingCell(this.#rules!, row, zoneId, this.#categoryOf(row), { skipOwn: true })
      .target;
  }

  /** Where a disabled station's work goes, before any opening hours are applied. */
  #fallbackSentence(stationId: string): string {
    const { stationId: receiver } = followFallbacks(this.#fallbackRules!, stationId, null);
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

  #activeStations() {
    return this.model!.stations.filter((station) => station.active);
  }

  /** The field drew the user's pick; a render puts back what the properties say it shows. */
  #emit<T>(name: string, detail: T): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
    this.requestUpdate();
  }

  /** A field a refresh has removed can still hold an open list; its pick addresses nothing now. */
  #fromLiveField(event: Event): boolean {
    event.stopPropagation();
    return (event.currentTarget as Element).isConnected;
  }

  #editor(entry: GridRow, zone: Zone) {
    const address: CellAddress = { row: entry.row, zoneId: zone.id };
    const own = this.#cells.get(coordinate(entry.row, zone.id));
    const inherited = this.#inherited(entry.row, zone.id);
    const pending = this.pending;
    const shown =
      pending !== null && sameAddress(pending.address, address)
        ? pending.target
        : (own?.target ?? null);
    const disabled =
      shown?.kind === "station" && this.#station(shown.stationId)?.active !== true ? shown : null;
    const { cell } = this.#optionLists();
    const options =
      disabled === null
        ? cell
        : [
            ...cell.slice(0, -1),
            { value: encode(disabled), label: this.#targetText(disabled), disabled: true },
            ...cell.slice(-1),
          ];
    const label = format("routing.cell_label", {
      row: this.#rowName(entry),
      zone: zone.name,
      value: this.#targetText(shown ?? inherited),
      state: t(shown === null ? "routing.inherited" : "routing.set_here"),
    });
    return html`<wt-combobox
        name="routing-target"
        hide-label
        label=${label}
        search="auto"
        searchPlaceholder=${t("venue.combobox_search")}
        noResultsLabel=${t("venue.combobox_no_results")}
        .options=${options}
        .value=${live(encode(shown))}
        placeholder=${this.#targetText(inherited)}
        error=${this.#refusalAt(address)}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          if (!this.#fromLiveField(event)) return;
          const target = decode(event.detail.value);
          if (target === undefined || encode(target) === encode(shown)) return;
          this.#emit<RoutingCellChange>("routing-cell-change", { address, target });
        }}
      ></wt-combobox
      >${
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

  /** All categories × Every zone is the default station: Make default, never cleared. */
  #defaultCell() {
    const model = this.model!;
    const address: CellAddress = { row: { kind: "all" }, zoneId: null };
    const active = model.stations.find(
      (station) => station.id === model.defaultStationId && station.active,
    );
    const repair = active
      ? nothing
      : html`<span class="repair" data-test="default-repair">${t("routing.default_repair")}</span>`;
    if (!model.canMakeDefault) {
      return html`${active ? html`<span>${active.name}</span> ` : nothing}${repair}
        <span class="note">${t("routing.default_read_only")}</span>`;
    }
    const label = format("routing.cell_label", {
      row: t("routing.all_categories"),
      zone: t("routing.every_zone"),
      value: active?.name ?? t("routing.no_station"),
      state: t("routing.default_state"),
    });
    return html`<wt-combobox
        name="routing-target"
        hide-label
        label=${label}
        search="auto"
        searchPlaceholder=${t("venue.combobox_search")}
        noResultsLabel=${t("venue.combobox_no_results")}
        .options=${this.#optionLists().stations}
        .value=${live(active ? `${STATION}${active.id}` : "")}
        placeholder=${t("routing.no_station")}
        error=${this.#refusalAt(address)}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          if (!this.#fromLiveField(event)) return;
          const target = decode(event.detail.value);
          if (target?.kind !== "station" || target.stationId === active?.id) return;
          this.#emit("routing-make-default", { stationId: target.stationId });
        }}
      ></wt-combobox
      >${repair}`;
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
                : this.#editor(entry, zone)
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
      ></wt-form-actions>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "venue-routing-grid": RoutingGrid;
  }
}
