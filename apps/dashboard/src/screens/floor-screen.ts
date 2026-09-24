import { DraftRows } from "@waitron/dashboard-kit";
import { DashboardQueries } from "../api/query-controller.js";
import { dashboardPath } from "../navigation.js";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
// The `@waitron/ui` barrel registers `<wt-floor-canvas>` and `<wt-table-token>`, used here by tag.
import {
  submitOnEnter,
  baseStyles,
  UrlStateController,
  buildZoneTabs,
  defaultTraySlot,
  floorTrayStyles,
  isTableZoneless,
  resolveActiveTabKey,
  selectStyles,
  toFloorTable,
} from "@waitron/ui";
import type { FloorCanvasCopy, FloorTable, PlacementChange, PlacementClear } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-card.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import type { DashboardApi, DashboardTable, FloorZone, TableShape } from "../api/client.js";

interface EditableZone {
  id: string;
  name: string;
  displayOrder: number;
}

/** The placement fields are `null` while the table is unplaced, in the Plano tab's tray. */
interface EditableTable {
  id: string;
  label: string;
  capacity: number | null;
  zoneId: string | null;
  posX: number | null;
  posY: number | null;
  shape: TableShape | null;
  rotation: number | null;
}

/**
 * Floor zones and dining tables: a config tab of per-row forms and a Plano tab with the floor canvas.
 * Every mutation reloads afterwards. A row's save reads its values from state at click time, not
 * from a render closure, so an edit made just before the click is the one that persists.
 */
