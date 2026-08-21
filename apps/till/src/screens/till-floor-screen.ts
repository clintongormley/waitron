import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
// `baseStyles` also loads the `@waitron/ui` barrel, which registers `<wt-floor-canvas>` and
// `<wt-table-token>` (self-registering `wt-*` components) — the map view and the tray consume them by
// tag below. The type-only imports carry the canvas's copy/table/placement-event shapes.
import { baseStyles } from "@waitron/ui";
import type { FloorCanvasCopy, FloorTable, PlacementChange, PlacementClear } from "@waitron/ui";
import { t } from "../i18n/t.js";
import type { FloorZone, TableState, TillApi } from "../api/client.js";

/**
 * The TILL live-floor screen (FP-1 §4 + FP-2 §5b): the venue's tables shown by zone with their live
 * occupancy, so an operator can see at a glance which tables are free, which carry an open tab and how
 * much, which are waiting on a delivery, and which still have food to take out. Tapping a table asks the
 * app to open (or resume) that table's tab — the screen itself owns NO fiscal path (design H2): a tab is
 * a PRE-FISCAL working order, and `open-table` is the only thing this screen decides. The app turns it
 * into an `openTab` (a free table) or a straight transition (an occupied one) and moves to the
 * table-ordering screen.
 *
 * Zones are shown as TABS (ordered by `displayOrder`), plus a "Sin zona" tab for tables not yet assigned
 * to any zone. Each tab has two VIEWS, flipped by a manual toggle:
 *  - **MAP** — the shared `<wt-floor-canvas>` (FP-2 Task 5) draws every PLACED table at its `posX`/`posY`
 *    permille coordinates; the active zone's UNPLACED tables sit in a tray strip beneath it. The default
 *    when the active zone has at least one placed table.
 *  - **LIST** — FP-1's responsive grid of occupancy-coloured cards (the {@link #card} render, unchanged).
 *    The default when the active zone has no placed table.
 *
 * A manager (an operator holding `till.configure`, surfaced as {@link canEdit}) also gets an "Editar
 * plano" toggle: entering edit mode passes `.editable` to the canvas, whose `placement-change` /
 * `placement-clear` this screen persists through the ON-TILL route ({@link TillApi.setTablePlacement} /
 * {@link TillApi.clearPlacement}) and then asks the app to refresh. Client hiding is convenience only —
 * the server re-checks the gate (FP-2 Task 4).
 *
 * TOKEN RECONCILIATION (Ruling FP2-A). The map and the tray render each table with the shared
 * `<wt-table-token>` (FP-2 Task 5) — the SAME component the dashboard map uses — so the on-canvas token
 * can never drift from the till's. The LIST {@link #card} keeps FP-1's fuller occupancy body (the
 * line-count / "Libre" / "por entregar" lines, which need the till's own i18n copy the terse shared
 * token deliberately omits per spec §5a); the shared subset it and the token both show (state accent,
 * open-tab total, to-serve + status badges) is identical because the token was extracted verbatim from
 * this very card. The map is deliberately terser than the list — a design call recorded in spec §5a.
 *
 * It reads the venue's {@link FloorZone}s, the live {@link TableState} read-model (now carrying each
 * table's FP-2 placement), the operator's {@link canEdit} gate and the {@link TillApi} (for the two
 * placement writes) — and holds no data of its own beyond which tab/view is showing and whether it is
 * editing; the app owns and refreshes the zones + tables.
 *
 * COPY. Every user-facing label comes from the till's i18n catalogue (`i18n/strings.ts`) via `t()`, like
 * the sibling screens — the `floor.*` keys. `t()` takes no params, so a count-bearing label is
 * `${n} ${t(key)}` (value + suffix word). The shipped default locale is es-ES, so these render in Spanish
 * ("Sala", "Libre", "por servir", "Sin zona"); the English base is the source of truth. Identifiers stay
 * English. Zone names and totals are DATA and pass through verbatim.
 *
 * Lit + `@waitron/ui` `baseStyles` + theme tokens only — no hardcoded chrome colour/spacing, so the
 * screen follows the operator's theme exactly like every sibling till screen (the occupancy accent and
 * the manual-status swatch are the only colours, and the status colour is DATA from the read-model, not
 * chrome). HA-free — the till's own design system.
 */
