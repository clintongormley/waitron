import { DraftRows } from "@waitron/dashboard-kit";
import { DashboardQueries } from "../api/query-controller.js";
import { dashboardPath } from "../navigation.js";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
// The `@waitron/ui` barrel registers `<wt-floor-canvas>` and `<wt-table-token>`, used here by tag.
import {
  leaveCoordinatorFor,
  type DraftScope,
  submitOnEnter,
  baseStyles,
  UrlStateController,
  buildZoneTabs,
  defaultTraySlot,
  floorTrayStyles,
  isTableZoneless,
  resolveActiveTabKey,
  toFloorTable,
} from "@waitron/ui";
import type { FloorCanvasCopy, FloorTable, PlacementChange, PlacementClear } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-card.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import type { DashboardApi, DashboardTable, FloorZone, TableShape } from "../api/client.js";

/** The placement fields are `null` while the table is unplaced, in the Plano tab's tray. */
interface EditableTable {
  id: string;
  label: string;
  active: boolean;
  capacity: number | null;
  zoneId: string | null;
  posX: number | null;
  posY: number | null;
  shape: TableShape | null;
  rotation: number | null;
}

interface TableDraft {
  label: string;
  capacity: number | null;
}

function tableDraft(row: EditableTable): TableDraft {
  return { label: row.label, capacity: row.capacity };
}

function sameDraft(a: TableDraft, b: TableDraft): boolean {
  return a.label === b.label && a.capacity === b.capacity;
}

