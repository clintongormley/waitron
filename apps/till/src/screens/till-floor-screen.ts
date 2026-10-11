import { zoneKeepOpen, servicePeriodStyles } from "../widgets/service-period.js";
import { tillPath } from "../navigation.js";
import {
  LitElement,
  type PropertyValues,
  type TemplateResult,
  css,
  html,
  nothing,
  unsafeCSS,
} from "lit";
import { styleMap } from "lit/directives/style-map.js";
import { PHONE_WIDTH } from "../widgets/language-chooser-styles.js";
import { customElement, property, state } from "lit/decorators.js";
import { trackDialog } from "../widgets/track-dialog.js";
import type { TimingBand } from "@waitron/shared";
import {
  baseStyles,
  cropToTables,
  UrlStateController,
  buildZoneTabs,
  floorTrayStyles,
  inNumberOrder,
  isTableZoneless,
  mergeLabel,
  renderFloorChips,
  resolveActiveTabKey,
  toFloorTable,
} from "@waitron/ui";
import type { FloorMapDrop, FloorMapTable, FloorTable, ZoneTab } from "@waitron/ui";
import { decimal, formatMoney, isZeroDecimal } from "@waitron/shared";
import { currentLocale, t } from "../i18n/t.js";
import "../widgets/seat-dialog.js";
import "../widgets/today-seats-dialog.js";
import "../widgets/bill-choice-dialog.js";
import "../widgets/join-with-dialog.js";
import "../widgets/floor-zone-menu.js";
import type { JoinWithPickDetail } from "../widgets/join-with-dialog.js";
import type { BillChoiceDetail } from "../widgets/bill-choice-dialog.js";
import { otherPartyRead, partyScope } from "../widgets/table-targets.js";
import type { TodaySeatsDetail } from "../widgets/today-seats-dialog.js";
import { codeMessage } from "../i18n/codes.js";
import {
  type DropAction,
  type SheetAction,
  dropAction,
  pendingPlaces,
  spareSpot,
} from "../state/floor-today.js";
import { partyPaid, unsentText } from "../widgets/table-details-sheet.js";
import type { SeatConfirmDetail } from "../widgets/seat-dialog.js";
import { drawnGroupKey, listedTables, mapTables, seatsFor } from "../state/floor-map.js";
import type { FloorZone, TableState, TableParty, TillApi, TodayPlacement } from "../api/client.js";
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

/** Sent by the 15-second re-read; an action's `floor-refresh` carries no detail. */
export interface FloorRefreshDetail {
  poll: true;
}

type JoinAction = Extract<DropAction, { kind: "join" }>;

const asksSeats = (refused: { code?: string; field?: unknown }): boolean =>
  refused.code === "floor_plan.invalid" && refused.field === "seats";

function placedAt(table: TableState, pending: Map<string, TodayPlacement>): TableState {
  const placement = pending.get(table.id);
  return placement === undefined || table.today === null
    ? table
    : { ...table, today: { ...table.today, placement } };
}

interface ZoneOnScreen {
  tabs: ZoneTab[];
  refusedZone: FloorZone | undefined;
  activeKey: string | null | undefined;
  planned: boolean;
  /** The active zone's tables as the server last read them, before `#pending` is applied. */
  visible: TableState[];
  view: "map" | "list";
  listed: TableState[];
  onMap: FloorMapTable[];
  unplaced: TableState[];
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

      /* The view toggle stays visible in an embedded card without its own header. */
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

      .map {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
      }