@customElement("dashboard-floor-screen")
export class FloorScreen extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    floorTrayStyles,
    css`
      :host {
        display: block;
      }
      .title {
        margin: 0 0 var(--wt-space-4);
        font-size: var(--wt-font-size-lg);
        color: var(--wt-color-text);
      }
      .panels {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-6);
      }
      .panel {
        flex: 1;
        min-width: 18rem;
      }
      .panel-title {
        margin: 0 0 var(--wt-space-3);
        font-size: var(--wt-font-size-md);
        color: var(--wt-color-text);
      }
      ol {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--wt-space-3);
      }
      .empty {
        color: var(--wt-color-text-muted);
      }
      .row {
        display: flex;
        gap: var(--wt-space-3);
        align-items: flex-end;
        flex-wrap: wrap;
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        color: var(--wt-color-text);
      }
      .new {
        display: flex;
        gap: var(--wt-space-3);
        align-items: flex-end;
        margin-top: var(--wt-space-6);
        flex-wrap: wrap;
      }
      .error {
        color: var(--wt-color-danger);
        margin-top: var(--wt-space-3);
      }
      /* The top-level tab strip (Zonas y mesas | Plano) and, within Plano, the per-zone sub-tabs. */
      .tabs,
      .zone-tabs {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
        margin-bottom: var(--wt-space-4);
      }
      /* The Plano tab: the canvas with its unplaced-tables tray stacked beneath it. The tray's own
         rules (.tray / .tray-label / .tray-item) live in @waitron/ui's shared floorTrayStyles. */
      .plano,
      .map {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  readonly #zonesDrafts = new DraftRows<EditableZone>();
  readonly #tablesDrafts = new DraftRows<EditableTable>();
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.errorKey = codeOf(error);
    },
  );

  @state() private submitting = false;
  @state() private zones: EditableZone[] = [];
  @state() private tables: EditableTable[] = [];
  @state() private newZone = "";
  @state() private newTable = "";
  @state() private errorKey: string | null = null;
  @state() private activeTab: "config" | "plano" = "config";
  // `null` is the "Sin zona" tab; `undefined` means none picked yet, which resolves to the first tab.
  @state() private activeZone: string | null | undefined = undefined;

  readonly #url = new UrlStateController(
    this,
    () => {
      this.activeTab = this.#url.read("floor-view") === "plano" ? "plano" : "config";
      const zone = this.#url.read("floor-zone");
      this.activeZone = zone === null ? undefined : zone === "" ? null : zone;
    },
    dashboardPath,
  );

  #selectView(view: "config" | "plano"): void {
    this.activeTab = view;
    this.#url.write({ dashboard: "floor", "floor-view": view });
  }

  #selectZone(zone: string | null): void {
    this.activeZone = zone;
    this.#url.write({ dashboard: "floor", "floor-zone": zone ?? "" });
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  #toEditableTables(tables: DashboardTable[]): EditableTable[] {
    return tables.map((t) => ({
      id: t.id,
      label: t.label,
      capacity: t.capacity,
      zoneId: t.zoneId,
      posX: t.posX ?? null,
      posY: t.posY ?? null,
      shape: t.shape ?? null,
      rotation: t.rotation ?? null,
    }));
  }

  async #load(): Promise<void> {
    this.errorKey = null;
    try {
      await Promise.all([
        this.#queries.watch("listZones", [], (rows) => {
          this.zones = this.#zonesDrafts.merge(
            this.zones,
            rows.map((z: FloorZone) => ({ id: z.id, name: z.name, displayOrder: z.displayOrder })),
          );
        }),
        this.#queries.watch("listTables", [], (rows) => {
          this.tables = this.#tablesDrafts.merge(this.tables, this.#toEditableTables(rows));
        }),
      ]);
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** For placement writes, which cannot change the zone list. */
  async #loadTables(): Promise<void> {
    this.errorKey = null;
    try {
      await this.#queries.watch("listTables", [], (rows) => {
        this.tables = this.#tablesDrafts.merge(this.tables, this.#toEditableTables(rows));
      });
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  // ── Zonas ────────────────────────────────────────────────────────────────────────────────────────

  #onNewZone(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.newZone = event.detail.value;
  }

  async #createZone(): Promise<void> {
    if (this.submitting) return;
    this.errorKey = null;
    const name = this.newZone.trim();
    if (name === "") return;
    this.submitting = true;
    try {
      await this.api.createZone({ name });
      this.newZone = "";
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.submitting = false;
    }
  }

  #editZone(id: string, patch: Partial<EditableZone>): void {
    this.zones = this.zones.map((z) => (z.id === id ? { ...z, ...patch } : z));
  }

  async #saveZone(id: string): Promise<void> {
    if (this.submitting) return;
    this.errorKey = null;
    const row = this.zones.find((z) => z.id === id);
    if (row === undefined) return;
    this.submitting = true;
    try {
      await this.api.updateZone(row.id, { name: row.name, displayOrder: row.displayOrder });
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.submitting = false;
    }
  }

  async #deactivateZone(id: string): Promise<void> {
    this.errorKey = null;
    try {
      await this.api.deactivateZone(id);
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  // ── Mesas ────────────────────────────────────────────────────────────────────────────────────────

  #onNewTable(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.newTable = event.detail.value;
  }

  async #createTable(): Promise<void> {
    if (this.submitting) return;
    this.errorKey = null;
    const label = this.newTable.trim();
    if (label === "") return;
    this.submitting = true;
    try {
      await this.api.createTable({ label });
      this.newTable = "";
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.submitting = false;
    }
  }

  #editTable(id: string, patch: Partial<EditableTable>): void {
    this.tables = this.tables.map((tbl) => (tbl.id === id ? { ...tbl, ...patch } : tbl));
  }

  async #saveTable(id: string): Promise<void> {
    if (this.submitting) return;
    this.errorKey = null;
    const row = this.tables.find((tbl) => tbl.id === id);
    if (row === undefined) return;
    const patch: { label: string; capacity?: number } = { label: row.label };
    if (row.capacity !== null) patch.capacity = row.capacity;
    this.submitting = true;
    try {
      await this.api.updateTable(row.id, patch);
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.submitting = false;
    }
  }

  #onAssignZone(id: string, event: Event): void {
    event.stopPropagation();
    const zoneId = (event.target as HTMLSelectElement).value;
    if (zoneId === "") return;
    void this.#assignZone(id, zoneId);
  }

  async #assignZone(id: string, zoneId: string): Promise<void> {
    this.errorKey = null;
    try {
      await this.api.updateTable(id, { zoneId });
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  async #deactivateTable(id: string): Promise<void> {
    this.errorKey = null;
    try {
      await this.api.deactivateTable(id);
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────────────────────────────

  #renderZone(z: EditableZone): TemplateResult {
    return html`<li data-test="zone-row-${z.id}">
      <wt-card>
        <div class="row">
          <wt-input
            @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>(`[data-test="zone-save-${z.id}"]`))}
            label=${t("floor.zone_name")}
            data-test="zone-name-${z.id}"
            .value=${z.name}
            @wt-change=${(e: CustomEvent<{ value: string }>) => {
              e.stopPropagation();
              this.#editZone(z.id, { name: e.detail.value });
            }}
          ></wt-input>
          <wt-input
            @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>(`[data-test="zone-save-${z.id}"]`))}
            type="number"
            label=${t("floor.zone_order")}
            data-test="zone-order-${z.id}"
            .value=${String(z.displayOrder)}
            @wt-change=${(e: CustomEvent<{ value: string }>) => {
              e.stopPropagation();
              this.#editZone(z.id, { displayOrder: Number(e.detail.value) || 0 });
            }}
          ></wt-input>
          <wt-button
            variant="primary"
            size="sm"
            data-test="zone-save-${z.id}"
            ?disabled=${this.submitting}
            @click=${() => void this.#saveZone(z.id)}
            >${t("action.save")}</wt-button
          >
          <wt-button
            variant="danger"
            size="sm"
            data-test="zone-deactivate-${z.id}"
            @click=${() => void this.#deactivateZone(z.id)}
            >${t("action.deactivate")}</wt-button
          >
        </div>
      </wt-card>
    </li>`;
  }

  #renderTable(tbl: EditableTable): TemplateResult {
    const selected = tbl.zoneId ?? "";
    return html`<li data-test="table-row-${tbl.id}">
      <wt-card>
        <div class="row">
          <wt-input
            @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>(`[data-test="table-save-${tbl.id}"]`))}
            label=${t("floor.table_label")}
            data-test="table-label-${tbl.id}"
            .value=${tbl.label}
            @wt-change=${(e: CustomEvent<{ value: string }>) => {
              e.stopPropagation();
              this.#editTable(tbl.id, { label: e.detail.value });
            }}
          ></wt-input>
          <wt-input
            @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>(`[data-test="table-save-${tbl.id}"]`))}
            type="number"
            label=${t("floor.table_capacity")}
            data-test="table-capacity-${tbl.id}"
            .value=${tbl.capacity === null ? "" : String(tbl.capacity)}
            @wt-change=${(e: CustomEvent<{ value: string }>) => {
              e.stopPropagation();
              const raw = e.detail.value.trim();
              this.#editTable(tbl.id, {
                capacity: raw === "" ? null : Math.max(0, Math.trunc(Number(raw)) || 0),
              });
            }}
          ></wt-input>
          <label class="field"
            >${t("floor.table_zone")}
            <select
              data-test="table-zone-${tbl.id}"
              @change=${(e: Event) => this.#onAssignZone(tbl.id, e)}
            >
              ${
                // Offered only while the table has no zone: the table update takes no null `zoneId`,
                // so a blank on an assigned table would show it cleared while the server kept the zone.
                tbl.zoneId === null
                  ? html`<option value="" selected>${t("floor.no_zone")}</option>`
                  : nothing
              }
              ${this.zones.map(
                (z) =>
                  html`<option value=${z.id} .selected=${z.id === selected}>${z.name}</option>`,
              )}
            </select>
          </label>
          <wt-button
            variant="primary"
            size="sm"
            data-test="table-save-${tbl.id}"
            ?disabled=${this.submitting}
            @click=${() => void this.#saveTable(tbl.id)}
            >${t("action.save")}</wt-button
          >
          <wt-button
            variant="danger"
            size="sm"
            data-test="table-deactivate-${tbl.id}"
            @click=${() => void this.#deactivateTable(tbl.id)}
            >${t("action.deactivate")}</wt-button
          >
        </div>
      </wt-card>
    </li>`;
  }

  // ── Plano ─────────────────────────────────────────────────────────────────────────────────────────

  async #setPlacement(detail: PlacementChange): Promise<void> {
    this.errorKey = null;
    const { tableId, posX, posY, shape, rotation, zoneId } = detail;
    try {
      await this.api.setTablePlacement(tableId, { posX, posY, shape, rotation, zoneId });
      await this.#loadTables();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  #onPlacementChange(event: Event): void {
    event.stopPropagation();
    void this.#setPlacement((event as CustomEvent<PlacementChange>).detail);
  }

  async #clearTablePlacement(tableId: string): Promise<void> {
    this.errorKey = null;
    try {
      await this.api.clearPlacement(tableId);
      await this.#loadTables();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  #onPlacementClear(event: Event): void {
    event.stopPropagation();
    void this.#clearTablePlacement((event as CustomEvent<PlacementClear>).detail.tableId);
  }

  async #placeFromTray(tbl: EditableTable, placedCount: number): Promise<void> {
    const { posX, posY } = defaultTraySlot(placedCount);
    await this.#setPlacement({
      tableId: tbl.id,
      posX,
      posY,
      shape: tbl.shape ?? "round",
      rotation: tbl.rotation ?? 0,
      zoneId: tbl.zoneId,
    });
  }

  /** The dashboard has no live occupancy, so every table is drawn as free. */
  #toFloorTable(tbl: EditableTable): FloorTable {
    return toFloorTable(tbl, { state: "free", tabTotal: null, pendingToServe: 0, status: null });
  }

  #canvasCopy(): Partial<FloorCanvasCopy> {
    return {
      floor: t("floor.title"),
      covers: t("floor.covers"),
      toServe: t("floor.to_serve"),
      zone: t("floor.table_zone"),
      rotate: t("floor.rotate"),
      remove: t("floor.remove"),
      shape: t("floor.shape"),
      shapeRound: t("floor.shape_round"),
      shapeSquare: t("floor.shape_square"),
      shapeRect: t("floor.shape_rect"),
    };
  }

  // ── Render ─────────────────────────────────────────────────────────────────────────────────────────

  #topTab(key: "config" | "plano", label: string): TemplateResult {
    return html`<wt-button
      class="tab"
      data-tab=${key}
      variant=${this.activeTab === key ? "primary" : "secondary"}
      @click=${() => this.#selectView(key)}
      >${label}</wt-button
    >`;
  }

  #zoneTab(
    tab: { key: string | null; name: string },
    activeKey: string | null | undefined,
  ): TemplateResult {
    return html`<wt-button
      class="zone-tab"
      data-zone=${tab.key ?? "none"}
      variant=${tab.key === activeKey ? "primary" : "secondary"}
      @click=${() => this.#selectZone(tab.key)}
      >${tab.name}</wt-button
    >`;
  }

  #trayItem(tbl: EditableTable, placedCount: number): TemplateResult {
    return html`<button
      class="tray-item"
      data-tray-table=${tbl.id}
      @click=${() => void this.#placeFromTray(tbl, placedCount)}
    >
      <wt-table-token
        .table=${this.#toFloorTable(tbl)}
        .labels=${{ covers: t("floor.covers"), toServe: t("floor.to_serve") }}
      ></wt-table-token>
    </button>`;
  }

  #renderConfig(): TemplateResult {
    return html`
      <div class="panels">
        <section class="panel" data-test="zones-panel">
          <h2 class="panel-title">${t("floor.zones_title")}</h2>
          ${
            this.zones.length === 0
              ? html`<p class="empty">${t("floor.no_zones")}</p>`
              : html`<ol>
                  ${this.zones.map((z) => this.#renderZone(z))}
                </ol>`
          }
          <div class="new">
            <wt-input
              @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-add-zone]"))}
              label=${t("floor.new_zone")}
              data-new-zone
              .value=${this.newZone}
              @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onNewZone(e)}
            ></wt-input>
            <wt-button
              variant="primary"
              data-add-zone
              ?disabled=${this.submitting}
              @click=${() => void this.#createZone()}
              >${t("floor.add_zone")}</wt-button
            >
          </div>
        </section>

        <section class="panel" data-test="tables-panel">
          <h2 class="panel-title">${t("floor.tables_title")}</h2>
          ${
            this.tables.length === 0
              ? html`<p class="empty">${t("floor.no_tables")}</p>`
              : html`<ol>
                  ${this.tables.map((tbl) => this.#renderTable(tbl))}
                </ol>`
          }
          <div class="new">
            <wt-input
              @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-add-table]"))}
              label=${t("floor.table_label")}
              data-new-table
              .value=${this.newTable}
              @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onNewTable(e)}
            ></wt-input>
            <wt-button
              variant="primary"
              data-add-table
              ?disabled=${this.submitting}
              @click=${() => void this.#createTable()}
              >${t("floor.add_table")}</wt-button
            >
          </div>
        </section>
      </div>
    `;
  }

  #renderPlano(): TemplateResult {
    const knownZoneIds = new Set(this.zones.map((z) => z.id));
    const tabs = buildZoneTabs(this.zones, this.tables, t("floor.zoneless"));
    const activeKey = resolveActiveTabKey(this.activeZone, tabs);
    // The "Sin zona" tab also gathers tables whose zone has been deactivated.
    const visible = this.tables.filter((tbl) =>
      activeKey === null ? isTableZoneless(tbl, knownZoneIds) : tbl.zoneId === activeKey,
    );
    const placed = visible.filter((tbl) => tbl.posX != null);
    const unplaced = visible.filter((tbl) => tbl.posX == null);
    return html`
      <div class="plano">
        ${
          tabs.length > 0
            ? html`<nav class="zone-tabs" aria-label=${t("floor.tables_title")}>
                ${tabs.map((tab) => this.#zoneTab(tab, activeKey))}
              </nav>`
            : nothing
        }
        <div class="map">
          <wt-floor-canvas
            .tables=${placed.map((tbl) => this.#toFloorTable(tbl))}
            .editable=${true}
            .copy=${this.#canvasCopy()}
            @wt-placement-change=${(e: Event) => this.#onPlacementChange(e)}
            @wt-placement-clear=${(e: Event) => this.#onPlacementClear(e)}
          ></wt-floor-canvas>
          ${
            unplaced.length > 0
              ? html`<div class="tray" aria-label=${t("floor.unplaced")}>
                  <span class="tray-label">${t("floor.unplaced")}</span>
                  ${unplaced.map((tbl) => this.#trayItem(tbl, placed.length))}
                </div>`
              : nothing
          }
        </div>
      </div>
    `;
  }

  override render(): TemplateResult {
    return html`
      <h1 class="title">${t("floor.title")}</h1>
      <nav class="tabs" aria-label=${t("floor.title")}>
        ${this.#topTab("config", t("floor.tab_config"))}
        ${this.#topTab("plano", t("floor.tab_plano"))}
      </nav>
      ${this.activeTab === "config" ? this.#renderConfig() : this.#renderPlano()}
      ${this.errorKey ? html`<p class="error" role="alert">${codeMessage(this.errorKey)}</p>` : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-floor-screen": FloorScreen;
  }
}
