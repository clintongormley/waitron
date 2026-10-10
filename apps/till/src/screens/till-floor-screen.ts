import { zoneKeepOpen, servicePeriodStyles } from "../widgets/service-period.js";
import { tillPath } from "../navigation.js";
import { LitElement, type TemplateResult, css, html, nothing, unsafeCSS } from "lit";
import { PHONE_WIDTH } from "../widgets/language-chooser-styles.js";
import { customElement, property, state } from "lit/decorators.js";
import { trackDialog } from "../widgets/track-dialog.js";
import type { TimingBand } from "@waitron/shared";
// Importing the `@waitron/ui` barrel also registers `<wt-floor-canvas>`, `<wt-floor-map>` and
// `<wt-table-token>`, which the map views and the tray use by tag.
import {
  baseStyles,
  UrlStateController,
  buildZoneTabs,
  defaultTraySlot,
  floorTrayStyles,
  isTableZoneless,
  mergeLabel,
  renderFloorChips,
  resolveActiveTabKey,
  toFloorTable,
} from "@waitron/ui";
import type {
  FloorCanvasCopy,
  FloorMapTable,
  FloorTable,
  PlacementChange,
  PlacementClear,
  ZoneTab,
} from "@waitron/ui";
import { decimal, formatMoney, isZeroDecimal } from "@waitron/shared";
import { currentLocale, t } from "../i18n/t.js";
import "../widgets/seat-dialog.js";
import { partyPaid, unsentText } from "../widgets/table-details-sheet.js";
import type { SeatConfirmDetail } from "../widgets/seat-dialog.js";
import { isPlannedZone, listedTables, mapTables, seatsFor } from "../state/floor-map.js";
import type { FloorZone, TableState, TableParty, TillApi } from "../api/client.js";
import { delayUntil, reminderDueAt } from "../state/release-reminder.js";
import { readyByStation, signalOf, type StationReady } from "../state/table-signals.js";
import { signalChipStyles, signalChips } from "../widgets/signal-chips.js";

function needsClearing(table: TableState): boolean {
  return table.condition === "needs_clearing";
}

/** The party's name when it says more than the table's own label: a name staff gave, or a joined
 * party's tables. */
function shownPartyName(table: TableState): string | undefined {
  const name = table.party?.displayName;
  return name === undefined || name === table.label ? undefined : name;
}

/** The table's own Forgotten badge already says a forgotten wait. */
function tableChips(table: TableState) {
  return signalChips(table.signals, { forgottenShown: table.timingBand === "forgotten" });
}

interface ZoneOnScreen {
  tabs: ZoneTab[];
  refusedZone: FloorZone | undefined;
  activeKey: string | null | undefined;
  visible: TableState[];
  planned: boolean;
}

