import { tillPath } from "../navigation.js";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { trackDialog } from "../widgets/track-dialog.js";
import type { TimingBand } from "@waitron/shared";
// Importing the `@waitron/ui` barrel also registers `<wt-floor-canvas>` and `<wt-table-token>`, which
// the map view and the tray use by tag.
import {
  baseStyles,
  UrlStateController,
  buildZoneTabs,
  defaultTraySlot,
  floorTrayStyles,
  isTableZoneless,
  resolveActiveTabKey,
  toFloorTable,
} from "@waitron/ui";
import type {
  FloorCanvasCopy,
  FloorTable,
  PlacementChange,
  PlacementClear,
  ZoneTab,
} from "@waitron/ui";
import { decimal, isZeroDecimal } from "@waitron/shared";
import { countText, named, t } from "../i18n/t.js";
import "../widgets/seat-dialog.js";
import type { SeatConfirmDetail } from "../widgets/seat-dialog.js";
import type { FloorZone, TableState, TableParty, TillApi, UnsentDraft } from "../api/client.js";

function needsClearing(table: TableState): boolean {
  return table.condition === "needs_clearing";
}

function unsentText({ ownerName, lineCount }: UnsentDraft): string {
  return named(
    ownerName,
    countText(lineCount, "floor.unsent_owner", "floor.unsent_owner_one"),
    countText(lineCount, "floor.unsent", "floor.unsent_one"),
  );
}

/** The party's name when it says more than the table's own label: a name staff gave, or a joined
 * party's tables. */
function shownPartyName(table: TableState): string | undefined {
  const name = table.party?.displayName;
  return name === undefined || name === table.label ? undefined : name;
}

/** Nothing of the party is left to pay, and no tab is open that could still take a round. */
function partyPaid(table: TableState): boolean {
  return (
    table.party !== null && !table.hasOpenTab && isZeroDecimal(decimal(table.party.outstanding))
  );
}

/**
 * The TILL live-floor screen. Tapping a free table asks for the party's guest count and then asks the
 * app to seat it; tapping a seated table asks the app to resume it. A table that needs clearing
 * offers Mark cleared instead. The screen itself owns NO fiscal path, because a
 * tab is a PRE-FISCAL working order.
 *
 * Each zone tab has a MAP view (the shared `<wt-floor-canvas>`, with the zone's unplaced tables in a
 * tray beneath) and a LIST view; the map is the default when the zone has at least one placed table.
 * The map is deliberately terser than the list card.
 *
 * `t()` takes no params, so a count-bearing label is `${n} ${t(key)}`.
 */