      wt-floor-map {
        align-self: center;
        width: min(
          100%,
          calc(max(var(--wt-tap-min) * 6, 100dvh - var(--wt-tap-min) * 8) * var(--floor-map-ratio))
        );
        aspect-ratio: var(--floor-map-ratio);
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
  @property({ attribute: false }) api?: TillApi;
  @property({ attribute: false }) canExitToCounter = true;
  /** The device's profile allows `take-orders`, which every change to today's plan needs: the map's
   * drag and the details sheet's actions. */
  @property({ attribute: false }) canChangeToday = false;
  /** The device has a station view, so each station's ready work links into it. */
  @property({ attribute: false }) canOpenStation = false;
  /** Mounted inside a card host, which supplies the header; the view toggle stays. */
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
  /** The free table whose guest count is being asked for, with the tables seated beside it. */
  @state() private seating: { table: TableState; heading: string; withTableIds?: string[] } | null =
    null;
  @state() private refusedZoneId: string | null = null;
  /** The table tapped on the map that needs clearing. */
  @state() private clearing: TableState | null = null;
  /** The table whose details sheet is open, read afresh from `tables` on each render. */
  @state() private details: { tableId: string } | null = null;
  /** The floor's last refusal, in its code's words; cleared by the next drop or a change of zone. */
  @state() private refusal: string | null = null;
  /** A merge the server would not size, or Change seats, waiting for the seats prompt. */
  @state() private askingSeats: {
    heading: string;
    seatsGuess: number;
    action: "join" | "save";
    resend: (seats: number) => void;
  } | null = null;
  /** Join with…'s table; closed when the table leaves the map. */
  @state() private joiningWith: { tableId: string } | null = null;
  /** A drop joining two seated parties, waiting for which bills to keep. */
  @state() private askingBills: { api: TillApi; action: JoinAction } | null = null;

  readonly #url = new UrlStateController(
    this,
    () => {
      const zone = this.#url.read("till-zone");
      this.activeZone = zone === null ? undefined : zone === "" ? null : zone;
    },
    tillPath,
  );

  /** The zone on screen, worked out in `willUpdate` when one of `#zoneInputs` changes. */
  #zone!: ZoneOnScreen;
  #zoneInputs?: readonly unknown[];
  /** Where a dropped group is drawn until the next floor read, a refusal or a cancel. */
  #pending: Map<string, TodayPlacement> | null = null;
  #mapCopy = { locale: "", copy: { label: "" } };