@customElement("till-floor-screen")
export class TillFloorScreen extends LitElement {
  static override styles = [
    baseStyles,
    servicePeriodStyles,
    floorTrayStyles,
    signalChipStyles,
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

      @media ${unsafeCSS(PHONE_WIDTH)} {
        .screen {
          padding-inline: 0;
        }
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

      wt-floor-map {
        height: 65dvh;
        min-height: calc(var(--wt-tap-min) * 6);
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
         chip (theme text on a neutral fill, so contrast stays token-fixed). Mirrors @waitron/ui's
         wt-table-token .badge.reserved so the list card and the map token match. */
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

      /* Mirrors @waitron/ui's wt-table-token .badge.fire-due. */
      .badge.fire-due {
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text);
        border: 1px solid var(--wt-color-warning);
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

      .stations {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-success);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
      }

      .stations h2 {
        margin: 0;
        font-size: var(--wt-font-size-md);
        font-weight: var(--wt-font-weight-bold);
      }

      .stations ul {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .station-ready {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-2);
      }

      .station-tables {
        min-width: 0;
        overflow-wrap: anywhere;
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
  /** The device has a station view, so each station's ready work links into it. */
  @property({ attribute: false }) canOpenStation = false;
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
  /** Injectable clock for whether a party's release reminder is due; unset reads the real one and
   * redraws the floor when the next reminder falls due. */
  @property({ attribute: false }) now?: number;

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
  @state() private refusedZoneId: string | null = null;
  /** The table tapped on the map that needs clearing. */
  @state() private clearing: TableState | null = null;
  /** The table whose details sheet is open, read afresh from `tables` on each render. */
  @state() private details: { tableId: string } | null = null;

  readonly #url = new UrlStateController(
    this,
    () => {
      const zone = this.#url.read("till-zone");
      this.activeZone = zone === null ? undefined : zone === "" ? null : zone;
    },
    tillPath,
  );

  /** The zone on screen, worked out once per update in `willUpdate`. */
  #zone!: ZoneOnScreen;

  /** The clock the last render judged reminders by. */
  #drawnAt = 0;
  #reminderTimer?: ReturnType<typeof setTimeout>;
  /** The last render drew a planned zone's map, so the screen re-reads the floor. */
  #drawsPlannedMap = false;
  #rereadTimer?: ReturnType<typeof setInterval>;

  override connectedCallback(): void {
    super.connectedCallback();
    // The timers stopped while the screen was off the page. A reminder that fell due meanwhile
    // redraws at once; the floor's re-read waits a full 15 s.
    if (this.hasUpdated) {
      this.#watchReminders();
      this.#watchFloor();
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this.#reminderTimer);
    clearInterval(this.#rereadTimer);
    this.#rereadTimer = undefined;
  }

  override willUpdate(): void {
    this.#drawnAt = this.now ?? Date.now();
    if (this.details !== null && !this.tables.some((table) => table.id === this.details!.tableId))
      this.details = null;
    // Edit plan's writes move the old placement columns, which a planned zone's map does not read.
    this.#zone = this.#zoneOnScreen();
    if (this.#zone.planned) this.editing = false;
  }

  override updated(): void {
    this.#watchReminders();
    this.#watchFloor();
  }

  /** A planned map shows statuses other tills change, so it asks for the floor every 15 s. */
  #watchFloor(): void {
    if (!this.#drawsPlannedMap || !this.isConnected) {
      clearInterval(this.#rereadTimer);
      this.#rereadTimer = undefined;
      return;
    }
    this.#rereadTimer ??= setInterval(() => this.#requestFloorRefresh(), 15_000);
  }

  #fireDue(table: TableState): boolean {
    return reminderDueAt(table.party?.reminder) <= this.#drawnAt;
  }

  /** The server's floor does not change when a reminder falls due, so the screen redraws itself then. */
  #watchReminders(): void {
    clearTimeout(this.#reminderTimer);
    if (this.now !== undefined) return;
    let next = Number.POSITIVE_INFINITY;
    for (const table of this.tables) {
      const dueAt = reminderDueAt(table.party?.reminder);
      if (dueAt > this.#drawnAt && dueAt < next) next = dueAt;
    }
    if (next === Number.POSITIVE_INFINITY) return;
    this.#reminderTimer = setTimeout(() => this.requestUpdate(), delayUntil(next));
  }

  /** A seated table resumes; a table needing clearing offers Mark cleared; a free one asks for guests. */
  #openTable(table: TableState): void {
    if (needsClearing(table)) {
      this.clearing = table;
      return;
    }
    if (table.party === null && !table.hasOpenTab) {
      const zone = this.zones.find((candidate) => candidate.id === table.zoneId);
      if (zone?.closed) {
        this.refusedZoneId = zone.id;
        return;
      }
      this.refusedZoneId = null;
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

  #onDetails(event: Event): void {
    event.stopPropagation();
    const { tableId } = (event as CustomEvent<{ tableId: string }>).detail;
    if (this.tables.some((table) => table.id === tableId)) this.details = { tableId };
  }

  /** As the map names the table: a merge by all its drawn members' labels, else its own label. */
  #detailsHeading(table: TableState): string {
    const joinId = table.today?.joinId ?? null;
    const members =
      joinId === null
        ? []
        : mapTables(this.#zone.visible).filter((drawn) => drawn.joinId === joinId);
    if (!members.some((drawn) => drawn.id === table.id)) return table.label;
    return mergeLabel(members.map((drawn) => drawn.label));
  }

  #detailsSheet(): TemplateResult | typeof nothing {
    const details = this.details;
    if (details === null) return nothing;
    const table = this.tables.find((candidate) => candidate.id === details.tableId)!;
    return html`<till-table-details-sheet
      .table=${table}
      .heading=${this.#detailsHeading(table)}
      .now=${this.#drawnAt}
      @details-close=${(event: Event) => {
        event.stopPropagation();
        this.details = null;
      }}
    ></till-table-details-sheet>`;
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
    this.refusedZoneId = null;
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
   * Both maps send a table id only (the canvas's `wt-open-table`, the new map's `wt-table-tap`). The
   * table is looked up here, so a seated one resumes its party rather than being seated a second time.
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
      fireDue: this.#fireDue(table),
      chips: tableChips(table),
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
      fireDue: t("floor.fire_due"),
      zone: t("floor.zone"),
      rotate: t("floor.rotate"),
      remove: t("floor.remove"),
      shape: t("floor.shape"),
      shapeRound: t("floor.shape_round"),
      shapeSquare: t("floor.shape_square"),
      shapeRect: t("floor.shape_rect"),
    };
  }

  #zoneOnScreen(): ZoneOnScreen {
    const knownZoneIds = new Set(this.zones.map((z) => z.id));
    const tabs = buildZoneTabs(
      this.zones.map((zone) => ({
        ...zone,
        name: zone.closed ? `${zone.name} · ${t("floor.closed")}` : zone.name,
      })),
      this.tables,
      t("floor.no_zone"),
    );
    const refusedZone = this.zones.find((zone) => zone.id === this.refusedZoneId && zone.closed);
    const activeKey = resolveActiveTabKey(this.activeZone, tabs);
    // The no-zone tab (activeKey === null) gathers the zoneless AND the deactivated-zone tables.
    const visible = this.tables.filter((table) =>
      activeKey === null ? isTableZoneless(table, knownZoneIds) : table.zoneId === activeKey,
    );
    return { tabs, refusedZone, activeKey, visible, planned: isPlannedZone(visible) };
  }

  override render() {
    const { tabs, refusedZone, activeKey, visible, planned } = this.#zone;
    const listed = planned ? listedTables(visible) : visible;
    const onMap = planned ? mapTables(visible) : [];
    // The server writes and nulls the four placement columns together, so `posX` alone tells placed
    // from unplaced.
    const placed = planned
      ? []
      : visible.filter(
          (table): table is TableState & { posX: number; posY: number } =>
            table.posX != null && table.posY != null,
        );
    const mapIds = new Set(onMap.map((table) => table.id));
    const unplaced = planned
      ? listed.filter((table) => !mapIds.has(table.id))
      : visible.filter((table) => table.posX == null);
    const drawn = planned ? onMap.length : placed.length;
    const view: "map" | "list" = this.viewOverride ?? (drawn > 0 ? "map" : "list");
    this.#drawsPlannedMap = planned && view === "map";
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
            this.canEdit && !planned
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
        ${refusedZone === undefined ? nothing : html`<p data-zone-closed role="status">${t("menu.zone_closed").replace("{zone}", () => refusedZone.name)}</p>`}
        ${(() => {
          const zone = this.zones.find((z) => z.id === activeKey);
          return zone?.closesAt
            ? html`<div class="service-period" data-zone-control>
                <p role="status">
                  ${t(zone.closed ? "keep_open.zone_closed" : "keep_open.zone_closes")
                    .replace("{zone}", () => zone.name)
                    .replace("{time}", () => zone.closesAt!)}
                </p>
                ${zoneKeepOpen({ zoneId: zone.id, zoneName: zone.name, closesAt: zone.closesAt, running: !zone.closed, extendedUntil: null }, this.api, zone.id)}
              </div>`
            : nothing;
        })()}
        ${this.#stationSummary()}
        ${
          view === "list"
            ? html`<div class="grid">${listed.map((table) => this.#card(table))}</div>`
            : planned
              ? this.#plannedMap(onMap, unplaced, activeKey)
              : this.#map(placed, unplaced)
        }
        ${this.#seatDialog()} ${this.#clearDialog()} ${this.#detailsSheet()}
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
          .locale=${currentLocale()}
          @wt-open-table=${(event: Event) => this.#onCanvasOpen(event)}
          @wt-placement-change=${(event: Event) => void this.#onPlacementChange(event)}
          @wt-placement-clear=${(event: Event) => void this.#onPlacementClear(event)}
        ></wt-floor-canvas>
        ${this.#tray(unplaced, placed)}
      </div>
    `;
  }

  /** `fitKey` and `tables` change in one update, so a new zone is fitted to its own tables. */
  #plannedMap(
    onMap: FloorMapTable[],
    unplaced: TableState[],
    activeKey: string | null | undefined,
  ): TemplateResult {
    return html`
      <div class="map">
        <wt-floor-map
          data-floor-map
          .tables=${onMap}
          .fitKey=${activeKey ?? ""}
          .copy=${{ label: t("floor.map_label") }}
          .reducedMotion=${this.reducedMotion}
          @wt-table-tap=${(event: Event) => this.#onCanvasOpen(event)}
          @wt-table-details=${(event: Event) => this.#onDetails(event)}
        ></wt-floor-map>
        ${this.#tray(unplaced, [])}
      </div>
    `;
  }

  #tray(unplaced: TableState[], placed: TableState[]): TemplateResult | typeof nothing {
    return unplaced.length > 0
      ? html`<div class="tray" aria-label=${t("floor.unplaced")}>
          <span class="tray-label">${t("floor.unplaced")}</span>
          ${unplaced.map((table) => this.#trayItem(table, placed))}
        </div>`
      : nothing;
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
        .locale=${currentLocale()}
        .labels=${{
          covers: t("floor.capacity"),
          toServe: t("floor.to_serve"),
          reserved: t("floor.reserved"),
          unsent: t("floor.unsent_mark"),
          fireDue: t("floor.fire_due"),
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
      .seats=${seatsFor(table)}
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
        ${this.#seats(table)}
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

  #seats(table: TableState): TemplateResult | typeof nothing {
    const seats = seatsFor(table);
    return seats !== null
      ? html`<span class="capacity">${seats} ${t("floor.capacity")}</span>`
      : nothing;
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
        ${this.#seats(table)}
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
          this.#fireDue(table)
            ? html`<span class="badge fire-due" data-fire-due>${t("floor.fire_due")}</span>`
            : nothing
        }
        ${renderFloorChips(tableChips(table))}
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

  /** Every zone's tables, not only the zone on screen: a station serves the whole floor. */
  #stationSummary(): TemplateResult | typeof nothing {
    const stations = readyByStation(this.tables);
    if (stations.length === 0) return nothing;
    return html`<section class="stations" data-station-summary aria-labelledby="stations-title">
      <h2 id="stations-title">${t("floor.ready_title")}</h2>
      <ul>
        ${stations.map((station) => this.#stationRow(station))}
      </ul>
    </section>`;
  }

  #stationRow(station: StationReady): TemplateResult {
    const tables = station.parties
      .map(({ name, count }) =>
        t("floor.station_table")
          .replace("{table}", () => name)
          .replace("{n}", String(count)),
      )
      .join(", ");
    return html`<li class="station-ready" data-station-ready=${station.stationId}>
      <span class="station-tables" data-station-tables
        >${t("floor.station_tables")
          .replace("{station}", () => station.stationName)
          .replace("{tables}", () => tables)}</span
      >
      ${
        this.canOpenStation
          ? html`<wt-button
              size="sm"
              variant="secondary"
              data-open-station=${station.stationId}
              @click=${() => this.#emit("show-station", { stationId: station.stationId })}
            >
              ${t("floor.open_station").replace("{station}", () => station.stationName)}
            </wt-button>`
          : nothing
      }
    </li>`;
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
   * and unserved, so all three counts can be positive at once. The stations' ready chips stand in
   * for the ready count when the table carries them. */
  #hint(table: TableState): TemplateResult | typeof nothing {
    if (table.enRoute > 0) {
      return html`<span class="badge en-route" data-en-route
        >${table.enRoute} ${t("floor.en_route")}</span
      >`;
    }
    if (table.readyToServe > 0) {
      if (signalOf(table.signals, "ready") !== undefined) return nothing;
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
              : html`<span class="total"
                  >${formatMoney(table.party?.outstanding ?? table.tabTotal!, currentLocale())}</span
                >`
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