@customElement("till-floor-screen")
export class TillFloorScreen extends LitElement {
  static override styles = [
    baseStyles,
    floorTrayStyles,
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

      /* The floor-body control cluster: the view toggle and the manager-only edit toggle. A sibling of
         the header (never inside it), so it survives when the standalone header is dropped in an
         embedded card host (SP-B2.1) — these toggles are floor function, not shell chrome. Back lives
         in the header instead. */
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

      /* The map view: the shared canvas with the unplaced-tables tray stacked beneath it. The tray's
         own rules (.tray / .tray-label / .tray-item) live in @waitron/ui's shared floorTrayStyles. */
      .map {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
      }

      /* A token's unsent-order mark hangs below it, into the row gap and the tray's padding. */
      .tray {
        row-gap: var(--wt-space-4);
        padding-bottom: var(--wt-space-4);
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

      .card.clearing {
        border-left-color: var(--wt-color-warning);
        cursor: default;
      }

      /* Order-timing accent (KDS order-timing alerts, design §7.3): a table whose worst unserved line
         has escalated gets a subtler steady amber (warm) through steady red (overdue) up to a
         FLASHING red (forgotten) — the SAME age- and flash class scheme till-station-queue's rail
         card and till-expo-screen's order card use, so the escalation reads as one visual language
         across every KDS surface. Laid down as an INSET BOX-SHADOW rather than another border/border-left
         colour, deliberately: .card's left edge already carries the OCCUPANCY accent (.state-* above),
         and a box-shadow is a wholly separate CSS property, so the two accents can never fight over
         ownership of the same edge — both render, always, side by side (a11y: two independent
         signals, never one clobbering the other). 'fresh' gets no override. */
      .card.age-warm {
        box-shadow: inset 0 0 0 2px var(--wt-color-primary);
      }

      .card.age-overdue,
      .card.age-forgotten {
        box-shadow: inset 0 0 0 2px var(--wt-color-danger);
      }

      /* The FORGOTTEN flash: a repeating fade of the inset accent, never a colour/motion change behind
         text — .flash is applied only when the OS/browser has NOT asked for reduced motion
         (#prefersReducedMotion), so an assistive-motion setting renders the steady red box-shadow
         above with no @keyframes at all. The @media guard is a second, CSS-only line of defence for
         the same preference (belt-and-suspenders, house a11y rule) — mirrors till-station-queue's/
         till-expo-screen's identical treatment. */
      .card.age-forgotten.flash {
        animation: age-forgotten-flash 1s ease-in-out infinite;
      }

      @keyframes age-forgotten-flash {
        50% {
          box-shadow: inset 0 0 0 2px transparent;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .card.age-forgotten.flash {
          animation: none;
        }
      }

      /* The forgotten badge (design §7.3) — a non-colour tell shown UNCONDITIONALLY for a forgotten
         table (not just under reduced motion), so a colour-blind operator or a reduced-motion setting
         still sees the escalation without relying on the flashing-red accent alone. A FILLED danger
         chip (like .badge.en-route's filled-primary treatment above) rather than plain text, since
         this card already has a rich badge system — the same a11y-correct danger/on-danger token pair
         every other filled chrome in this app uses. */
      .badge.forgotten {
        background: var(--wt-color-danger);
        color: var(--wt-color-on-danger);
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

      .party-name {
        max-width: 100%;
        font-weight: var(--wt-font-weight-bold);
        overflow-wrap: anywhere;
      }

      .occupancy {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
      }

      .total,
      .paid {
        font-weight: var(--wt-font-weight-bold);
      }

      .lines,
      .party,
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

      /* "Reserved HH:MM" (Bookings-1 §4) -- the table's imminent booking. A PRIMARY border on a neutral
         chip (theme text on a neutral fill, so contrast stays token-fixed): distinct from the ready
         chip's success border, the status chip's neutral border, and the en-route chip's filled primary.
         An independent signal that sits beside the one service hint and the manual status, never in their
         place. Mirrors @waitron/ui's wt-table-token .badge.reserved so the list card and the map token
         match. */
      .badge.reserved {
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text);
        border: 1px solid var(--wt-color-primary);
      }

      /* "N en camino" -- dispatched by the pass, awaiting the waiter (KDS-3 §3c). The TOP-precedence hint,
         so it carries the strongest weight: the filled primary chip (the primary/on-primary token pair
         guarantees contrast in both themes), a step up from the ready chip's border and the to-serve
         chip's neutral fill. Only one hint renders per card (see #hint), so this never sits beside them. */
      .badge.en-route {
        background: var(--wt-color-primary);
        color: var(--wt-color-on-primary);
      }

      /* "N listos" -- kitchen-done, waiting to be carried out (KDS-1 §3d). Distinguished from to-serve by
         the success-coloured border rather than a coloured fill, so the label stays theme text on a
         neutral chip (the a11y-safe pattern the status chip uses); there is no on-success token. */
      .badge.ready {
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text);
        border: 1px solid var(--wt-color-success);
      }

      /* The manual-status chip: label in the theme's text colour on a neutral chip, with the DATA-driven
         status colour as a border + a small swatch — never as a text background, so contrast is fixed by
         the tokens and the arbitrary status colour cannot fail a11y. */
      .badge.status {
        border: 1px solid var(--wt-color-border);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
      }

      .unsent {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: var(--wt-space-1);
      }

      .badge.unsent {
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text);
        border: 1px dashed var(--wt-color-warning);
      }

      .dot {
        display: inline-block;
        width: var(--wt-space-2);
        height: var(--wt-space-2);
        border-radius: 50%;
      }
    `,
  ];

  @property({ attribute: false }) zones: FloorZone[] = [];
  @property({ attribute: false }) tables: TableState[] = [];
  /** Used only by the placement writes, which no-op when it is absent. */
  @property({ attribute: false }) api?: TillApi;
  /** Hides the plan-edit toggle. Convenience, not security: the server re-checks the permission on
   * every placement write. */
  @property({ attribute: false }) canEdit = false;
  @property({ attribute: false }) canExitToCounter = true;
  /** Mounted inside a card host, which supplies the header; the view/edit toggles stay. */
  @property({ type: Boolean }) embedded = false;
  /**
   * `undefined` checks the live `prefers-reduced-motion` query on every render; a test injects a value.
   *
   * NO `TickingClock` here, unlike the station and expo views: the read-model ships each table's
   * ALREADY-REDUCED `timingBand`, never the per-line ages and thresholds, so a tick would re-render
   * identical classes. A table crossing into a worse band shows on the next refresh.
   */
  @property({ attribute: false }) reducedMotion?: boolean;

  /**
   * A zone id, `null` for the no-zone tab, or `undefined` before the operator has picked one — kept
   * distinct so the default tracks the current tab order even before the zones prop has settled.
   */
  @state() private activeZone: string | null | undefined = undefined;
  /** `undefined` DERIVES the view per active zone; a toggle tap pins it for the session, not persisted. */
  @state() private viewOverride: "map" | "list" | undefined = undefined;
  @state() private editing = false;
  /** The free table whose guest count is being asked for. */
  @state() private seating: TableState | null = null;
  /** The table tapped on the map that needs clearing. */
  @state() private clearing: TableState | null = null;

  readonly #url = new UrlStateController(
    this,
    () => {
      const zone = this.#url.read("till-zone");
      this.activeZone = zone === null ? undefined : zone === "" ? null : zone;
    },
    tillPath,
  );

  /** A seated table resumes; a table needing clearing offers Mark cleared; a free one asks for guests. */
  #openTable(table: TableState): void {
    if (needsClearing(table)) {
      this.clearing = table;
      return;
    }
    if (table.party === null && !table.hasOpenTab) {
      this.seating = table;
      return;
    }
    this.#emit("open-table", { tableId: table.id, seated: true });
  }

  #onSeatConfirm(event: Event, table: TableState): void {
    event.stopPropagation();
    this.seating = null;
    const { guestCount } = (event as CustomEvent<SeatConfirmDetail>).detail;
    this.#emit("open-table", { tableId: table.id, seated: false, guestCount });
  }

  #markCleared(table: TableState): void {
    this.clearing = null;
    this.#emit("mark-cleared", { tableId: table.id });
  }

  #emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  #back(): void {
    this.dispatchEvent(new CustomEvent("back-to-counter", { bubbles: true, composed: true }));
  }

  #selectZone(key: string | null): void {
    this.activeZone = key;
    this.#url.write({ "till-tab": this.#url.read("till-tab") ?? "floor", "till-zone": key ?? "" });
  }

  #toggleView(current: "map" | "list"): void {
    this.viewOverride = current === "map" ? "list" : "map";
  }

  /** Entering edit mode also switches to the map: the canvas is what you edit. */
  #toggleEdit(): void {
    this.editing = !this.editing;
    if (this.editing) this.viewOverride = "map";
  }

  /**
   * The shared canvas has no read-model, so it emits `wt-open-table { tableId }` only. The table is
   * looked up here, so a seated one resumes its party rather than being seated a second time.
   */
  #onCanvasOpen(event: Event): void {
    event.stopPropagation();
    const { tableId } = (event as CustomEvent<{ tableId: string }>).detail;
    const found = this.tables.find((table) => table.id === tableId);
    if (found !== undefined) this.#openTable(found);
  }

  /** A rejected write is swallowed: the refresh reconciles the view to the server's truth. */
  async #onPlacementChange(event: Event): Promise<void> {
    event.stopPropagation();
    const { tableId, posX, posY, shape, rotation, zoneId } = (event as CustomEvent<PlacementChange>)
      .detail;
    if (this.api === undefined) return;
    try {
      await this.api.setTablePlacement(tableId, { posX, posY, shape, rotation, zoneId });
    } catch {
      // Non-fatal — the refresh reconciles the view to server truth.
    }
    this.#requestFloorRefresh();
  }

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

  #requestFloorRefresh(): void {
    this.dispatchEvent(new CustomEvent("floor-refresh", { bubbles: true, composed: true }));
  }

  /**
   * A `TableState` carries both the placement half and the occupancy half, so it is passed as both. A
   * seated party's token shows what it still owes; a table needing clearing shows that in the status
   * chip, which it has free because the status is cleared when the party leaves.
   */
  #toFloorTable(table: TableState): FloorTable {
    const tabTotal =
      table.party === null
        ? table.tabTotal
        : isZeroDecimal(decimal(table.party.outstanding))
          ? null
          : table.party.outstanding;
    const status =
      needsClearing(table) && table.status === null
        ? {
            id: "needs-clearing",
            label: t("floor.needs_clearing"),
            color: "var(--wt-color-warning)",
          }
        : table.status;
    return toFloorTable(table, {
      ...table,
      // The server reads a table no party holds as free; one needing clearing must not look ready to seat.
      state: needsClearing(table) ? "open-tab" : table.state,
      tabTotal,
      status,
      reservedTime: table.nextReservation?.time ?? null,
      unsentDrafts: table.party?.unsentDrafts.map((draft) => draft.ownerName),
      partyName: shownPartyName(table),
    });
  }

  /** Only the overridden keys are supplied; the canvas fills the rest from its English defaults. */
  #canvasCopy(): Partial<FloorCanvasCopy> {
    return {
      floor: t("floor.title"),
      covers: t("floor.capacity"),
      toServe: t("floor.to_serve"),
      reserved: t("floor.reserved"),
      unsent: t("floor.unsent_mark"),
      zone: t("floor.zone"),
      rotate: t("floor.rotate"),
      remove: t("floor.remove"),
      shape: t("floor.shape"),
      shapeRound: t("floor.shape_round"),
      shapeSquare: t("floor.shape_square"),
      shapeRect: t("floor.shape_rect"),
    };
  }

  override render() {
    const knownZoneIds = new Set(this.zones.map((z) => z.id));
    const tabs = buildZoneTabs(this.zones, this.tables, t("floor.no_zone"));
    const activeKey = resolveActiveTabKey(this.activeZone, tabs);
    // The no-zone tab (activeKey === null) gathers the zoneless AND the deactivated-zone tables.
    const visible = this.tables.filter((table) =>
      activeKey === null ? isTableZoneless(table, knownZoneIds) : table.zoneId === activeKey,
    );
    // The server writes and nulls the four placement columns together, so `posX` alone tells placed
    // from unplaced.
    const placed = visible.filter(
      (table): table is TableState & { posX: number; posY: number } =>
        table.posX != null && table.posY != null,
    );
    const unplaced = visible.filter((table) => table.posX == null);
    const view: "map" | "list" = this.viewOverride ?? (placed.length > 0 ? "map" : "list");
    return html`
      <section class="screen" aria-label=${t("floor.title")}>
        ${
          this.embedded
            ? nothing
            : html`<header class="head">
                <h1 class="title">${t("floor.title")}</h1>
                ${
                  this.canExitToCounter
                    ? html`<wt-button class="back" variant="secondary" @click=${() => this.#back()}>
                        ${t("floor.back")}
                      </wt-button>`
                    : nothing
                }
              </header>`
        }
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
        </div>
        ${
          tabs.length > 0
            ? html`<nav class="tabs" aria-label=${t("floor.zones")}>
                ${tabs.map((tab) => this.#tab(tab, activeKey))}
              </nav>`
            : nothing
        }
        ${
          view === "map"
            ? this.#map(placed, unplaced)
            : html`<div class="grid">${visible.map((table) => this.#card(table))}</div>`
        }
        ${this.#seatDialog()} ${this.#clearDialog()}
      </section>
    `;
  }

  #map(
    placed: (TableState & { posX: number; posY: number })[],
    unplaced: TableState[],
  ): TemplateResult {
    return html`
      <div class="map">
        <wt-floor-canvas
          .tables=${placed.map((table) => this.#toFloorTable(table))}
          .editable=${this.editing}
          .copy=${this.#canvasCopy()}
          @wt-open-table=${(event: Event) => this.#onCanvasOpen(event)}
          @wt-placement-change=${(event: Event) => void this.#onPlacementChange(event)}
          @wt-placement-clear=${(event: Event) => void this.#onPlacementClear(event)}
        ></wt-floor-canvas>
        ${
          unplaced.length > 0
            ? html`<div class="tray" aria-label=${t("floor.unplaced")}>
                <span class="tray-label">${t("floor.unplaced")}</span>
                ${unplaced.map((table) => this.#trayItem(table, placed))}
              </div>`
            : nothing
        }
      </div>
    `;
  }

  /** `placed` is the active zone's already-placed tables, so the default slot can dodge them. */
  #trayItem(table: TableState, placed: TableState[]): TemplateResult {
    return html`<button
      class="tray-item"
      data-tray-table=${table.id}
      @click=${() => this.#onTrayTap(table, placed)}
    >
      <wt-table-token
        .table=${this.#toFloorTable(table)}
        .labels=${{
          covers: t("floor.capacity"),
          toServe: t("floor.to_serve"),
          reserved: t("floor.reserved"),
          unsent: t("floor.unsent_mark"),
        }}
      ></wt-table-token>
    </button>`;
  }

  #onTrayTap(table: TableState, placed: TableState[]): void {
    if (this.editing) {
      void this.#placeFromTray(table, placed);
    } else {
      this.#openTable(table);
    }
  }

  /** Tap-to-place gives the table a DEFAULT position, which the operator then adjusts on the canvas. */
  async #placeFromTray(table: TableState, placed: TableState[]): Promise<void> {
    if (this.api === undefined) return;
    const { posX, posY } = defaultTraySlot(placed.length);
    try {
      await this.api.setTablePlacement(table.id, {
        posX,
        posY,
        shape: "round",
        rotation: 0,
        zoneId: table.zoneId,
      });
    } catch {
      // Non-fatal — the refresh reconciles the view to server truth.
    }
    this.#requestFloorRefresh();
  }

  #tab(tab: ZoneTab, activeKey: string | null | undefined): TemplateResult {
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

  #prefersReducedMotion(): boolean {
    return this.reducedMotion ?? window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /** Space-prefixed (or empty) so it can be interpolated directly after `.card` in the template. */
  #timingAccentClass(band: TimingBand): string {
    if (band === "fresh") return "";
    const flash = band === "forgotten" && !this.#prefersReducedMotion();
    return ` age-${band}${flash ? " flash" : ""}`;
  }

  #seatDialog(): TemplateResult | typeof nothing {
    const table = this.seating;
    if (table === null) return nothing;
    return html`<till-seat-dialog
      .tableLabel=${table.label}
      @seat-confirm=${(event: Event) => this.#onSeatConfirm(event, table)}
      @seat-cancel=${(event: Event) => {
        event.stopPropagation();
        this.seating = null;
      }}
    ></till-seat-dialog>`;
  }

  #clearDialog(): TemplateResult | typeof nothing {
    const table = this.clearing;
    if (table === null) return nothing;
    return html`<wt-dialog
      ${trackDialog()}
      data-clear-dialog
      .open=${true}
      .heading=${t("floor.clear_title").replace("{table}", () => table.label)}
      @wt-close=${() => (this.clearing = null)}
    >
      <p>${t("floor.clear_body")}</p>
      <wt-button
        slot="footer"
        data-clear-cancel
        variant="secondary"
        @click=${() => (this.clearing = null)}
      >
        ${t("action.cancel")}
      </wt-button>
      <wt-button
        slot="footer"
        data-mark-cleared
        variant="primary"
        @click=${() => this.#markCleared(table)}
      >
        ${t("floor.mark_cleared")}
      </wt-button>
    </wt-dialog>`;
  }

  /** A card is one button, so a table needing clearing, whose card holds its own Mark cleared, is a
   * plain box instead. */
  #clearingCard(table: TableState): TemplateResult {
    return html`<div class="card state-${table.state} clearing" data-table=${table.id}>
      <span class="card-head">
        <span class="label">${table.label}</span>
        ${
          table.capacity !== null
            ? html`<span class="capacity">${table.capacity} ${t("floor.capacity")}</span>`
            : nothing
        }
      </span>
      <span class="occupancy" data-needs-clearing>${t("floor.needs_clearing")}</span>
      <wt-button
        size="sm"
        variant="secondary"
        data-mark-cleared
        @click=${() => this.#markCleared(table)}
      >
        ${t("floor.mark_cleared")}
      </wt-button>
    </div>`;
  }

  #card(table: TableState): TemplateResult {
    if (needsClearing(table)) return this.#clearingCard(table);
    return html`<button
      class="card state-${table.state}${this.#timingAccentClass(table.timingBand)}"
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
      ${this.#partyName(table)} ${this.#occupancy(table)} ${this.#unsent(table.party)}
      <span class="badges">
        ${this.#hint(table)}
        ${
          table.nextReservation !== null
            ? html`<span class="badge reserved" data-reserved
                >${t("floor.reserved")} ${table.nextReservation.time}</span
              >`
            : nothing
        }
        ${
          table.timingBand === "forgotten"
            ? html`<span class="badge forgotten" data-forgotten>${t("floor.forgotten")}</span>`
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

  #partyName(table: TableState): TemplateResult | typeof nothing {
    const name = shownPartyName(table);
    return name === undefined
      ? nothing
      : html`<span class="party-name" data-party-name>${name}</span>`;
  }

  #unsent(party: TableParty | null): TemplateResult | typeof nothing {
    const drafts = party?.unsentDrafts ?? [];
    if (drafts.length === 0) return nothing;
    return html`<span class="unsent">
      ${drafts.map((draft) => html`<span class="badge unsent" data-unsent>${unsentText(draft)}</span>`)}
    </span>`;
  }

  #party(party: TableParty | null): TemplateResult | typeof nothing {
    if (party === null) return nothing;
    const parts = [
      ...(party.guestCount === null ? [] : [`${t("floor.guests")}: ${party.guestCount}`]),
      ...(party.billCount > 1 ? [`${t("floor.bills")}: ${party.billCount}`] : []),
    ];
    return parts.length === 0 ? nothing : html`<span class="party">${parts.join(" · ")}</span>`;
  }

  /** Only the MOST ADVANCED of the three service signals renders: a dispatched line is still `ready`
   * and unserved, so all three counts can be positive at once. */
  #hint(table: TableState): TemplateResult | typeof nothing {
    if (table.enRoute > 0) {
      return html`<span class="badge en-route" data-en-route
        >${table.enRoute} ${t("floor.en_route")}</span
      >`;
    }
    if (table.readyToServe > 0) {
      return html`<span class="badge ready" data-ready
        >${table.readyToServe} ${t("floor.ready")}</span
      >`;
    }
    if (table.pendingToServe > 0) {
      return html`<span class="badge to-serve" data-to-serve
        >${table.pendingToServe} ${t("floor.to_serve")}</span
      >`;
    }
    return nothing;
  }

  /** The switch is exhaustive over {@link TableState.state}, so a new occupancy state is a compile error
   * here rather than a silently blank card. */
  #occupancy(table: TableState): TemplateResult {
    switch (table.state) {
      case "open-tab":
        return html`<span class="occupancy tab-open">
          ${
            partyPaid(table)
              ? html`<span class="paid" data-paid>${t("floor.paid")}</span>`
              : html`<span class="total">${table.party?.outstanding ?? table.tabTotal} €</span>`
          }
          ${
            table.hasOpenTab
              ? html`<span class="lines">${table.tabLineCount} ${t("floor.line_count")}</span>`
              : nothing
          }
          ${this.#party(table.party)}
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
