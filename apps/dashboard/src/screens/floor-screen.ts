import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
// `baseStyles` also loads the `@waitron/ui` barrel, which self-registers `<wt-floor-canvas>` and
// `<wt-table-token>` — the FP-2 shared components the Plano tab consumes by tag. `GRID_STEP` /
// `clampPermille` size the tap-to-place default slot; the type-only imports carry the canvas's
// copy / table / placement-event shapes.
import {
  baseStyles,
  buildZoneTabs,
  defaultTraySlot,
  floorTrayStyles,
  isTableZoneless,
  resolveActiveTabKey,
  toFloorTable,
} from "@waitron/ui";
import type { FloorCanvasCopy, FloorTable, PlacementChange, PlacementClear } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-card.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import type { DashboardApi, DashboardTable, FloorZone, TableShape } from "../api/client.js";
import { selectStyles } from "../select-styles.js";

/** A floor zone the editor holds in local, editable state (a defensive copy of the loaded FloorZone). */
interface EditableZone {
  id: string;
  name: string;
  displayOrder: number;
}

/** A dining table the editor holds in local, editable state. `capacity`/`zoneId` stay nullable — a
 * table may sit in no zone and carry no seat count. The FP-2 placement fields are `null` when the table
 * is UNPLACED (it sits in the Plano tab's tray until tap-to-placed); a placed table carries its canvas
 * coordinates + shape + rotation and draws on the `wt-floor-canvas`. */
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
 * The management dashboard's FLOOR-PLAN SCREEN: configures the venue's floor zones and dining
 * tables (FP-1, design §3d), mirroring `service-status-screen.ts`/`layout-screen.ts`. On connect it
 * loads `api.listZones()` + `api.listTables()` into editable rows across two panels — Zonas and Mesas.
 * A Zona row edits its name + display order and Guardar-s it; a Mesa row edits its label + seat count
 * and Guardar-s it, and its zone <select> ASSIGNS the table to a zone the moment it changes. A
 * "new zone" / "new table" form authors a fresh one from just a name/label.
 *
 * Each mutation drives the PER-ITEM CRUD on the injected `api` and RELOADS both lists afterwards (the
 * `service-status-screen` idiom): FP-1's routes are per-item POST/PATCH/DELETE, not a single bulk PUT,
 * so create, save-row, assign-zone and deactivate each hit one endpoint then call `#load` to resync.
 * A row's save reads its CURRENT values from state at click time (like `layout-screen`'s `#save`),
 * never a stale render closure, so an edit made just before the click is the one that persists.
 *
 * The zone <select> can only ASSIGN a zone, never clear one: the table PATCH route takes a `zoneId`
 * string and has no null form (clearing is a deferred backlog follow-up). So the blank "— sin zona —"
 * placeholder is offered ONLY on a table that is genuinely unassigned — never on one that already has a
 * zone, where a selectable blank would visually clear the assignment while it persisted server-side. On
 * an unassigned table the blank is its real current state and re-picking it is a true no-op. Tables
 * deactivate via the DELETE route (there is no `active` field on the table PATCH, and `listTables`
 * returns only active rows), so a Mesa row carries a Desactivar button rather than an active toggle —
 * the same is true of Zonas.
 *
 * Gating is server-side (`till.configure`): the shell hides this nav from a `staff` session and every
 * route re-checks. ERROR HANDLING mirrors the sibling screens — every loader/mutation is fully
 * `try/catch`ed (invoked via `void`), so a rejection becomes `errorKey` (the raw `{ code }`, falling
 * back to `server.internal`) rendered in a `role="alert"` banner, never an unhandled promise rejection.
 * The raw code stays in state; `codeMessage` maps it to localised copy at the render edge, so the banner
 * shows a sentence and never the raw wire code (`zone.name_taken`, `table.label_taken`, `zone.not_found`,
 * `table.not_found`).
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

  /** The HTTP face of the dashboard. The app shell injects a real client; a test injects a stub. */
  @property({ attribute: false }) api!: DashboardApi;

  // The configured zones + tables as editable rows, loaded on connect and re-synced after every mutation.
  @state() private zones: EditableZone[] = [];
  @state() private tables: EditableTable[] = [];
  // The new-zone / new-table forms' single fields.
  @state() private newZone = "";
  @state() private newTable = "";
  @state() private errorKey: string | null = null;
  // FP-2 editor: which top-level tab shows — the FP-1 config panels (Zonas/Mesas) or the Plano canvas.
  // Config is the default, so the FP-1 behaviour is untouched until a manager opens Plano.
  @state() private activeTab: "config" | "plano" = "config";
  // Within Plano, which zone sub-tab is active: a zone id, `null` for the "Sin zona" tab, or `undefined`
  // before a pick (→ the first tab). Kept distinct from a zone id so the default tracks the tab order.
  @state() private activeZone: string | null | undefined = undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  /** Map loaded API table rows into the editor's local `EditableTable` shape. Shared by `#load` (the
   * full reload) and `#loadTables` (the placement-only reload) so the mapping lives in one place. */
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

  /** Load the configured zones + tables into editable rows. A rejection becomes the `errorKey` banner
   * rather than an unhandled rejection. Used on connect and after every mutation that can change the
   * ZONE list (create/save/deactivate a zone or table); the placement handlers use the narrower
   * {@link #loadTables} instead. */
  async #load(): Promise<void> {
    this.errorKey = null;
    try {
      const [zones, tables] = await Promise.all([this.api.listZones(), this.api.listTables()]);
      this.zones = zones.map((z: FloorZone) => ({
        id: z.id,
        name: z.name,
        displayOrder: z.displayOrder,
      }));
      this.tables = this.#toEditableTables(tables);
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Reload ONLY the tables — the narrower resync the PLACEMENT handlers use. A placement write mutates
   * only `dining_tables` (it merely READS `floor_zones` to validate the target zone is active), so the
   * zone LIST is guaranteed unchanged across an edit and re-fetching it via {@link #load} would be a
   * wasted GET per edit. Still re-fetches the TABLE rows (never a local patch) so the client picks up any
   * server-clamped placement values. A rejection becomes the `errorKey` banner, exactly like `#load`. */
  async #loadTables(): Promise<void> {
    this.errorKey = null;
    try {
      this.tables = this.#toEditableTables(await this.api.listTables());
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  // ── Zonas ────────────────────────────────────────────────────────────────────────────────────────

  /** The new-zone field's composed `wt-change`. `stopPropagation` keeps it inside this screen (the
   * house field-handler pattern). */
  #onNewZone(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.newZone = event.detail.value;
  }

  /** Create a zone from the new-zone form, then reload. A blank (whitespace-only) name is a no-op — the
   * server requires one, and this keeps an empty form from firing a doomed request. `displayOrder` is
   * left to the server default (a manager reorders afterwards). A rejection becomes the `errorKey`
   * banner; never an unhandled rejection (called via `void`). */
  async #createZone(): Promise<void> {
    this.errorKey = null;
    const name = this.newZone.trim();
    if (name === "") return;
    try {
      await this.api.createZone({ name });
      this.newZone = "";
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Apply a partial edit to the zone `id` holds, replacing it in state with a fresh object (so a row's
   * edits never mutate a shared reference the render still points at). */
  #editZone(id: string, patch: Partial<EditableZone>): void {
    this.zones = this.zones.map((z) => (z.id === id ? { ...z, ...patch } : z));
  }

  /** Persist the CURRENT name + display order of the zone `id` holds, then reload. Reads the row from
   * state at click time (not a captured render closure), so an edit made immediately before the click is
   * what persists. A vanished row is a no-op. A rejection becomes the `errorKey` banner. */
  async #saveZone(id: string): Promise<void> {
    this.errorKey = null;
    const row = this.zones.find((z) => z.id === id);
    if (row === undefined) return;
    try {
      await this.api.updateZone(row.id, { name: row.name, displayOrder: row.displayOrder });
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Soft-delete (deactivate) the zone `id` holds, then reload. A rejection becomes the `errorKey`
   * banner. */
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

  /** The new-table field's composed `wt-change`. */
  #onNewTable(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.newTable = event.detail.value;
  }

  /** Create a table from the new-table form, then reload. A blank label is a no-op. Zone + capacity are
   * assigned per-row afterwards (the new-table form authors just the label, like the new-zone form). */
  async #createTable(): Promise<void> {
    this.errorKey = null;
    const label = this.newTable.trim();
    if (label === "") return;
    try {
      await this.api.createTable({ label });
      this.newTable = "";
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  #editTable(id: string, patch: Partial<EditableTable>): void {
    this.tables = this.tables.map((tbl) => (tbl.id === id ? { ...tbl, ...patch } : tbl));
  }

  /** Persist the CURRENT label + capacity of the table `id` holds, then reload. A null capacity is
   * omitted from the patch (the route leaves the column untouched), so a table left without a seat count
   * sends only its label. The zone is NOT sent here — it is assigned live by the row's <select>. */
  async #saveTable(id: string): Promise<void> {
    this.errorKey = null;
    const row = this.tables.find((tbl) => tbl.id === id);
    if (row === undefined) return;
    const patch: { label: string; capacity?: number } = { label: row.label };
    if (row.capacity !== null) patch.capacity = row.capacity;
    try {
      await this.api.updateTable(row.id, patch);
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Assign the table `id` holds to the picked zone, then reload. The blank placeholder is offered only
   * on an already-unassigned table (see `#renderTable`), where a re-pick of it (value `""`) is a TRUE
   * no-op: nothing changes, so the select still reflects the real unassigned state (no DOM desync). A
   * rejection becomes the `errorKey` banner. */
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

  /** Soft-delete (deactivate) the table `id` holds, then reload. */
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
            label=${t("floor.zone_name")}
            data-test="zone-name-${z.id}"
            .value=${z.name}
            @wt-change=${(e: CustomEvent<{ value: string }>) => {
              e.stopPropagation();
              this.#editZone(z.id, { name: e.detail.value });
            }}
          ></wt-input>
          <wt-input
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
            label=${t("floor.table_label")}
            data-test="table-label-${tbl.id}"
            .value=${tbl.label}
            @wt-change=${(e: CustomEvent<{ value: string }>) => {
              e.stopPropagation();
              this.#editTable(tbl.id, { label: e.detail.value });
            }}
          ></wt-input>
          <wt-input
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
                // The blank "— sin zona —" placeholder is offered ONLY for a table that is genuinely
                // unassigned (its real current state). Once a table has a zone it is omitted, because
                // clearing a zone is unsupported server-side (the table PATCH takes `zoneId?: string`,
                // no null — a deferred backlog follow-up): a selectable blank on an assigned table would
                // visually clear it while the assignment persisted, desyncing the DOM from state.
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

  // ── Plano (FP-2 spatial floor-plan editor) ────────────────────────────────────────────────────────
  // The same `wt-floor-canvas` (Task 5) the till uses, here ALWAYS in edit mode: the dashboard is
  // manager-only (a management session gates the whole screen and the routes re-check), so there is no
  // operator-role gate — unlike the till, which gates its "Editar plano" toggle on `canEdit`. Placement
  // is persisted through the MANAGEMENT route (`setTablePlacement`/`clearPlacement`, Task 3) and each
  // write RELOADS both lists, the same idiom the config panels use. A rejected write becomes the
  // `errorKey` banner (a `placement.invalid` mapped to localised copy) rather than being swallowed — the
  // dashboard SURFACES the fault, where the till reconciles silently.

  /** Persist a canvas placement edit (`wt-placement-change`) via the management route, then reload only the
   * tables (a placement cannot change the zone list — see {@link #loadTables}). A rejection (e.g.
   * `placement.invalid`, `zone.not_found`) becomes the `errorKey` banner. */
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

  /** Un-place a table (the canvas's `wt-placement-clear`) via the management route, then reload only the
   * tables (a placement cannot change the zone list — see {@link #loadTables}). */
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

  /**
   * Tap-to-place (the owner's chosen UX — no drag-onto-canvas, same as the till's `#placeFromTray`):
   * give an unplaced tray table a DEFAULT position through the management route, then reload so it
   * appears on the canvas for the manager to reposition with the canvas's own drag/keyboard controls.
   * The slot is the centre nudged right by 50‰ per already-placed table (clamped into range) so
   * successive placements don't stack exactly; `shape` defaults to `round`, `rotation` to 0, and `zoneId`
   * is the table's own zone. A rejected write surfaces the `errorKey` banner via {@link #setPlacement}.
   */
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

  /** Map an editable table to the shared canvas/token's {@link FloorTable} shape via the shared
   * {@link toFloorTable}. The dashboard editor has no live occupancy read-model, so the occupancy half
   * is the neutral "free" defaults — the token renders just the label + covers. Unplaced tables (null
   * coords) default to 0 for the required fields the token ignores in the tray. */
  #toFloorTable(tbl: EditableTable): FloorTable {
    return toFloorTable(tbl, { state: "free", tabTotal: null, pendingToServe: 0, status: null });
  }

  /** The dashboard's Spanish copy for the shared canvas (its edit-mode inspector + token suffix words).
   * Only the overridden keys are supplied; the canvas fills the rest from its English defaults. */
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
      @click=${() => (this.activeTab = key)}
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
      @click=${() => (this.activeZone = tab.key)}
      >${tab.name}</wt-button
    >`;
  }

  /** One unplaced table in the tray: a tappable button wrapping the shared `<wt-table-token>` (the same
   * token the canvas draws, so the tray can never drift from it). A tap PLACES it (tap-to-place). */
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
              label=${t("floor.new_zone")}
              data-new-zone
              .value=${this.newZone}
              @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onNewZone(e)}
            ></wt-input>
            <wt-button variant="primary" data-add-zone @click=${() => void this.#createZone()}
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
              label=${t("floor.table_label")}
              data-new-table
              .value=${this.newTable}
              @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onNewTable(e)}
            ></wt-input>
            <wt-button variant="primary" data-add-table @click=${() => void this.#createTable()}
              >${t("floor.add_table")}</wt-button
            >
          </div>
        </section>
      </div>
    `;
  }

  /** The Plano tab: per-zone sub-tabs, then the editable canvas drawing that zone's PLACED tables with
   * its UNPLACED tables in a tray beneath (tap-to-place). */
  #renderPlano(): TemplateResult {
    const knownZoneIds = new Set(this.zones.map((z) => z.id));
    // The sub-tabs (active zones by displayOrder + a trailing "Sin zona" tab when needed) and the active
    // key come from the shared @waitron/ui helpers; the screen owns only the Spanish no-zone LABEL.
    const tabs = buildZoneTabs(this.zones, this.tables, t("floor.zoneless"));
    const activeKey = resolveActiveTabKey(this.activeZone, tabs);
    // The "Sin zona" tab (activeKey === null) gathers the zoneless AND deactivated-zone tables; a real
    // zone tab shows exactly its own tables. When there are no tabs at all (no zones, no tables) nothing
    // is visible and the canvas draws empty.
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