@customElement("dashboard-floor-screen")
export class FloorScreen extends LitElement {
  static override styles = [
    baseStyles,
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
      .disabled-group {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-3);
      }
      .disabled {
        color: var(--wt-color-text-muted);
      }
      .row {
        display: flex;
        gap: var(--wt-space-3);
        align-items: flex-end;
        flex-wrap: wrap;
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
  #tablesDrafts = new DraftRows<EditableTable>();
  readonly #rowScopes = new Map<string, { scope: DraftScope<TableDraft>; saved: TableDraft }>();
  #newScope?: DraftScope<string>;
  #connection = 0;

  #registerNew(): void {
    if (this.#newScope) return;
    this.#newScope = leaveCoordinatorFor(this)?.register({
      id: {},
      parent: this,
      current: () => this.newTable,
      snapshot: (value) => value,
      equal: (a, b) => a.trim() === b.trim(),
      restore: (value) => {
        this.newTable = value;
      },
    });
  }

  #acceptTables(rows: EditableTable[]): void {
    const current = new Map(this.tables.map((row) => [row.id, row]));
    const dirty = new Set(
      [...this.#rowScopes].filter(([, entry]) => entry.scope.isDirty()).map(([id]) => id),
    );
    const merged = this.#tablesDrafts.merge(this.tables, rows);
    for (const [id, entry] of this.#rowScopes) {
      if (!rows.some((row) => row.id === id) && !dirty.has(id)) {
        entry.scope.dispose();
        this.#rowScopes.delete(id);
      }
    }
    this.tables = rows.map((row, index) => {
      const entry = this.#rowScopes.get(row.id);
      if (!entry) return merged[index]!;
      const draft = current.get(row.id)!;
      return {
        ...row,
        label: draft.label === entry.saved.label ? row.label : draft.label,
        capacity: draft.capacity === entry.saved.capacity ? row.capacity : draft.capacity,
      };
    });
    for (const id of dirty) {
      if (!rows.some((row) => row.id === id)) this.tables = [...this.tables, current.get(id)!];
    }
    const coordinator = leaveCoordinatorFor(this);
    if (!coordinator) return;
    for (const row of this.tables) {
      const entry = this.#rowScopes.get(row.id);
      if (entry) {
        const before = current.get(row.id)!;
        const saved = {
          label: before.label === entry.saved.label ? row.label : entry.saved.label,
          capacity: before.capacity === entry.saved.capacity ? row.capacity : entry.saved.capacity,
        };
        if (!sameDraft(saved, entry.saved)) {
          entry.saved = saved;
          entry.scope.commit(saved);
        }
      } else {
        const scope = coordinator.register({
          id: {},
          parent: this,
          current: () => tableDraft(this.tables.find((value) => value.id === row.id)!),
          snapshot: (value) => ({ ...value }),
          equal: sameDraft,
          restore: (value) => {
            this.tables = this.tables.map((draft) =>
              draft.id === row.id ? { ...draft, ...value } : draft,
            );
          },
        });
        this.#rowScopes.set(row.id, { scope, saved: tableDraft(row) });
      }
    }
  }
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => this.#showReadError(error),
    () => {
      if (this.#readErrorShown) this.#showError(null);
    },
  );

  @state() private submitting = false;
  @state() private zones: FloorZone[] = [];
  @state() private tables: EditableTable[] = [];
  @state() private newTable = "";
  @state() private errorKey: string | null = null;
  /** Whether `errorKey` is a read's failure, the only message the reads' recovery may clear. */
  #readErrorShown = false;
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

  #showError(code: string | null, fromRead = false): void {
    this.errorKey = code;
    this.#readErrorShown = fromRead;
  }

  /** A read's failure never replaces an action's message. */
  #showReadError(error: unknown): void {
    if (this.errorKey === null || this.#readErrorShown) this.#showError(codeOf(error), true);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#showError(null);
    this.#registerNew();
    void this.#load();
  }

  override disconnectedCallback(): void {
    this.#connection++;
    this.#newScope?.dispose();
    this.#newScope = undefined;
    for (const entry of this.#rowScopes.values()) entry.scope.dispose();
    this.#rowScopes.clear();
    this.tables = [];
    this.#tablesDrafts = new DraftRows<EditableTable>();
    this.newTable = "";
    this.submitting = false;
    super.disconnectedCallback();
  }

  #toEditableTables(tables: DashboardTable[]): EditableTable[] {
    return tables.map((t) => ({
      id: t.id,
      label: t.label,
      active: t.active,
      capacity: t.capacity,
      zoneId: t.zoneId,
      posX: t.posX ?? null,
      posY: t.posY ?? null,
      shape: t.shape ?? null,
      rotation: t.rotation ?? null,
    }));
  }

  async #load(): Promise<void> {
    const connection = this.#connection;
    if (this.#readErrorShown) this.#showError(null);
    try {
      await Promise.all([
        this.#queries.watch("listZones", [], (rows) => {
          this.zones = rows;
        }),
        this.#queries.watch("listTables", [{ includeDisabled: true }], (rows) => {
          this.#acceptTables(this.#toEditableTables(rows));
        }),
      ]);
    } catch (error) {
      if (connection === this.#connection) this.#showReadError(error);
    }
  }

  /** For placement writes, which cannot change the zone list. */
  async #loadTables(): Promise<void> {
    const connection = this.#connection;
    if (this.#readErrorShown) this.#showError(null);
    try {
      await this.#queries.watch("listTables", [{ includeDisabled: true }], (rows) => {
        this.#acceptTables(this.#toEditableTables(rows));
      });
    } catch (error) {
      if (connection === this.#connection) this.#showReadError(error);
    }
  }

  // ── Mesas ────────────────────────────────────────────────────────────────────────────────────────

  #onNewTable(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.newTable = event.detail.value;
    this.#newScope?.changed();
  }

  async #createTable(): Promise<void> {
    if (this.submitting) return;
    this.#showError(null);
    const label = this.newTable.trim();
    if (label === "") return;
    const connection = this.#connection;
    const scope = this.#newScope;
    this.submitting = true;
    try {
      await this.api.createTable({ label });
      if (connection !== this.#connection) return;
      if (this.newTable.trim() === label) this.newTable = "";
      scope?.commit("");
      await this.#load();
    } catch (error) {
      if (connection === this.#connection) this.#showError(codeOf(error));
    } finally {
      if (connection === this.#connection) this.submitting = false;
    }
  }

  #editTable(id: string, patch: Partial<EditableTable>): void {
    this.tables = this.tables.map((tbl) => (tbl.id === id ? { ...tbl, ...patch } : tbl));
    this.#rowScopes.get(id)?.scope.changed();
  }

  async #saveTable(id: string): Promise<void> {
    if (this.submitting) return;
    this.#showError(null);
    const row = this.tables.find((tbl) => tbl.id === id);
    if (row === undefined) return;
    const patch: { label: string; capacity?: number } = { label: row.label };
    if (row.capacity !== null) patch.capacity = row.capacity;
    const submitted = tableDraft(row);
    const entry = this.#rowScopes.get(id);
    const connection = this.#connection;
    this.submitting = true;
    try {
      await this.api.updateTable(row.id, patch);
      if (connection !== this.#connection) return;
      if (entry) {
        entry.saved = submitted;
        entry.scope.commit(submitted);
      }
      await this.#load();
    } catch (error) {
      if (connection === this.#connection) this.#showError(codeOf(error));
    } finally {
      if (connection === this.#connection) this.submitting = false;
    }
  }

  #onAssignZone(id: string, event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    const zoneId = event.detail.value;
    if (zoneId === "") return;
    void this.#assignZone(id, zoneId);
  }

  async #assignZone(id: string, zoneId: string): Promise<void> {
    const connection = this.#connection;
    this.#showError(null);
    try {
      await this.api.updateTable(id, { zoneId });
      if (connection !== this.#connection) return;
      await this.#load();
    } catch (error) {
      if (connection === this.#connection) this.#showError(codeOf(error));
    }
  }

  async #deactivateTable(id: string): Promise<void> {
    const connection = this.#connection;
    this.#showError(null);
    try {
      await this.api.deactivateTable(id);
      if (connection !== this.#connection) return;
      await this.#load();
    } catch (error) {
      if (connection === this.#connection) this.#showError(codeOf(error));
    }
  }

  async #enableTable(id: string): Promise<void> {
    const connection = this.#connection;
    this.#showError(null);
    try {
      await this.api.updateTable(id, { active: true });
      if (connection !== this.#connection) return;
      await this.#load();
    } catch (error) {
      if (connection === this.#connection) this.#showError(codeOf(error));
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────────────────────────────

  #renderTable(tbl: EditableTable): TemplateResult {
    return html`<li data-test="table-row-${tbl.id}">
      <wt-card>
        <div class="row">
          <wt-input
            @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>(`[data-test="table-save-${tbl.id}"]`))}
            label=${t("floor.table_label")}
            name="table-label"
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
            name="table-capacity"
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
          <wt-combobox
            data-test="table-zone-${tbl.id}"
            name="table-zone"
            label=${t("floor.table_zone")}
            search="auto"
            placeholder=${t("floor.no_zone")}
            searchPlaceholder=${t("categories.combobox_search")}
            noResultsLabel=${t("categories.combobox_no_results")}
            .options=${[
              // Offered only while the table has no zone: the table update takes no null `zoneId`,
              // so a blank on an assigned table would show it cleared while the server kept the zone.
              ...(tbl.zoneId === null ? [{ value: "", label: t("floor.no_zone") }] : []),
              ...this.zones.map((z) => ({ value: z.id, label: z.name })),
            ]}
            .value=${live(tbl.zoneId ?? "")}
            @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onAssignZone(tbl.id, e)}
          ></wt-combobox>
          <wt-button
            variant="primary"
            size="sm"
            data-test="table-save-${tbl.id}"
            ?disabled=${this.submitting}
            @click=${() => void this.#saveTable(tbl.id)}
            >${t("action.save")}</wt-button
          >
          ${
            tbl.active
              ? html`<wt-button
                  variant="danger"
                  size="sm"
                  data-test="table-deactivate-${tbl.id}"
                  @click=${() => void this.#deactivateTable(tbl.id)}
                  >${t("action.disable")}</wt-button
                >`
              : html`<span class="disabled-group"
                  ><span class="disabled" data-test="table-status-${tbl.id}"
                    >${t("floor.table_disabled")}</span
                  >${
                    tbl.zoneId === null || this.zones.some((zone) => zone.id === tbl.zoneId)
                      ? html`<wt-button
                          variant="secondary"
                          size="sm"
                          data-test="table-enable-${tbl.id}"
                          @click=${() => void this.#enableTable(tbl.id)}
                          >${t("action.enable")}</wt-button
                        >`
                      : nothing
                  }</span
                >`
          }
        </div>
      </wt-card>
    </li>`;
  }

  // ── Plano ─────────────────────────────────────────────────────────────────────────────────────────

  async #setPlacement(detail: PlacementChange): Promise<void> {
    const connection = this.#connection;
    this.#showError(null);
    const { tableId, posX, posY, shape, rotation, zoneId } = detail;
    try {
      await this.api.setTablePlacement(tableId, { posX, posY, shape, rotation, zoneId });
      if (connection !== this.#connection) return;
      await this.#loadTables();
    } catch (error) {
      if (connection === this.#connection) this.#showError(codeOf(error));
    }
  }

  #onPlacementChange(event: Event): void {
    event.stopPropagation();
    void this.#setPlacement((event as CustomEvent<PlacementChange>).detail);
  }

  async #clearTablePlacement(tableId: string): Promise<void> {
    const connection = this.#connection;
    this.#showError(null);
    try {
      await this.api.clearPlacement(tableId);
      if (connection !== this.#connection) return;
      await this.#loadTables();
    } catch (error) {
      if (connection === this.#connection) this.#showError(codeOf(error));
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
              name="new-table-label"
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
    const tables = this.tables.filter((tbl) => tbl.active);
    const tabs = buildZoneTabs(this.zones, tables, t("floor.zoneless"));
    const activeKey = resolveActiveTabKey(this.activeZone, tabs);
    // The "Sin zona" tab also gathers tables whose zone has been deactivated.
    const visible = tables.filter((tbl) =>
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