@customElement("till-floor-screen")
export class TillFloorScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .screen {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
        padding: var(--wt-space-4);
      }

      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
      }

      .title {
        margin: 0;
        font-size: var(--wt-font-size-xl);
        font-weight: var(--wt-font-weight-bold);
      }

      /* The header's control cluster: view toggle, the manager-only edit toggle, and Back. */
      .actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
      }

      .tabs {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }

      /* The map view: the shared canvas with the unplaced-tables tray stacked beneath it. */
      .map {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
      }

      .tray {
        display: flex;
        flex-wrap: wrap;
        align-items: stretch;
        gap: var(--wt-space-2);
        padding: var(--wt-space-2);
        border: 1px dashed var(--wt-color-border);
        border-radius: var(--wt-radius-md);
      }

      .tray-label {
        width: 100%;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
      }

      /* The tray token is the tappable element; the shared <wt-table-token> inside carries the visual. */
      .tray-item {
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }

      /* A responsive grid: cards flow to fill the width, wrapping onto new rows on a narrow till. */
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
        gap: var(--wt-space-3);
      }

      .card {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: var(--wt-space-2);
        min-height: calc(var(--wt-tap-min) * 1.5);
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        /* The occupancy accent lives on the left edge, coloured by state (tokens below). */
        border-left: var(--wt-space-1) solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }

      .card.state-free {
        border-left-color: var(--wt-color-success);
      }

      .card.state-open-tab {
        border-left-color: var(--wt-color-primary);
      }

      .card.state-delivery-pending {
        border-left-color: var(--wt-color-danger);
      }

      .card-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--wt-space-2);
        width: 100%;
      }

      .label {
        font-size: var(--wt-font-size-lg);
        font-weight: var(--wt-font-weight-bold);
      }

      .capacity {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .occupancy {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
      }

      .total {
        font-weight: var(--wt-font-weight-bold);
      }

      .lines,
      .occupancy.free,
      .occupancy.delivery {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .badges {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }

      .badge {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-1);
        padding: var(--wt-space-1) var(--wt-space-2);
        border-radius: var(--wt-radius-sm);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
      }

      .badge.to-serve {
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text);
      }

      /* The manual-status chip: label in the theme's text colour on a neutral chip, with the DATA-driven
         status colour as a border + a small swatch — never as a text background, so contrast is fixed by
         the tokens and the arbitrary status colour cannot fail a11y. */
      .badge.status {
        border: 1px solid var(--wt-color-border);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
      }

      .dot {
        display: inline-block;
        width: var(--wt-space-2);
        height: var(--wt-space-2);
        border-radius: 50%;
      }
    `,
  ];

  /** The venue's active floor-plan zones (the app loads them from `GET /api/zones`). */
  @property({ attribute: false }) zones: FloorZone[] = [];
  /** The live-floor occupancy read-model, one row per active table (from `GET /api/tables/state`). */
  @property({ attribute: false }) tables: TableState[] = [];
  /**
   * The HTTP face of the till (FP-2), threaded from the app — used ONLY in edit mode, to persist a
   * canvas `placement-change` / `placement-clear` through the on-till route. Optional: the view-only
   * floor (and every FP-1 test) never touches it, so it may be absent, and the placement handlers
   * no-op when it is.
   */
  @property({ attribute: false }) api?: TillApi;
  /**
   * Whether the operator may edit the plan — true iff they hold `till.configure` (a manager/admin,
   * spec §3). Threaded from the app (which owns the role→permission mapping, mirroring the server's
   * `authorize(till.configure)` gate). Gates the "Editar plano" toggle's visibility ONLY; the server
   * re-checks the gate on every placement write (FP-2 Task 4), so this is convenience, not security.
   */
  @property({ attribute: false }) canEdit = false;

  /**
   * Which zone tab is showing: a zone id, `null` for the "Sin zona" tab, or `undefined` before the
   * operator has picked one — in which case {@link render} falls back to the FIRST tab. Kept as a
   * distinct `undefined` (rather than defaulting to a zone id) so the default tracks the current tab
   * order even before the zones prop has settled.
   */
  @state() private activeZone: string | null | undefined = undefined;
  /**
   * The operator's manual view override, or `undefined` to DERIVE the view per active zone (map when
   * the zone has ≥1 placed table, else list — see {@link render}). A tap on the view toggle pins the
   * override for the session (spec §5b: "a manual toggle overrides for the session, local, not
   * persisted"); until then each zone shows its own data-driven default.
   */
  @state() private viewOverride: "map" | "list" | undefined = undefined;
  /** Edit mode (FP-2) — passes `.editable` to the canvas; only reachable while {@link canEdit}. */
  @state() private editing = false;

  /** Announce the operator wants this table's tab. The app opens (free) or resumes (occupied) it and
   * moves to the table-ordering screen — this screen never touches a fiscal path (design H2). */
  #openTable(table: TableState): void {
    this.dispatchEvent(
      new CustomEvent("open-table", {
        detail: { tableId: table.id, hasOpenTab: table.hasOpenTab },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Return to the counter (basket-preserving, handled by the app — mirrors the schedule screen). */
  #back(): void {
    this.dispatchEvent(new CustomEvent("back-to-counter", { bubbles: true, composed: true }));
  }

  /** Select a zone tab (a zone id, or `null` for the "Sin zona" tab). */
  #selectZone(key: string | null): void {
    this.activeZone = key;
  }

  /** Flip the view and PIN it for the session (spec §5b) — from whatever it is showing now. */
  #toggleView(current: "map" | "list"): void {
    this.viewOverride = current === "map" ? "list" : "map";
  }

  /** Enter/leave edit mode. Entering also switches to the map — the canvas is what you edit. */
  #toggleEdit(): void {
    this.editing = !this.editing;
    if (this.editing) this.viewOverride = "map";
  }

  /**
   * The shared canvas emits `open-table { tableId }` only (it has no read-model). Stop that terse event
   * and re-emit the FP-1 `open-table { tableId, hasOpenTab }` from THIS screen, resolving `hasOpenTab`
   * from the read-model — so the app resumes an existing tab rather than minting a second one on an
   * occupied table.
   */
  #onCanvasOpen(event: Event): void {
    event.stopPropagation();
    const { tableId } = (event as CustomEvent<{ tableId: string }>).detail;
    const found = this.tables.find((table) => table.id === tableId);
    if (found !== undefined) this.#openTable(found);
  }

  /**
   * Persist a canvas placement edit through the ON-TILL route ({@link TillApi.setTablePlacement}), then
   * ask the app to refresh (below). A rejected write — a staff operator who bypassed the hidden toggle
   * (the server re-gates, FP-2 Task 4), or an invalid value — is swallowed: the refresh reconciles the
   * view to the server's truth (the change did not land) rather than leaving a half-applied map.
   */
  async #onPlacementChange(event: Event): Promise<void> {
    event.stopPropagation();
    const { tableId, posX, posY, shape, rotation, zoneId } = (event as CustomEvent<PlacementChange>)
      .detail;
    if (this.api === undefined) return;
    try {
      await this.api.setTablePlacement(tableId, { posX, posY, shape, rotation, zoneId });
    } catch {
      // Non-fatal — the refresh reconciles the view to server truth (see the method doc).
    }
    this.#requestFloorRefresh();
  }

  /** Un-place a table (the canvas's `placement-clear`) via {@link TillApi.clearPlacement}, then refresh.
   * Same swallow-and-reconcile shape as {@link #onPlacementChange}. */
  async #onPlacementClear(event: Event): Promise<void> {
    event.stopPropagation();
    const { tableId } = (event as CustomEvent<PlacementClear>).detail;
    if (this.api === undefined) return;
    try {
      await this.api.clearPlacement(tableId);
    } catch {
      // Non-fatal — see #onPlacementChange.
    }
    this.#requestFloorRefresh();
  }

  /** Ask the app (which owns the zones + tables) to re-read the floor after a placement write. The app
   * re-supplies `.tables`, which re-feeds the canvas — the data-down / events-up pattern the sibling
   * screens use. */
  #requestFloorRefresh(): void {
    this.dispatchEvent(new CustomEvent("floor-refresh", { bubbles: true, composed: true }));
  }

  /** Map a read-model row to the shared canvas/token's {@link FloorTable} shape. Unplaced tables (the
   * tray) have null coordinates the token ignores, so they default to 0 for the required fields. */
  #toFloorTable(table: TableState): FloorTable {
    return {
      id: table.id,
      label: table.label,
      capacity: table.capacity,
      posX: table.posX ?? 0,
      posY: table.posY ?? 0,
      shape: table.shape,
      rotation: table.rotation,
      zoneId: table.zoneId,
      state: table.state,
      tabTotal: table.tabTotal ?? null,
      pendingToServe: table.pendingToServe,
      status: table.status,
    };
  }

  /** The till's Spanish copy for the shared canvas (its edit-mode inspector + token suffix words). Only
   * the overridden keys are supplied; the canvas fills the rest from its English defaults. */
  #canvasCopy(): Partial<FloorCanvasCopy> {
    return {
      floor: t("floor.title"),
      covers: t("floor.capacity"),
      toServe: t("floor.to_serve"),
      zone: t("floor.zone"),
      rotate: t("floor.rotate"),
      remove: t("floor.remove"),
      shape: t("floor.shape"),
      shapeRound: t("floor.shape_round"),
      shapeSquare: t("floor.shape_square"),
      shapeRect: t("floor.shape_rect"),
    };
  }

  /**
   * Whether a table belongs under the "Sin zona" tab: it has NO zone (`zoneId === null`), OR its zone is
   * not among the currently-active ones. The second case is the reachability fix — `deactivateZone` is a
   * soft `active = false` and never nulls a table's `zoneId`, so a table can point at a zone missing from
   * {@link zones}; without catching it here, that table (open tab and all) would match no tab and vanish.
   */
  #isZoneless(table: TableState, knownZoneIds: Set<string>): boolean {
    return table.zoneId === null || !knownZoneIds.has(table.zoneId);
  }

  /** The tabs to show: the active zones by `displayOrder`, plus a "Sin zona" tab iff some table is
   * zoneless or points at a deactivated zone (see {@link #isZoneless}). */
  #tabs(knownZoneIds: Set<string>): { key: string | null; name: string }[] {
    const zoneTabs = [...this.zones]
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((z) => ({ key: z.id as string | null, name: z.name }));
    const hasZoneless = this.tables.some((table) => this.#isZoneless(table, knownZoneIds));
    return hasZoneless ? [...zoneTabs, { key: null, name: t("floor.no_zone") }] : zoneTabs;
  }

  /** The active tab's key: the operator's pick, or the first tab when none has been made. */
  #activeKey(tabs: { key: string | null }[]): string | null | undefined {
    return this.activeZone === undefined ? tabs[0]?.key : this.activeZone;
  }

  override render() {
    const knownZoneIds = new Set(this.zones.map((z) => z.id));
    const tabs = this.#tabs(knownZoneIds);
    const activeKey = this.#activeKey(tabs);
    // The "Sin zona" tab (activeKey === null) gathers the zoneless AND the deactivated-zone tables; a
    // real zone tab shows exactly its own tables.
    const visible = this.tables.filter((table) =>
      activeKey === null ? this.#isZoneless(table, knownZoneIds) : table.zoneId === activeKey,
    );
    // The default view is data-driven per active zone (map once the zone has any placed table); a
    // manual toggle pins an override for the session.
    const view: "map" | "list" =
      this.viewOverride ?? (visible.some((table) => table.posX != null) ? "map" : "list");
    return html`
      <section class="screen" aria-label=${t("floor.title")}>
        <header class="head">
          <h1 class="title">${t("floor.title")}</h1>
          <div class="actions">
            <wt-button
              class="view-toggle"
              data-view-toggle
              variant="secondary"
              @click=${() => this.#toggleView(view)}
            >
              ${view === "map" ? t("floor.view_list") : t("floor.view_map")}
            </wt-button>
            ${
              this.canEdit
                ? html`<wt-button
                    class="edit-toggle"
                    data-edit-toggle
                    variant=${this.editing ? "primary" : "secondary"}
                    @click=${() => this.#toggleEdit()}
                  >
                    ${t("floor.edit_plan")}
                  </wt-button>`
                : nothing
            }
            <wt-button class="back" variant="secondary" @click=${() => this.#back()}>
              ${t("floor.back")}
            </wt-button>
          </div>
        </header>
        ${
          tabs.length > 0
            ? html`<nav class="tabs" aria-label=${t("floor.zones")}>
                ${tabs.map((tab) => this.#tab(tab, activeKey))}
              </nav>`
            : nothing
        }
        ${
          view === "map"
            ? this.#map(visible)
            : html`<div class="grid">${visible.map((table) => this.#card(table))}</div>`
        }
      </section>
    `;
  }

  /**
   * The MAP view: the shared `<wt-floor-canvas>` drawing the PLACED tables (a type-guard filter narrows
   * `posX`/`posY` to non-null before mapping), with the active zone's UNPLACED tables in a tray strip
   * beneath. `placement-change` / `placement-clear` are persisted here; a canvas `open-table` is
   * re-emitted with the resolved `hasOpenTab` ({@link #onCanvasOpen}).
   */
  #map(visible: TableState[]): TemplateResult {
    const placed = visible.filter(
      (table): table is TableState & { posX: number; posY: number } =>
        table.posX != null && table.posY != null,
    );
    const unplaced = visible.filter((table) => table.posX == null);
    return html`
      <div class="map">
        <wt-floor-canvas
          .tables=${placed.map((table) => this.#toFloorTable(table))}
          .editable=${this.editing}
          .copy=${this.#canvasCopy()}
          @open-table=${(event: Event) => this.#onCanvasOpen(event)}
          @placement-change=${(event: Event) => void this.#onPlacementChange(event)}
          @placement-clear=${(event: Event) => void this.#onPlacementClear(event)}
        ></wt-floor-canvas>
        ${
          unplaced.length > 0
            ? html`<div class="tray" aria-label=${t("floor.unplaced")}>
                <span class="tray-label">${t("floor.unplaced")}</span>
                ${unplaced.map((table) => this.#trayItem(table))}
              </div>`
            : nothing
        }
      </div>
    `;
  }

  /** One unplaced table in the tray: a tappable button wrapping the shared `<wt-table-token>` (Ruling
   * FP2-A — the same token the map draws, so the tray can never drift from it). Tap → `open-table`. */
  #trayItem(table: TableState): TemplateResult {
    return html`<button
      class="tray-item"
      data-tray-table=${table.id}
      @click=${() => this.#openTable(table)}
    >
      <wt-table-token
        .table=${this.#toFloorTable(table)}
        .labels=${{ covers: t("floor.capacity"), toServe: t("floor.to_serve") }}
      ></wt-table-token>
    </button>`;
  }

  #tab(
    tab: { key: string | null; name: string },
    activeKey: string | null | undefined,
  ): TemplateResult {
    const active = tab.key === activeKey;
    return html`<wt-button
      class="tab"
      data-zone=${tab.key ?? "none"}
      variant=${active ? "primary" : "secondary"}
      @click=${() => this.#selectZone(tab.key)}
    >
      ${tab.name}
    </wt-button>`;
  }

  #card(table: TableState): TemplateResult {
    return html`<button
      class="card state-${table.state}"
      data-table=${table.id}
      @click=${() => this.#openTable(table)}
    >
      <span class="card-head">
        <span class="label">${table.label}</span>
        ${
          table.capacity !== null
            ? html`<span class="capacity">${table.capacity} ${t("floor.capacity")}</span>`
            : nothing
        }
      </span>
      ${this.#occupancy(table)}
      <span class="badges">
        ${
          table.pendingToServe > 0
            ? html`<span class="badge to-serve" data-to-serve
                >${table.pendingToServe} ${t("floor.to_serve")}</span
              >`
            : nothing
        }
        ${
          table.status !== null
            ? html`<span
                class="badge status"
                data-status
                style="border-color: ${table.status.color}"
              >
                <span class="dot" style="background: ${table.status.color}"></span
                >${table.status.label}
              </span>`
            : nothing
        }
      </span>
    </button>`;
  }

  /** The state-specific body of a card. The switch is exhaustive over {@link TableState.state}'s three
   * members (like the counter screen's `#widget`), so a new occupancy state is a compile error here
   * rather than a silently blank card. */
  #occupancy(table: TableState): TemplateResult {
    switch (table.state) {
      case "open-tab":
        return html`<span class="occupancy tab-open">
          <span class="total">${table.tabTotal} €</span>
          <span class="lines">${table.tabLineCount} ${t("floor.line_count")}</span>
        </span>`;
      case "delivery-pending":
        return html`<span class="occupancy delivery"
          >${table.pendingDeliveries} ${t("floor.pending_delivery")}</span
        >`;
      case "free":
        return html`<span class="occupancy free">${t("floor.free")}</span>`;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-floor-screen": TillFloorScreen;
  }
}