  /** The clock the last render judged reminders by. */
  #drawnAt = 0;
  #reminderTimer?: ReturnType<typeof setTimeout>;
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

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("tables") && this.askingSeats === null && this.askingBills === null)
      this.#pending = null;
    this.#drawnAt = this.now ?? Date.now();
    if (this.details !== null && !this.tables.some((table) => table.id === this.details!.tableId))
      this.details = null;
    this.#zone = this.#zoneOnScreen();
    if (this.joiningWith !== null && this.#joining(this.joiningWith.tableId) === undefined)
      this.joiningWith = null;
  }

  override updated(): void {
    this.#watchReminders();
    this.#watchFloor();
  }

  #watchFloor(): void {
    if (this.#zone.view !== "map" || !this.isConnected) {
      clearInterval(this.#rereadTimer);
      this.#rereadTimer = undefined;
      return;
    }
    this.#rereadTimer ??= setInterval(
      () => this.#emit("floor-refresh", { poll: true } satisfies FloorRefreshDetail),
      15_000,
    );
  }

  #fireDue(table: TableState): boolean {
    return reminderDueAt(table.party?.reminder) <= this.#drawnAt;
  }

  /** The server's floor does not change when a reminder falls due, so the screen redraws itself then. */
  #watchReminders(): void {
    clearTimeout(this.#reminderTimer);
    if (this.now !== undefined || !this.isConnected) return;
    let next = Number.POSITIVE_INFINITY;
    for (const table of this.tables) {
      const dueAt = reminderDueAt(table.party?.reminder);
      if (dueAt > this.#drawnAt && dueAt < next) next = dueAt;
    }
    if (next === Number.POSITIVE_INFINITY) return;
    this.#reminderTimer = setTimeout(() => this.requestUpdate(), delayUntil(next));
  }

  /**
   * A seated table resumes; a table needing clearing offers Mark cleared; a free one asks for guests,
   * headed and seated beside the other tables `seat` names when a drop gives them.
   */
  #openTable(
    table: TableState,
    seat: { heading: string; withTableIds: string[] } | null = null,
  ): void {
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
      this.seating =
        seat === null
          ? { table, heading: this.#mergeName(table) ?? table.label }
          : { table, ...seat };
      return;
    }
    this.#emit("open-table", { tableId: table.id, seated: true });
  }

  #onSeatConfirm(event: Event, seating: NonNullable<TillFloorScreen["seating"]>): void {
    event.stopPropagation();
    this.seating = null;
    const { guestCount } = (event as CustomEvent<SeatConfirmDetail>).detail;
    const { table, withTableIds } = seating;
    this.#emit("open-table", {
      tableId: table.id,
      seated: false,
      guestCount,
      ...(withTableIds === undefined ? {} : { withTableIds }),
    });
  }

  #onDetails(event: Event): void {
    event.stopPropagation();
    const { tableId } = (event as CustomEvent<{ tableId: string }>).detail;
    if (this.tables.some((table) => table.id === tableId)) this.details = { tableId };
  }

  /** The name of the merge `table` is drawn in, or null for a table drawn on its own. */
  #mergeName(table: TableState): string | null {
    const joinId = table.today?.joinId ?? null;
    const members =
      joinId === null ? [] : this.#zone.onMap.filter((drawn) => drawn.joinId === joinId);
    if (!members.some((drawn) => drawn.id === table.id)) return null;
    return mergeLabel(members.map((drawn) => drawn.label));
  }

  /** The party `table` is linked to on the map (a party drawn as two or more groups), or null. */
  #linkOf(table: TableState): string | null {
    return this.#zone.onMap.find((drawn) => drawn.id === table.id)?.linkId ?? null;
  }

  /** A linked party's name, as the map names it: every one of its tables. */
  #linkName(linkId: string): string {
    return mergeLabel(
      this.#zone.onMap.filter((drawn) => drawn.linkId === linkId).map((drawn) => drawn.label),
    );
  }

  #detailsHeading(table: TableState): string {
    return this.#mergeName(table) ?? t("floor.table_title").replace("{table}", () => table.label);
  }

  #detailsSheet(): TemplateResult | typeof nothing {
    const details = this.details;
    if (details === null) return nothing;
    const table = this.tables.find((candidate) => candidate.id === details.tableId)!;
    return html`<till-table-details-sheet
      .table=${table}
      .heading=${this.#detailsHeading(table)}
      .now=${this.#drawnAt}
      .actions=${this.canChangeToday}
      @today-action=${(event: Event) => this.#onTodayAction(event)}
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
    this.refusal = null;
    this.activeZone = key;
    this.#url.write({ "till-tab": this.#url.read("till-tab") ?? "floor", "till-zone": key ?? "" });
  }

  #toggleView(current: "map" | "list"): void {
    this.viewOverride = current === "map" ? "list" : "map";
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

  #setPending(pending: Map<string, TodayPlacement> | null): void {
    this.#pending = pending;
    this.requestUpdate();
  }

  #onDragEnd(event: Event): void {
    event.stopPropagation();
    this.#onDrop((event as CustomEvent<FloorMapDrop>).detail);
  }

  #onDrop(drop: FloorMapDrop): void {
    this.refusal = null;
    const action = dropAction(this.#zone.visible, drop);
    switch (action.kind) {
      case "say":
        this.refusal = action.message;
        return;
      case "move": {
        const api = this.api;
        if (api === undefined) return;
        this.#setPending(pendingPlaces(this.#zone.visible, action));
        void this.#settle(api.moveToday(action.tableId, { x: action.x, y: action.y }));
        return;
      }
      case "merge":
        if (this.api === undefined) return;
        this.#setPending(pendingPlaces(this.#zone.visible, action));
        void this.#merge(this.api, action);
        return;
      case "seat": {
        const table = this.#zone.visible.find((each) => each.id === action.tableId)!;
        this.#openTable(table, { heading: action.heading, withTableIds: action.withTableIds });
        return;
      }
      case "join":
        if (this.api === undefined) return;
        this.#setPending(pendingPlaces(this.#zone.visible, action));
        if (action.other === null) void this.#join(this.api, action, "merge");
        else this.askingBills = { api: this.api, action };
        return;
      default:
        return;
    }
  }

  #onTodayAction(event: Event): void {
    event.stopPropagation();
    this.refusal = null;
    const { action, tableId } = (event as CustomEvent<{ action: SheetAction; tableId: string }>)
      .detail;
    // The sheet is drawn only while `tables` holds its table.
    const table = this.tables.find((each) => each.id === tableId)!;
    const api = this.api;
    if (api === undefined) return;
    switch (action) {
      case "join-with":
        this.joiningWith = { tableId };
        return;
      case "split":
        void this.#settle(this.#split(api, table));
        return;
      case "rotate":
        void this.#settle(api.rotateToday(table.id));
        return;
      case "seats":
        this.askingSeats = {
          heading: this.#mergeName(table) ?? table.label,
          seatsGuess: seatsFor(table) ?? 0,
          action: "save",
          resend: (seats) => void this.#settle(api.setSeatsToday(table.id, seats)),
        };
        return;
      case "back":
        void this.#settle(api.backToSavedToday(table.id));
        return;
      case "take-off":
        void this.#settle(api.takeOffToday(table.id));
        return;
    }
  }

  /** A seated merge loses the last member of its name, with a new empty bill (slice 4 decision 16). */
  async #split(api: TillApi, table: TableState): Promise<void> {
    const party = table.party;
    if (party === null) return api.splitToday(table.id);
    const joinId = table.today?.joinId;
    const last = this.#zone.visible
      .filter((each) => each.today?.joinId === joinId)
      .sort((a, b) => inNumberOrder(a.label, b.label))
      .at(-1)!;
    await api.splitTable(party.id, last.id, null, party.revision);
  }

  /** The zone's table Join with… was opened for, while the map draws it. */
  #joining(tableId: string): (TableState & { today: { placement: TodayPlacement } }) | undefined {
    return this.#zone.visible.find(
      (each): each is TableState & { today: { placement: TodayPlacement } } =>
        each.id === tableId && each.today?.placement != null,
    );
  }

  /**
   * One per placed group of the zone, a party linked across groups counting once, its first member
   * in the map's label order named as the map names it, leaving out every group a drop of `table` on it would do nothing with.
   */
  #joinTargets(table: TableState, from: TodayPlacement): TableState[] {
    const zoneTables = this.#zone.visible;
    const seen = new Set<string>();
    const targets: TableState[] = [];
    for (const each of [...zoneTables].sort((a, b) => inNumberOrder(a.label, b.label))) {
      if (each.today?.placement == null) continue;
      const linkId = this.#linkOf(each);
      const group = drawnGroupKey(each, linkId);
      if (seen.has(group)) continue;
      seen.add(group);
      const drop = { tableId: table.id, x: from.x, y: from.y, targetId: each.id };
      if (dropAction(zoneTables, drop).kind === "none") continue;
      const label = linkId === null ? this.#mergeName(each) : this.#linkName(linkId);
      targets.push({ ...each, label: label ?? each.label });
    }
    return targets;
  }

  /** The dialog is drawn only while `#joining` finds its table, so the pick finds it too. */
  #onJoinWithPick(event: Event): void {
    event.stopPropagation();
    const { tableId, targetId } = (event as CustomEvent<JoinWithPickDetail>).detail;
    const { x, y } = this.#joining(tableId)!.today.placement;
    this.#onDrop({ tableId, x, y, targetId });
  }

  #joinWith(): TemplateResult | typeof nothing {
    const joining = this.joiningWith === null ? undefined : this.#joining(this.joiningWith.tableId);
    if (joining === undefined) return nothing;
    return html`<till-join-with-dialog
      .table=${joining}
      .targets=${this.#joinTargets(joining, joining.today.placement)}
      .heading=${t("floor.join_with_title").replace("{table}", () => joining.label)}
      @join-with-pick=${(event: Event) => this.#onJoinWithPick(event)}
      @join-with-close=${(event: Event) => {
        event.stopPropagation();
        this.joiningWith = null;
      }}
    ></till-join-with-dialog>`;
  }

  /** The dragged party joins the party at the target (decision 5 of the floor plan's slice 4). */
  async #join(
    api: TillApi,
    action: JoinAction,
    bills: BillChoiceDetail["bills"],
    seats?: number,
  ): Promise<void> {
    const { party, tableId, merge, other } = action;
    // Who the drop read at `tableId`, as the bill question named them, never a later read.
    const revisions = {
      expectedPartyRevision: party.revision,
      ...otherPartyRead(
        other === null ? null : { id: other.id, revision: other.revision },
        party.id,
      ),
    };
    const call =
      merge === null
        ? api.joinTables(party.id, tableId, bills, revisions)
        : api.joinTables(party.id, tableId, bills, revisions, {
            ...merge,
            ...(seats === undefined ? {} : { seats }),
          });
    await this.#settle(
      call.then(() => undefined),
      (refused) => {
        if (merge === null || seats !== undefined || !asksSeats(refused)) return false;
        this.askingSeats = {
          heading: action.heading,
          seatsGuess: action.seatsGuess,
          action: "join",
          resend: (chosen) => void this.#join(api, action, bills, chosen),
        };
        return true;
      },
    );
  }

  /** Sent without seats, a merge with no saved join is refused so the waiter can be asked. */
  async #merge(
    api: TillApi,
    action: Extract<DropAction, { kind: "merge" }>,
    seats?: number,
  ): Promise<void> {
    await this.#settle(
      api.mergeToday(action.tableId, {
        targetId: action.targetId,
        side: action.side,
        ...(seats === undefined ? {} : { seats }),
      }),
      (refused) => {
        if (seats !== undefined || !asksSeats(refused)) return false;
        this.askingSeats = {
          heading: action.heading,
          seatsGuess: action.seatsGuess,
          action: "join",
          resend: (chosen) => void this.#merge(api, action, chosen),
        };
        return true;
      },
    );
  }

  /** Every floor write: a refusal says its words and drops `#pending`, then the floor is re-read. */
  async #settle(
    call: Promise<void>,
    asks: (refused: { code?: string; field?: unknown }) => boolean = () => false,
  ): Promise<void> {
    try {
      await call;
    } catch (cause) {
      const refused = (cause ?? {}) as { code?: string; field?: unknown };
      if (asks(refused)) return;
      this.refusal = codeMessage(refused.code ?? "server.internal");
      this.#setPending(null);
    }
    this.#requestFloorRefresh();
  }

  #seatsPrompt(): TemplateResult | typeof nothing {
    const asking = this.askingSeats;
    if (asking === null) return nothing;
    return html`<till-today-seats-dialog
      .action=${asking.action}
      .heading=${t("floor.seats_title").replace("{table}", () => asking.heading)}
      .seats=${asking.seatsGuess}
      @today-seats-confirm=${(event: Event) => {
        event.stopPropagation();
        this.askingSeats = null;
        asking.resend((event as CustomEvent<TodaySeatsDetail>).detail.seats);
      }}
      @today-seats-cancel=${(event: Event) => {
        event.stopPropagation();
        this.askingSeats = null;
        this.#setPending(null);
      }}
    ></till-today-seats-dialog>`;
  }

  #billChoice(): TemplateResult | typeof nothing {
    const asking = this.askingBills;
    if (asking === null) return nothing;
    const { api, action } = asking;
    const scope = t("table.combine_scope")
      .replace("{from}", () => partyScope(action.other!, this.tables))
      .replace("{into}", () => partyScope(action.party, this.tables));
    return html`<till-bill-choice-dialog
      .scope=${scope}
      @bill-choice-confirm=${(event: Event) => {
        event.stopPropagation();
        this.askingBills = null;
        void this.#join(api, action, (event as CustomEvent<BillChoiceDetail>).detail.bills);
      }}
      @bill-choice-cancel=${(event: Event) => {
        event.stopPropagation();
        this.askingBills = null;
        this.#setPending(null);
      }}
    ></till-bill-choice-dialog>`;
  }

  /**
   * Every action is a write through a `take-orders` route, so the menu needs `canChangeToday`. A zone
   * with a saved plan and no tables is offered it too, since only a reset brings in tables its plan
   * has gained. `planned` covers a zone list read before the plan was saved: a floor refresh re-reads
   * the tables, not the zones.
   */
  #zoneMenu(
    planned: boolean,
    activeKey: string | null | undefined,
  ): TemplateResult | typeof nothing {
    const zone = this.zones.find((each) => each.id === activeKey);
    if (zone === undefined || !(planned || zone.hasPlan) || !this.canChangeToday) return nothing;
    return html`<till-floor-zone-menu
      .zone=${zone}
      .tables=${this.#zone.visible}
      @zone-place-spare=${(event: CustomEvent<{ tableId: string }>) =>
        this.#onZoneChange(event, (api) =>
          api.placeSpareToday(event.detail.tableId, spareSpot(this.#zone.visible)),
        )}
      @zone-put-back=${(event: CustomEvent<{ tableId: string }>) =>
        this.#onZoneChange(event, (api) => api.putBackToday(event.detail.tableId))}
      @zone-reset=${(event: CustomEvent<{ zoneId: string }>) =>
        this.#onZoneChange(event, (api) => api.resetZoneToday(event.detail.zoneId))}
    ></till-floor-zone-menu>`;
  }

  #onZoneChange(event: Event, call: (api: TillApi) => Promise<void>): void {
    event.stopPropagation();
    this.refusal = null;
    const api = this.api;
    if (api === undefined) return;
    void this.#settle(call(api));
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

  #zoneOnScreen(): ZoneOnScreen {
    const inputs = [
      this.tables,
      this.zones,
      this.activeZone,
      this.refusedZoneId,
      this.viewOverride,
      this.#pending,
      currentLocale(),
    ];
    if (this.#zoneInputs?.every((input, i) => input === inputs[i])) return this.#zone;
    this.#zoneInputs = inputs;
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
    const planned = visible.some((table) => table.today !== null);
    const listed = listedTables(visible);
    const pending = this.#pending;
    const drawn = pending === null ? visible : visible.map((table) => placedAt(table, pending));
    const onMap = mapTables(drawn);
    const mapIds = new Set(onMap.map((table) => table.id));
    const unplaced = listed.filter((table) => !mapIds.has(table.id));
    const view = this.viewOverride ?? (onMap.length > 0 ? "map" : "list");
    return {
      tabs,
      refusedZone,
      activeKey,
      planned,
      visible,
      view,
      listed,
      onMap,
      unplaced,
    };
  }

  /** Rebuilt only when the language changes, so a redraw hands the map the same copy. */
  #floorMapCopy(): { label: string } {
    const locale = currentLocale();
    if (this.#mapCopy.locale !== locale)
      this.#mapCopy = { locale, copy: { label: t("floor.map_label") } };
    return this.#mapCopy.copy;
  }

  override render() {
    const { tabs, refusedZone, activeKey, planned, view, listed, onMap, unplaced } = this.#zone;
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
          ${this.#zoneMenu(planned, activeKey)}
        </div>
        ${
          tabs.length > 0
            ? html`<nav class="tabs" aria-label=${t("floor.zones")}>
                ${tabs.map((tab) => this.#tab(tab, activeKey))}
              </nav>`
            : nothing
        }
        ${refusedZone === undefined ? nothing : html`<p data-zone-closed role="status">${t("menu.zone_closed").replace("{zone}", () => refusedZone.name)}</p>`}
        ${this.refusal === null ? nothing : html`<p data-floor-refusal role="status">${this.refusal}</p>`}
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
            : this.#plannedMap(onMap, unplaced, activeKey)
        }
        ${this.#seatDialog()} ${this.#clearDialog()} ${this.#detailsSheet()} ${this.#seatsPrompt()}
        ${this.#billChoice()} ${this.#joinWith()}
      </section>
    `;
  }

  /** `fitKey` and `tables` change in one update, so a new zone is fitted to its own tables. */
  #plannedMap(
    onMap: FloorMapTable[],
    unplaced: TableState[],
    activeKey: string | null | undefined,
  ): TemplateResult {
    const crop = cropToTables(onMap.map((table) => table.placement));
    const ratio = crop === null ? 1 : crop.width / crop.height;
    return html`
      <div class="map">
        <wt-floor-map
          style=${styleMap({ "--floor-map-ratio": String(ratio) })}
          data-floor-map
          .tables=${onMap}
          .fitKey=${activeKey ?? ""}
          .copy=${this.#floorMapCopy()}
          .reducedMotion=${this.reducedMotion}
          .canDrag=${this.canChangeToday}
          @wt-table-tap=${(event: Event) => this.#onCanvasOpen(event)}
          @wt-table-details=${(event: Event) => this.#onDetails(event)}
          @wt-table-drag-end=${(event: Event) => this.#onDragEnd(event)}
        ></wt-floor-map>
        ${this.#tray(unplaced)}
      </div>
    `;
  }

  #tray(unplaced: TableState[]): TemplateResult | typeof nothing {
    return unplaced.length > 0
      ? html`<div class="tray" aria-label=${t("floor.unplaced")}>
          <span class="tray-label">${t("floor.unplaced")}</span>
          ${unplaced.map((table) => this.#trayItem(table))}
        </div>`
      : nothing;
  }

  #trayItem(table: TableState): TemplateResult {
    return html`<button
      class="tray-item"
      data-tray-table=${table.id}
      @click=${() => this.#openTable(table)}
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
    const seating = this.seating;
    if (seating === null) return nothing;
    return html`<till-seat-dialog
      .tableLabel=${seating.heading}
      @seat-confirm=${(event: Event) => this.#onSeatConfirm(event, seating)}
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
