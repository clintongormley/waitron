import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { repeat } from "lit/directives/repeat.js";
import { styleMap } from "lit/directives/style-map.js";
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
  type GridRow,
  type RouteTarget,
  type RoutingCell,
  type RoutingRow,
  type RoutingSelectionRules,
} from "../routing.js";
import type { RoutingView } from "./routing-client.js";
import {
  collapseAll,
  collapseCategory,
  expandAll,
  expandCategory,
  isNoCategoryHeading,
  pruneExpanded,
  visibleRoutingRows,
} from "./routing-grid-model.js";
import { t } from "./strings.js";

export type RoutingRefusal = { address: CellAddress; message: string };
export type RoutingCellChange = { address: CellAddress; target: RouteTarget | null };

const format = (key: Parameters<typeof t>[0], values: Record<string, string> = {}) =>
  Object.entries(values).reduce(
    (value, [name, replacement]) => value.replaceAll(`{${name}}`, replacement),
    t(key),
  );

function rowKey(row: RoutingRow): string {
  return row.kind === "all"
    ? "all"
    : row.kind === "category"
      ? `c:${row.categoryId}`
      : `p:${row.productId}`;
}

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
        display: block;
        min-width: 0;
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
      table {
        border-collapse: separate;
        border-spacing: 0;
        min-width: 100%;
      }
      th,
      td {
        padding: var(--wt-space-2);
        border-block-end: 1px solid var(--wt-color-border);
        text-align: start;
        vertical-align: top;
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
      }
      thead th {
        font-weight: var(--wt-font-weight-medium);
        font-size: var(--wt-font-size-sm);
        white-space: nowrap;
      }
      td {
        min-inline-size: calc(var(--wt-space-6) * 5);
      }
      th:first-child {
        position: sticky;
        inset-inline-start: 0;
        z-index: 1;
        min-inline-size: var(--wt-cell-name-max-width);
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

  @state() private expanded: ReadonlySet<string> = new Set();

  #rules: RoutingSelectionRules | null = null;
  #cells = new Map<string, RoutingCell>();

  override willUpdate(changed: Map<PropertyKey, unknown>): void {
    if (!changed.has("model") || this.model === null) return;
    this.#rules = selectionRulesFromModel(this.model);
    this.#cells = new Map(this.model.cells.map((c) => [coordinate(c.row, c.zoneId), c]));
    this.expanded = pruneExpanded(this.model, this.expanded);
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
    return this.model!.products.find((product) => product.id === row.productId)?.categoryId ?? null;
  }

  /** What the coordinate would show with no cell of its own. */
  #inherited(row: RoutingRow, zoneId: string | null, own: RoutingCell | undefined) {
    const rules = this.#rules!;
    const without =
      own === undefined ? rules : { ...rules, cells: rules.cells.filter((c) => c !== own) };
    return selectRoutingCell(without, row, zoneId, this.#categoryOf(row)).target;
  }

  /** Where a disabled station's work goes, before any opening hours are applied. */
  #fallbackSentence(stationId: string): string {
    const model = this.model!;
    const rules = {
      ...this.#rules!,
      timing: new Map(
        model.stationTimes.map((times) => [
          times.stationId,
          { fallbackId: times.fallbackStationId, hours: [], today: null },
        ]),
      ),
    };
    const { stationId: receiver } = followFallbacks(rules, stationId, null);
    return receiver === null
      ? t("prep.no_replacement_ask")
      : format("prep.work_goes_to", {
          station: this.#targetText({ kind: "station", stationId: receiver }),
        });
  }

  #rowName(entry: GridRow): string {
    if (entry.row.kind === "all") return t("routing.all_categories");
    return [...entry.path, entry.name].join(" › ");
  }

  #refusalAt(address: CellAddress): string {
    return this.refusal !== null && sameAddress(this.refusal.address, address)
      ? this.refusal.message
      : "";
  }

  #activeStations() {
    return this.model!.stations.filter((station) => station.active);
  }

  #emit<T>(name: string, detail: T): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  #editor(entry: GridRow, zone: { id: string | null; name: string }) {
    const address: CellAddress = { row: entry.row, zoneId: zone.id };
    const own = this.#cells.get(coordinate(entry.row, zone.id));
    const inherited = this.#inherited(entry.row, zone.id, own);
    const saved = own?.target ?? null;
    const disabled =
      saved?.kind === "station" && this.#station(saved.stationId)?.active !== true ? saved : null;
    const offered = own !== undefined && disabled === null;
    const options: ComboboxOption[] = [
      { value: "", label: t("routing.clear") },
      ...this.#activeStations().map((station) => ({
        value: `${STATION}${station.id}`,
        label: station.name,
      })),
      { value: NO_PREPARATION, label: t("prep.no_preparation") },
    ];
    const label = format("routing.cell_label", {
      row: this.#rowName(entry),
      zone: zone.name,
      value: this.#targetText(own === undefined ? inherited : saved),
      state: t(own === undefined ? "routing.inherited" : "routing.set_here"),
    });
    return html`<wt-combobox
        name="routing-target"
        hide-label
        label=${label}
        search="auto"
        searchPlaceholder=${t("venue.combobox_search")}
        noResultsLabel=${t("venue.combobox_no_results")}
        .options=${options}
        .value=${live(offered ? encode(saved) : "")}
        placeholder=${
          disabled !== null
            ? (this.#station(disabled.stationId)?.name ?? disabled.stationId)
            : this.#targetText(inherited)
        }
        error=${this.#refusalAt(address)}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          const target = decode(event.detail.value);
          if (target === undefined || encode(target) === encode(saved)) return;
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
        .options=${this.#activeStations().map((station) => ({
          value: `${STATION}${station.id}`,
          label: station.name,
        }))}
        .value=${live(active ? `${STATION}${active.id}` : "")}
        placeholder=${t("routing.no_station")}
        error=${this.#refusalAt(address)}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
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
    if (entry.row.kind === "all") return t("routing.all_categories");
    const row = entry.row;
    const parent =
      row.kind === "category"
        ? (this.model!.categories.find((c) => c.id === row.categoryId)?.parentId ?? null)
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
        <span aria-hidden="true">${expanded ? "▾" : "▸"}</span> ${entry.name}</button
      >${hidden ? html` <span class="hidden">${hidden}</span>` : nothing}`;
  }

  override render() {
    const model = this.model;
    if (model === null) return nothing;
    const entries = visibleRoutingRows(model, this.expanded);
    const zones = [{ id: null, name: t("routing.every_zone") }, ...model.zones];
    // A category's children follow it in place only when it is shown and expanded.
    const open = new Set(
      entries.flatMap((entry) =>
        !isNoCategoryHeading(entry) &&
        entry.row.kind === "category" &&
        this.expanded.has(entry.row.categoryId)
          ? [entry.row.categoryId]
          : [],
      ),
    );
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
        <table aria-label=${t("routing.grid")}>
          <thead>
            <tr>
              <th scope="col">${t("routing.row_heading")}</th>
              ${zones.map((zone) => html`<th scope="col">${zone.name}</th>`)}
            </tr>
          </thead>
          <tbody>
            ${repeat(
              entries,
              (entry) => (isNoCategoryHeading(entry) ? "heading" : rowKey(entry.row)),
              (entry) =>
                isNoCategoryHeading(entry)
                  ? html`<tr class="heading">
                      <th scope="rowgroup" colspan=${zones.length + 1}>
                        ${t("routing.no_category")}
                      </th>
                    </tr>`
                  : html`<tr>
                      <th
                        scope="row"
                        style=${styleMap({ "--routing-depth": String(entry.path.length) })}
                      >
                        <span class="label">${this.#rowLabel(entry, open)}</span>
                      </th>
                      ${zones.map(
                        (zone) =>
                          html`<td data-row=${rowKey(entry.row)} data-zone=${zoneKey(zone.id)}>
                            ${
                              entry.row.kind === "all" && zone.id === null
                                ? this.#defaultCell()
                                : this.#editor(entry, zone)
                            }
                          </td>`,
                      )}
                    </tr>`,
            )}
          </tbody>
        </table>
      </div>
      <wt-form-actions .error=${this.refusal?.message ?? ""}></wt-form-actions>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "venue-routing-grid": RoutingGrid;
  }
}
