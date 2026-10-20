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
import { PHONE_WIDTH } from "../widgets/language-chooser-styles.js";
import { MediaQueryController } from "../state/media-query-controller.js";
import { customElement, property, state } from "lit/decorators.js";
import { trackDialog } from "../widgets/track-dialog.js";
import {
  baseStyles,
  UrlStateController,
  buildZoneTabs,
  floorRingStyles,
  floorTrayStyles,
  inNumberOrder,
  MAP_SEPARATOR,
  mergeLabel,
  renderFloorChips,
  renderFloorRing,
  resolveActiveTabKey,
  toFloorTable,
} from "@waitron/ui";
import type { FloorMapDrop, FloorMapTable, FloorRing, FloorTable, ZoneTab } from "@waitron/ui";
import {
  conjunctionList,
  decimal,
  formatMoney,
  isZeroDecimal,
  partyTablesName,
} from "@waitron/shared";
import { currentLocale, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import "../widgets/seat-dialog.js";
import "../widgets/today-seats-dialog.js";
import "../widgets/bill-choice-dialog.js";
import "../widgets/join-with-dialog.js";
import "../widgets/split-joined-dialog.js";
import type { SplitJoinedDetail, TillSplitJoinedDialog } from "../widgets/split-joined-dialog.js";
import "../widgets/reset-table-dialog.js";
import type { ResetTableDetail, TillResetTableDialog } from "../widgets/reset-table-dialog.js";
import "../widgets/floor-zone-menu.js";
import "../widgets/today-name-dialog.js";
import type {
  TillTodayNameDialog,
  TodayNameDetail,
  TodayNameRefusal,
} from "../widgets/today-name-dialog.js";
import type { JoinWithPickDetail } from "../widgets/join-with-dialog.js";
import type { BillChoiceDetail } from "../widgets/bill-choice-dialog.js";
import { otherPartyRead, partyScope } from "../widgets/table-targets.js";
import type { TodaySeatsDetail } from "../widgets/today-seats-dialog.js";
import { codeMessage } from "../i18n/codes.js";
import {
  type DropAction,
  type SheetAction,
  dropAction,
  detailsHeading,
  groupName,
  groupSplitOf,
  needsMovingToday,
  nextFloorMoment,
  normalGroupName,
  onTodaysPlan,
  pendingPlaces,
  resetTableOf,
  type ResetTablePlan,
  sheetActions,
  savedNameUnder,
  seatsAtFreeTable,
  seatsGuests,
  shownName,
  shownUnder,
  spareSpot,
  tableSentence,
  withoutTodaysNames,
} from "../state/floor-today.js";
import { partyPaid, unsentText } from "../widgets/table-details-sheet.js";
import type { SeatConfirmDetail } from "../widgets/seat-dialog.js";
import {
  drawnGroupKey,
  listedTables,
  mapTables,
  seatsFor,
  totalSeats,
} from "../state/floor-map.js";
import type {
  BillEditExpected,
  FloorAnswer,
  FloorZone,
  TableState,
  TableParty,
  TillApi,
  TodayPlacement,
} from "../api/client.js";
import { TABLE_REQUEST_LIMIT_MS, limited } from "../state/draft-sync.js";
import { delayUntil, nextCountdownChange, reminderDueAt } from "../state/release-reminder.js";
import { reminderClock } from "../state/floor-look.js";
import { readyByStation, signalOf, type StationReady } from "../state/table-signals.js";
import { chipState, heldChip, signalChipStyles, signalChips } from "../widgets/signal-chips.js";
import {
  byPrecedence,
  lateBand,
  tableStates,
  type TableStateKind,
} from "../state/table-precedence.js";
import { helpAnchorStyles, helpBadge } from "../widgets/help-badge.js";

/** The words of a table that needs clearing or moving. */
const WAITING = {
  clear: {
    state: "floor.needs_clearing",
    title: "floor.clear_title",
    titleNamed: "floor.clear_title_named",
    body: "floor.clear_body",
    action: "floor.mark_cleared",
  },
  move: {
    state: "floor.needs_moving",
    title: "floor.move_title",
    titleNamed: "floor.move_title_named",
    body: "floor.move_body",
    action: "floor.mark_moved",
  },
} as const satisfies Record<string, Record<string, StringKey>>;

type Waiting = keyof typeof WAITING;
type TodayAction = "leave-here" | "mark-moved";

function needsClearing(table: TableState): boolean {
  return table.condition === "needs_clearing";
}

/** The party's name when it says more than the name the table is shown under: a name staff gave,
 * or a joined party's tables. */
function shownPartyName(table: TableState): string | undefined {
  const name = table.party?.displayName;
  return name === undefined || name === shownUnder(table) ? undefined : name;
}

const RING_OF: Partial<Record<TableStateKind, FloorRing>> = {
  forgotten: "forgotten",
  overdue: "overdue",
  fire: "fire",
  waiting: "waiting",
};

/** The table's own Forgotten badge already says a forgotten wait. */
function tableChips(table: TableState, now: number) {
  const chips = signalChips(table.signals, { forgottenShown: lateBand(table) === "forgotten" });
  const held = heldChip(table.signals, reminderDueAt(table.party?.reminder), now);
  return byPrecedence(held === null ? chips : [...chips, held], (chip) =>
    chipState(chip, table.signals),
  );
}

interface CardMark {
  kind: TableStateKind | undefined;
  mark: TemplateResult;
}

/** `poll` is the 15-second re-read; `zones` asks for the zones as well as the tables. */
export interface FloorRefreshDetail {
  poll?: true;
  zones?: true;
}

type JoinAction = Extract<DropAction, { kind: "join" }>;

interface FloorJoin {
  api: TillApi;
  action: JoinAction;
  room: Room;
  operatorSession: number;
  connection: number;
  zone: string | undefined;
  selectedZone: string | undefined;
  read: AbortController;
  expectedEdits: BillEditExpected[];
}

type ZonedTable = TableState & { zoneId: string };

/** A room and its revision as the screen saw it when a change was asked for. */
interface Room {
  zoneId: string;
  revision: number | null;
}

interface SplitShown {
  joined: TableState;
  parts: TableState[];
  name: string;
  asksSeats(staying: readonly string[]): boolean;
  guestsMoveTo(ticked: readonly string[]): string[];
  strandsGuests(ticked: readonly string[]): boolean;
}

interface SplittingJoined {
  tableId: string;
  /** What the window showed when Split was pressed, until its answer arrives. */
  sent: SplitShown | null;
  refusal: { code: string; field?: string } | null;
  /** The server refused for want of seats, which the till's own `asksSeats` did not foresee. */
  seatsRequired: boolean;
}

interface RenameShown {
  table: TableState;
  heading: string;
  normalName: string;
}

interface Renaming {
  tableId: string;
  /** The name at opening. The waiter's draft lives in the window's own `value`; this one is never
   * changed, so a floor read never replaces what the waiter typed. */
  value: string;
  /** The tables of its group at opening, or null: a rename in a group renames the group, so the
   * window closes when that changes before Save. */
  group: string | null;
  /** What the window showed at Save, until the answer arrives. */
  sent: RenameShown | null;
  refusal: TodayNameRefusal | null;
}

interface ResettingTable {
  tableId: string;
  /** The plan sent, until its answer arrives. */
  sent: ResetTablePlan | null;
  /** `message` is the refusal's sentence naming the tables, when the floor read has their names. */
  refusal: { code: string; field?: string; message?: string } | null;
}

/** A server refusal: its code, and its params as the client spreads them beside it. */
type Refused = { code?: string; field?: unknown } & Record<string, unknown>;

const asksSeats = (refused: { code?: string }): boolean => refused.code === "merge.seats_required";

/** Sent at once, without asking seats, when every table comes back, and when the server will refuse
 * it whatever the seats. */
const resetsAtOnce = (plan: ResetTablePlan): boolean => plan.whole || plan.refusedInGroup;

function placedAt(table: TableState, pending: Map<string, TodayPlacement>): TableState {
  const placement = pending.get(table.id);
  return placement === undefined || table.today === null
    ? table
    : { ...table, today: { ...table.today, placement } };
}

interface ZoneOnScreen {
  tabs: ZoneTab[];
  refusedZone: FloorZone | undefined;
  activeKey: string | undefined;
  planned: boolean;
  /** The active zone's tables as the server last read them, before `#pending` is applied. */
  visible: ZonedTable[];
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
    floorRingStyles,
    signalChipStyles,
    helpAnchorStyles,
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

        /* Room for the badge hanging past the trailing edge, whether help is on or off. */
        .actions,
        .layout-due {
          margin-inline-end: calc(var(--wt-help-badge-target) / 2);
        }
      }

      [data-leave-here-offer] {
        align-self: flex-start;
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
        flex: none;
        align-items: center;
        gap: var(--wt-space-2);
        margin-inline-start: auto;
      }

      .zone-toolbar {
        display: flex;
        min-width: 0;
        align-items: center;
        gap: var(--wt-space-2);
      }

      /* As wide as its words and button, so its help badge hangs on Update layout's corner. */
      .layout-due {
        display: flex;
        width: fit-content;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
      }

      .layout-due p {
        margin: 0;
      }

      .tabs {
        display: flex;
        min-width: 0;
        overflow-x: auto;
        flex-wrap: nowrap;
        gap: var(--wt-space-2);
      }
      .tabs > * {
        flex: none;
        white-space: nowrap;
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
        position: relative;
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

      .card.calm {
        border-left-color: var(--wt-color-table-calm-edge);
      }

      .card.state-delivery-pending {
        border-left-color: var(--wt-color-danger);
      }

      .card.clearing {
        border-left-color: var(--wt-color-warning);
        cursor: default;
      }

      .card.edge-forgotten {
        border-left-color: var(--wt-color-danger);
        border-left-width: var(--wt-space-3);
      }

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

      .saved-label,
      .capacity {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .saved-label {
        white-space: nowrap;
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

      /* Mirrors @waitron/ui's wt-table-token .badge.reserved. */
      .badge.reserved {
        background: var(--wt-color-table-reserved);
        color: var(--wt-color-on-table-reserved);
        border: 1px solid var(--wt-color-table-reserved);
      }

      .calm-line {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-1);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
      }

      .calm-line wt-icon,
      .badge wt-icon {
        flex: none;
        color: inherit;
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
         neutral chip (the a11y-safe pattern wt-table-token's status chip uses). */
      .badge.ready {
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text);
        border: 1px solid var(--wt-color-success);
      }

      /* Mirrors @waitron/ui's wt-table-token .badge.fire-due. */
      .badge.fire-due {
        background: var(--wt-color-warning);
        color: var(--wt-color-on-warning);
        border: 1px solid var(--wt-color-warning);
      }

      .badge.unsent {
        max-width: 100%;
        overflow-wrap: anywhere;
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
    `,
  ];

  @property({ attribute: false }) zones: FloorZone[] = [];
  @property({ attribute: false }) tables: TableState[] = [];
  /** When the read that drew `tables` started, numbered by `nextFloorMoment`. */
  @property({ attribute: false }) tablesReadAt = 0;
  @property({ attribute: false }) api?: TillApi;
  @property({ attribute: false }) operatorSession = 0;
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
   * redraws the floor when the next reminder falls due, and each minute a held countdown changes. */
  @property({ attribute: false }) now?: number;

  @state() private activeZone: string | undefined = undefined;
  @property() selectedZoneId: string | undefined = undefined;
  /** `undefined` DERIVES the view per active zone; a toggle tap pins it for the session, not persisted. */
  @state() private viewOverride: "map" | "list" | undefined = undefined;
  /** The free table whose guest count is being asked for, with the tables seated beside it. */
  @state() private seating: {
    table: TableState;
    heading: string;
    /** `heading` is a name for today. */
    named: boolean;
    withTableIds?: string[];
  } | null = null;
  @state() private refusedZoneId: string | null = null;
  /** The table tapped on the map that needs clearing. */
  @state() private clearing: TableState | null = null;
  /** The table tapped that needs moving. */
  @state() private moving: TableState | null = null;
  /** The table whose details sheet is open, read afresh from `tables` on each render. */
  @state() private details: { tableId: string } | null = null;
  /** The floor's last refusal, in its code's words. */
  @state() private refusal: string | null = null;
  /** Drawn only while `refusal` still reads `message` and the table still needs moving. */
  @state() private leaveOffer: { tableId: string; message: string } | null = null;
  /** A table's Leave it here or Mark moved being sent; any other press for it is ignored meanwhile. */
  @state() private sendingToday: ReadonlyMap<string, TodayAction> = new Map();
  /** A merge's seats, or Change seats, waiting for the seats prompt. */
  @state() private askingSeats: {
    heading: string;
    seats: number | null;
    action: "join" | "save";
    resend: (seats: number) => void;
  } | null = null;
  /** Join with…'s table; closed when the table leaves the map. */
  @state() private joiningWith: { tableId: string } | null = null;
  /** The table Split tables… was opened on, while its window is open; `#splitShown` says when a
   * floor read closes it. */
  @state() private splittingJoined: SplittingJoined | null = null;
  /** Reset table's joined table, while its window is open; `#resetShown` says when a floor read
   * closes it. */
  @state() private resettingTable: ResettingTable | null = null;
  @state() private renaming: Renaming | null = null;
  /** A drop joining two seated parties, waiting for which bills to keep. */
  @state() private askingBills: FloorJoin | null = null;
  #joinWork: FloorJoin | null = null;
  #connection = 0;

  readonly #url = new UrlStateController(
    this,
    () => {
      const zone = this.#url.read("till-zone");
      this.activeZone = zone === null || zone === "" ? undefined : zone;
    },
    tillPath,
  );

  /** The zone on screen, worked out in `willUpdate` when one of `#zoneInputs` changes. */
  #zone!: ZoneOnScreen;
  #zoneInputs?: readonly unknown[];
  /** Where a dropped group is drawn until the next floor read, a refusal or a cancel. */
  #pending: Map<string, TodayPlacement> | null = null;
  /** Each room's revision as this screen's last change there answered it, and that answer's `nextFloorMoment`. */
  #carried = new Map<string | null, { revision: number; answeredAt: number }>();
  #mapCopy = { locale: "", copy: { label: "", allergy: "" } };

  /** The clock the last render judged reminders by. */
  #drawnAt = 0;
  #reminderTimer?: ReturnType<typeof setTimeout>;
  #rereadTimer?: ReturnType<typeof setInterval>;

  readonly #phone = new MediaQueryController(this, PHONE_WIDTH);

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
    this.#connection++;
    this.#clearJoin();
    clearTimeout(this.#reminderTimer);
    clearInterval(this.#rereadTimer);
    this.#rereadTimer = undefined;
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("api") || changed.has("operatorSession") || changed.has("selectedZoneId"))
      this.#clearJoin();
    if (changed.has("selectedZoneId")) this.activeZone = this.selectedZoneId;
    if (
      changed.has("tables") &&
      this.askingSeats === null &&
      this.askingBills === null &&
      this.#joinWork === null
    )
      this.#pending = null;
    if (
      this.seating !== null &&
      [this.seating.table.id, ...(this.seating.withTableIds ?? [])].some(
        (id) => !this.tables.some((table) => table.id === id),
      )
    )
      this.seating = null;
    if (this.clearing !== null && !this.tables.some((table) => table.id === this.clearing!.id))
      this.clearing = null;
    if (
      this.moving !== null &&
      !this.tables.some((table) => table.id === this.moving!.id && needsMovingToday(table))
    )
      this.moving = null;
    this.#drawnAt = this.now ?? Date.now();
    if (this.details !== null && !this.tables.some((table) => table.id === this.details!.tableId))
      this.details = null;
    this.#zone = this.#zoneOnScreen();
    if (this.#joinWork !== null && !this.#joinCurrent(this.#joinWork)) this.#clearJoin();
    if (this.joiningWith !== null && this.#joining(this.joiningWith.tableId) === undefined)
      this.joiningWith = null;
    if (this.splittingJoined !== null && this.#splitShown(this.splittingJoined) === undefined) {
      if (this.splittingJoined.refusal !== null)
        this.refusal = codeMessage(this.splittingJoined.refusal.code);
      this.splittingJoined = null;
    }
    if (this.resettingTable !== null && this.#resetShown(this.resettingTable) === undefined) {
      if (this.resettingTable.refusal !== null)
        this.refusal =
          this.resettingTable.refusal.message ?? codeMessage(this.resettingTable.refusal.code);
      this.resettingTable = null;
    }
    if (this.renaming !== null && this.#renameShown(this.renaming) === undefined) {
      if (this.renaming.refusal !== null) this.refusal = codeMessage(this.renaming.refusal.code);
      this.renaming = null;
    }
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

  /** The server's floor does not change when a reminder falls due or a held countdown's minutes
   * change, so the screen redraws itself then. */
  #watchReminders(): void {
    clearTimeout(this.#reminderTimer);
    if (this.now !== undefined || !this.isConnected) return;
    let next = Number.POSITIVE_INFINITY;
    for (const table of this.tables) {
      const dueAt = reminderDueAt(table.party?.reminder);
      if (dueAt <= this.#drawnAt || dueAt === Number.POSITIVE_INFINITY) continue;
      const at = table.signals.some((signal) => signal.kind === "held")
        ? nextCountdownChange(dueAt, this.#drawnAt)
        : dueAt;
      if (at < next) next = at;
    }
    if (next === Number.POSITIVE_INFINITY) return;
    this.#reminderTimer = setTimeout(() => this.requestUpdate(), delayUntil(next));
  }

  /**
   * A seated table resumes; a table needing clearing offers Mark cleared, and one needing moving
   * Leave it here and Mark moved; a free one asks for guests, headed and seated beside the other
   * tables `seat` names when a drop gives them.
   */
  #openTable(
    table: TableState,
    seat: { heading: string; named: boolean; withTableIds: string[] } | null = null,
  ): void {
    if (!this.tables.some((current) => current.id === table.id)) return;
    if (needsClearing(table)) {
      this.clearing = table;
      return;
    }
    if (needsMovingToday(table)) {
      this.moving = table;
      return;
    }
    if (table.party === null && !table.hasOpenTab) {
      const zone = this.zones.find((candidate) => candidate.id === table.zoneId);
      if (zone !== undefined && (zone.closed || !seatsGuests(zone))) {
        this.refusal = null;
        this.refusedZoneId = zone.id;
        return;
      }
      this.refusedZoneId = null;
      this.seating = seat === null ? { table, ...this.#seatHeading(table) } : { table, ...seat };
      return;
    }
    this.#emit("open-table", { tableId: table.id, seated: true });
  }

  #onSeatConfirm(event: Event, seating: NonNullable<TillFloorScreen["seating"]>): void {
    event.stopPropagation();
    if (
      this.seating !== seating ||
      [seating.table.id, ...(seating.withTableIds ?? [])].some(
        (id) => !this.tables.some((table) => table.id === id),
      )
    )
      return;
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

  /** The tables of the merge `table` is drawn in, or null for a table drawn on its own. */
  #mergeOf(table: TableState): TableState[] | null {
    const joinId = table.today?.joinId ?? null;
    const ids = new Set(
      joinId === null
        ? []
        : this.#zone.onMap.filter((drawn) => drawn.joinId === joinId).map((drawn) => drawn.id),
    );
    return ids.has(table.id) ? this.#zone.visible.filter((each) => ids.has(each.id)) : null;
  }

  /** The name of the merge `table` is drawn in, or null for a table drawn on its own. */
  #mergeName(table: TableState): string | null {
    const members = this.#mergeOf(table);
    return members === null ? null : groupName(members);
  }

  /** The name `table` is shown under: its merge's, else its own. */
  #shownAs(table: TableState): string {
    return this.#mergeName(table) ?? shownName(table);
  }

  #seatHeading(table: TableState): { heading: string; named: boolean } {
    const heading = this.#shownAs(table);
    const members = this.#mergeOf(table);
    const saved = members === null ? table.label : groupName(members.map(withoutTodaysNames));
    return { heading, named: heading !== saved };
  }

  /** The party `table` is linked to on the map (a party drawn as two or more groups), or null. */
  #linkOf(table: TableState): string | null {
    return this.#zone.onMap.find((drawn) => drawn.id === table.id)?.linkId ?? null;
  }

  /** A linked party's name, as the map names it: every one of its tables, or with a name for
   * today among them, each of its groups' names in their first tables' order. */
  #linkName(linkId: string): string {
    const ids = new Set(
      this.#zone.onMap.filter((drawn) => drawn.linkId === linkId).map((drawn) => drawn.id),
    );
    const tables = this.#zone.visible.filter((each) => ids.has(each.id));
    if (tables.every((each) => each.today?.name == null && each.today?.joinName == null))
      return mergeLabel(tables.map((each) => each.label));
    const groups = new Map<string, TableState[]>();
    for (const each of tables) {
      const key = each.today?.joinId ?? `table:${each.id}`;
      groups.set(key, [...(groups.get(key) ?? []), each]);
    }
    const firstLabel = (members: TableState[]) =>
      members.map((each) => each.label).sort(inNumberOrder)[0]!;
    return partyTablesName(
      [...groups.values()]
        .sort((a, b) => inNumberOrder(firstLabel(a), firstLabel(b)))
        .map(groupName),
      MAP_SEPARATOR,
    );
  }

  #detailsHeading(table: TableState): string {
    return detailsHeading(table, this.#mergeName(table));
  }

  #savedName(table: TableState): string | null {
    return savedNameUnder(table, this.#detailsHeading(table));
  }

  #detailsSheet(): TemplateResult | typeof nothing {
    const details = this.details;
    if (details === null) return nothing;
    const table = this.tables.find((candidate) => candidate.id === details.tableId)!;
    return html`<till-table-details-sheet
      .table=${table}
      .heading=${this.#detailsHeading(table)}
      .savedName=${this.#savedName(table)}
      .now=${this.#drawnAt}
      .actions=${this.canChangeToday}
      .tables=${this.tables}
      .offersJoinWith=${this.#offersJoinWith(table)}
      @today-action=${(event: Event) => this.#onTodayAction(event)}
      @details-close=${(event: Event) => {
        event.stopPropagation();
        this.details = null;
      }}
    ></till-table-details-sheet>`;
  }

  #offersJoinWith(table: TableState): boolean {
    if (seatsGuests(this.zones.find((zone) => zone.id === table.zoneId))) return true;
    const joining = this.#joining(table.id);
    return joining !== undefined && this.#joinTargets(joining, joining.today.placement).length > 0;
  }

  #markCleared(table: TableState): void {
    if (!this.tables.some((current) => current.id === table.id)) return;
    this.clearing = null;
    this.#emit("mark-cleared", { tableId: table.id });
  }

  #markMoved(table: TableState): void {
    this.#sendTodayAction(table, "mark-moved", (api, sent) => api.markMovedToday(table.id, sent), {
      offersLeaveHere: true,
    });
  }

  #leaveHere(table: TableState): void {
    this.leaveOffer = null;
    this.#sendTodayAction(table, "leave-here", (api, sent) => api.leaveHereToday(table.id, sent));
  }

  #sendTodayAction(
    table: TableState,
    action: TodayAction,
    call: (api: TillApi, revision: number) => Promise<FloorAnswer>,
    { offersLeaveHere = false }: { offersLeaveHere?: boolean } = {},
  ): void {
    this.moving = null;
    const api = this.api;
    if (api === undefined || !this.tables.some((current) => current.id === table.id)) return;
    if (this.sendingToday.has(table.id)) return;
    this.refusal = null;
    this.sendingToday = new Map(this.sendingToday).set(table.id, action);
    void this.#settle(
      this.#send(this.#revision(table.zoneId), (sent) => call(api, sent)),
      offersLeaveHere ? { written: { tableId: table.id } } : {},
    ).finally(() => {
      const sending = new Map(this.sendingToday);
      sending.delete(table.id);
      this.sendingToday = sending;
    });
  }

  #leaveHereOffer(): TemplateResult | typeof nothing {
    const offer = this.leaveOffer;
    if (offer === null || offer.message !== this.refusal || !this.canChangeToday) return nothing;
    const table = this.#zone.visible.find((each) => each.id === offer.tableId);
    if (table === undefined || !needsMovingToday(table)) return nothing;
    return html`<wt-button
      data-leave-here-offer
      size="sm"
      variant="secondary"
      @click=${() => this.#leaveHere(table)}
    >
      ${t("floor.leave_here")}
    </wt-button>`;
  }

  #emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  #back(): void {
    this.dispatchEvent(new CustomEvent("back-to-counter", { bubbles: true, composed: true }));
  }

  #selectZone(key: string): void {
    this.refusedZoneId = null;
    this.refusal = null;
    this.activeZone = key;
    this.#url.write({ "till-tab": this.#url.read("till-tab") ?? "floor", "till-zone": key });
  }

  #toggleView(current: "map" | "list"): void {
    this.viewOverride = current === "map" ? "list" : "map";
  }

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

  /** The room's revision as this screen last saw it: its read, unless its own answer came after that read started. */
  #revision(zoneId: string | null): number | null {
    const carried = this.#carried.get(zoneId);
    if (carried !== undefined && this.tablesReadAt < carried.answeredAt) return carried.revision;
    return (
      this.tables.find((each) => each.zoneId === zoneId && each.today !== null)?.today!
        .zoneRevision ?? null
    );
  }

  /** The room of the table a drop acted on, which `dropAction` found in `#zone.visible`. */
  #dropRoom(tableId: string): Room {
    const { zoneId } = this.#zone.visible.find((each) => each.id === tableId)!;
    return { zoneId, revision: this.#revision(zoneId) };
  }

  #dropZone(tableId: string): FloorZone | undefined {
    const { zoneId } = this.#zone.visible.find((each) => each.id === tableId)!;
    return this.zones.find((zone) => zone.id === zoneId);
  }

  /** A null revision is answered here as a stale one is, without being sent: only the zone routes
   * accept null. */
  #send<T>(revision: number | null, call: (revision: number) => Promise<T>): Promise<T> {
    return revision === null ? Promise.reject({ code: "floor_today.out_of_date" }) : call(revision);
  }

  #onDragEnd(event: Event): void {
    event.stopPropagation();
    this.#onDrop((event as CustomEvent<FloorMapDrop>).detail);
  }

  #onDrop(drop: FloorMapDrop): void {
    this.#clearJoin();
    this.refusal = null;
    this.refusedZoneId = null;
    const action = dropAction(this.#zone.visible, drop);
    if (seatsAtFreeTable(action) && !seatsGuests(this.#dropZone(drop.tableId))) {
      this.refusal = codeMessage("service_zone.mode_incompatible");
      return;
    }
    switch (action.kind) {
      case "say":
        this.refusal = action.message;
        return;
      case "move": {
        const api = this.api;
        if (api === undefined) return;
        this.#setPending(pendingPlaces(this.#zone.visible, action));
        void this.#settle(
          this.#send(this.#dropRoom(drop.tableId).revision, (revision) =>
            api.moveToday(action.tableId, { x: action.x, y: action.y }, revision),
          ),
        );
        return;
      }
      case "merge":
        if (this.api === undefined) return;
        this.#setPending(pendingPlaces(this.#zone.visible, action));
        void this.#merge(this.api, action, this.#dropRoom(drop.tableId).revision);
        return;
      case "seat": {
        const table = this.#zone.visible.find((each) => each.id === action.tableId)!;
        const saved = dropAction(this.#zone.visible.map(withoutTodaysNames), drop);
        this.#openTable(table, {
          heading: action.heading,
          named: saved.kind === "seat" && saved.heading !== action.heading,
          withTableIds: action.withTableIds,
        });
        return;
      }
      case "join": {
        if (this.api === undefined) return;
        this.#setPending(pendingPlaces(this.#zone.visible, action));
        const room = this.#dropRoom(drop.tableId);
        void this.#prepareJoin(this.api, action, room);
        return;
      }
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
    const revision = this.#revision(table.zoneId);
    const send = (call: (revision: number) => Promise<FloorAnswer>) =>
      void this.#settle(this.#send(revision, call));
    switch (action) {
      case "join-with":
        this.joiningWith = { tableId };
        return;
      case "split-off":
        this.splittingJoined = { tableId, sent: null, refusal: null, seatsRequired: false };
        return;
      case "reset-table": {
        const plan = resetTableOf(table, this.tables);
        if (plan === null) return;
        if (resetsAtOnce(plan))
          send((sent) =>
            api.resetTableToday(
              plan.joined.id,
              { partIds: plan.back.map((each) => each.id) },
              sent,
            ),
          );
        else this.resettingTable = { tableId: plan.joined.id, sent: null, refusal: null };
        return;
      }
      case "rotate":
        send((sent) => api.rotateToday(table.id, sent));
        return;
      case "seats":
        this.askingSeats = {
          heading: this.#shownAs(table),
          seats: seatsFor(table) ?? 0,
          action: "save",
          resend: (seats) => send((sent) => api.setSeatsToday(table.id, seats, sent)),
        };
        return;
      case "rename":
        this.renaming = this.#renameOpening(table);
        return;
      case "back":
        void this.#settle(
          this.#send(revision, (sent) => api.backToSavedToday(table.id, sent)),
          { written: { tableId: table.id, back: true } },
        );
        return;
      case "take-off":
        send((sent) => api.takeOffToday(table.id, sent));
        return;
    }
  }

  /** The zone's table Join with… was opened for, while the map draws it. */
  #joining(tableId: string): (ZonedTable & { today: { placement: TodayPlacement } }) | undefined {
    return this.#zone.visible.find(
      (each): each is ZonedTable & { today: { placement: TodayPlacement } } =>
        each.id === tableId && each.today?.placement != null,
    );
  }

  /**
   * One per group of the zone on today's plan, a party linked across groups counting once, its first member
   * in the map's label order named as the map names it, leaving out every group a drop of `table` on it would do nothing with,
   * or would seat guests at in an area that does not seat them, sorted by those names.
   */
  #joinTargets(table: TableState, from: TodayPlacement): TableState[] {
    const zoneTables = this.#zone.visible;
    const seats = seatsGuests(this.zones.find((zone) => zone.id === table.zoneId));
    const seen = new Set<string>();
    const targets: TableState[] = [];
    for (const each of [...zoneTables].sort((a, b) => inNumberOrder(a.label, b.label))) {
      if (!onTodaysPlan(each)) continue;
      const linkId = this.#linkOf(each);
      const group = drawnGroupKey(each, linkId);
      if (seen.has(group)) continue;
      seen.add(group);
      const drop = { tableId: table.id, x: from.x, y: from.y, targetId: each.id };
      const action = dropAction(zoneTables, drop);
      if (action.kind === "none" || (!seats && seatsAtFreeTable(action))) continue;
      const label = linkId === null ? this.#mergeName(each) : this.#linkName(linkId);
      // `tableTarget` draws a table's own name for today ahead of its label.
      targets.push({
        ...each,
        label: label ?? shownName(each),
        today: { ...each.today!, name: null },
      });
    }
    return targets.sort((a, b) => inNumberOrder(a.label, b.label));
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
      .heading=${t("floor.join_with_title").replace("{table}", () => shownName(joining))}
      @join-with-pick=${(event: Event) => this.#onJoinWithPick(event)}
      @join-with-close=${(event: Event) => {
        event.stopPropagation();
        this.joiningWith = null;
      }}
    ></till-join-with-dialog>`;
  }

  #clearJoin(): void {
    if (this.#joinWork === null) return;
    this.#joinWork.read.abort();
    this.#joinWork = null;
    this.askingBills = null;
    this.askingSeats = null;
    this.#setPending(null);
  }

  #joinCurrent(asked: FloorJoin): boolean {
    return (
      this.#joinWork === asked &&
      this.isConnected &&
      this.api === asked.api &&
      this.operatorSession === asked.operatorSession &&
      this.#connection === asked.connection &&
      this.#zone.activeKey === asked.zone &&
      this.selectedZoneId === asked.selectedZone
    );
  }

  async #prepareJoin(api: TillApi, action: JoinAction, room: Room): Promise<void> {
    const asked: FloorJoin = {
      api,
      action,
      room,
      operatorSession: this.operatorSession,
      connection: this.#connection,
      zone: this.#zone.activeKey,
      selectedZone: this.selectedZoneId,
      read: new AbortController(),
      expectedEdits: [],
    };
    this.#joinWork = asked;
    const limit = limited(TABLE_REQUEST_LIMIT_MS, asked.read.signal);
    try {
      for (const party of [action.party, ...(action.other === null ? [] : [action.other])]) {
        const answer = await api.listDrafts(party.id, { signal: limit.signal });
        if (!this.#joinCurrent(asked)) return;
        asked.expectedEdits.push(
          ...answer.billEdits.map(({ billId, editorVersion, draftId, draftRevision }) => ({
            billId,
            editorVersion,
            draftId,
            draftRevision,
          })),
        );
      }
      asked.expectedEdits.sort((a, b) => (a.billId < b.billId ? -1 : a.billId > b.billId ? 1 : 0));
      if (
        new Set(asked.expectedEdits.map((edit) => edit.billId)).size !== asked.expectedEdits.length
      )
        throw { code: "draft.out_of_date" };
      if (action.other === null) await this.#join(asked, "merge");
      else this.askingBills = asked;
    } catch (cause) {
      if (!this.#joinCurrent(asked)) return;
      const code = (cause as { code?: string } | undefined)?.code;
      this.refusal =
        code === "draft.taken_over" || code === "draft.out_of_date"
          ? codeMessage(code)
          : t("table.draft_read_failed");
      this.#clearJoin();
      this.#requestFloorRefresh();
    } finally {
      limit.done();
    }
  }

  async #join(asked: FloorJoin, bills: BillChoiceDetail["bills"], seats?: number): Promise<void> {
    if (!this.#joinCurrent(asked)) return;
    const { api, action, room, expectedEdits } = asked;
    const { party, tableId, merge, other } = action;
    const revisions = {
      expectedPartyRevision: party.revision,
      ...otherPartyRead(
        other === null ? null : { id: other.id, revision: other.revision },
        party.id,
      ),
      expectedEdits,
    };
    const call =
      merge === null
        ? api.joinTables(party.id, tableId, bills, revisions).then(() => null)
        : this.#send(room.revision, async (zoneRevision) => {
            const answer = await api.joinTables(party.id, tableId, bills, revisions, {
              ...merge,
              ...(seats === undefined ? {} : { seats }),
              zoneRevision,
            });
            const revision = answer.zoneRevisions?.[room.zoneId];
            return revision === undefined ? null : { zoneId: room.zoneId, revision };
          });
    let askingSeats = false;
    await this.#settle(call, {
      asks: (refused) => {
        if (merge === null || seats !== undefined || !asksSeats(refused)) return false;
        askingSeats = true;
        this.askingSeats = {
          heading: action.heading,
          seats: this.#joinSeats(merge.moving, merge.target),
          action: "join",
          resend: (chosen) => void this.#join(asked, bills, chosen),
        };
        return true;
      },
      current: () => this.#joinCurrent(asked),
    });
    if (this.#joinCurrent(asked) && !askingSeats) this.#joinWork = null;
  }

  /** The server refuses a merge without seats (`merge.seats_required`), which opens the seats prompt. */
  async #merge(
    api: TillApi,
    action: Extract<DropAction, { kind: "merge" }>,
    revision: number | null,
    seats?: number,
  ): Promise<void> {
    await this.#settle(
      this.#send(revision, (sent) =>
        api.mergeToday(
          action.tableId,
          {
            targetId: action.targetId,
            side: action.side,
            ...(seats === undefined ? {} : { seats }),
          },
          sent,
        ),
      ),
      {
        asks: (refused) => {
          if (seats !== undefined || !asksSeats(refused)) return false;
          this.askingSeats = {
            heading: action.heading,
            seats: this.#joinSeats(action.tableId, action.targetId),
            action: "join",
            resend: (chosen) => void this.#merge(api, action, revision, chosen),
          };
          return true;
        },
      },
    );
  }

  #joinSeats(movingId: string, targetId: string): number | null {
    return totalSeats(
      [movingId, targetId].map((id) => {
        const table = this.tables.find((each) => each.id === id);
        return table === undefined ? null : seatsFor(table);
      }),
    );
  }

  async #settle(
    call: Promise<FloorAnswer | null>,
    {
      asks = () => false,
      refresh,
      written,
      current = () => true,
    }: {
      asks?: (refused: { code?: string; field?: unknown }) => boolean;
      refresh?: FloorRefreshDetail;
      written?: { tableId: string; back?: true };
      current?: () => boolean;
    } = {},
  ): Promise<void> {
    try {
      const answer = await call;
      if (!current()) return;
      this.#carry(answer);
    } catch (cause) {
      if (!current()) return;
      const refused = (cause ?? {}) as Refused;
      if (asks(refused)) return;
      const refusal =
        written?.back === true && refused.code === "table.place_taken"
          ? codeMessage("table.place_taken")
          : this.#refusalText(refused);
      this.refusal = refusal;
      this.leaveOffer =
        written !== undefined && refused.code === "table.new_place_taken"
          ? { tableId: written.tableId, message: refusal }
          : null;
      this.#setPending(null);
    }
    this.#requestFloorRefresh(refresh);
  }

  #refusalText(refused: Refused): string {
    const code = refused.code ?? "server.internal";
    return this.#namedRefusal(code, refused) ?? codeMessage(code);
  }

  /** The refusal's sentence naming its tables, or undefined when it names none or the floor read no
   * longer has one of them. */
  #namedRefusal(code: string, refused: Refused): string | undefined {
    const tableOf = (id: unknown) => this.tables.find((each) => each.id === id);
    const nameOf = (id: unknown) => {
      const table = tableOf(id);
      return table === undefined ? undefined : shownName(table);
    };
    switch (code) {
      case "table.place_taken": {
        const standing = nameOf(refused.standingId);
        const joined = nameOf(refused.tableId);
        if (standing === undefined || joined === undefined) return undefined;
        return t("floor.place_taken")
          .replaceAll("{table}", () => standing)
          .replace("{joined}", () => joined);
      }
      case "joined_table.tables_in_group": {
        const ids = Array.isArray(refused.partIds) ? (refused.partIds as unknown[]) : [];
        const parts = ids.map(tableOf);
        if (parts.length === 0 || parts.some((each) => each === undefined)) return undefined;
        const joinId = parts[0]!.today?.joinId ?? null;
        if (joinId === null || parts.some((each) => each!.today?.joinId !== joinId))
          return undefined;
        const group = this.#mergeName(parts[0]!);
        if (group === null) return undefined;
        const labels = parts.map((each) => shownName(each!));
        const sentence =
          labels.length === 1
            ? t("floor.table_in_group").replace("{table}", () => labels[0]!)
            : t("floor.tables_in_group").replace("{tables}", () =>
                conjunctionList(labels, currentLocale()),
              );
        return sentence.replace("{group}", () => group);
      }
      case "table.needs_moving": {
        const table = tableOf(refused.tableId);
        return table === undefined
          ? undefined
          : tableSentence(table, "floor.needs_moving_first", "floor.needs_moving_first_named");
      }
      case "table.booked": {
        const table = tableOf(refused.tableId);
        return table === undefined
          ? undefined
          : tableSentence(table, "floor.booked_first", "floor.booked_first_named");
      }
      case "table.new_place_taken": {
        const other = nameOf(refused.standingId);
        const table = nameOf(refused.tableId);
        if (other === undefined || table === undefined) return undefined;
        return t("floor.new_place_taken")
          .replaceAll("{other}", () => other)
          .replace("{table}", () => table);
      }
      case "table.split_off": {
        const from = tableOf(refused.tableId)?.today?.splitOffFrom ?? null;
        const joined = from === null ? undefined : nameOf(from);
        return joined === undefined
          ? undefined
          : t("floor.split_off_reset").replace("{joined}", () => joined);
      }
      default:
        return undefined;
    }
  }

  #carry(answer: FloorAnswer | null): void {
    if (answer !== null)
      this.#carried.set(answer.zoneId, {
        revision: answer.revision,
        answeredAt: nextFloorMoment(),
      });
  }

  #seatsPrompt(): TemplateResult | typeof nothing {
    const asking = this.askingSeats;
    if (asking === null) return nothing;
    return html`<till-today-seats-dialog
      .action=${asking.action}
      .heading=${t("floor.seats_title").replace("{table}", () => asking.heading)}
      .seats=${asking.seats}
      @today-seats-confirm=${(event: Event) => {
        event.stopPropagation();
        if (this.askingSeats !== asking) return;
        this.askingSeats = null;
        asking.resend((event as CustomEvent<TodaySeatsDetail>).detail.seats);
      }}
      @today-seats-cancel=${(event: Event) => {
        event.stopPropagation();
        if (this.askingSeats !== asking) return;
        this.#clearJoin();
        this.askingSeats = null;
        this.#setPending(null);
      }}
    ></till-today-seats-dialog>`;
  }

  /** The table Split tables… was opened on, while it still offers Split tables…. */
  #splitting(tableId: string): TableState | undefined {
    return this.tables.find(
      (each) => each.id === tableId && sheetActions(each).includes("split-off"),
    );
  }

  /** While its split is out, the window keeps what it showed unless the table it was opened on has
   * left the floor read; otherwise it shows that table's joined table, or its group, as the floor
   * reads it now. */
  #splitShown(splitting: SplittingJoined): SplitShown | undefined {
    if (splitting.sent !== null)
      return this.tables.some((each) => each.id === splitting.tableId) ? splitting.sent : undefined;
    const joined = this.#splitting(splitting.tableId);
    if (joined === undefined) return undefined;
    const group = groupSplitOf(
      joined,
      this.tables.filter((each) => each.zoneId === joined.zoneId),
    );
    if (group !== null) {
      const { members, name, asksSeats, guestsMoveTo, strandsGuests } = group;
      return { joined, parts: members, name, asksSeats, guestsMoveTo, strandsGuests };
    }
    return {
      joined,
      parts: joined.today!.joined!.parts.flatMap((id) =>
        this.tables.filter((each) => each.id === id),
      ),
      name: shownName(joined),
      asksSeats: (staying) => staying.length >= 2,
      guestsMoveTo: () => [],
      strandsGuests: () => false,
    };
  }

  #splitJoined(): TemplateResult | typeof nothing {
    const splitting = this.splittingJoined;
    const shown = splitting === null ? undefined : this.#splitShown(splitting);
    if (splitting === null || shown === undefined) return nothing;
    return html`<till-split-joined-dialog
      .joined=${shown.joined}
      .parts=${shown.parts}
      .name=${shown.name}
      .asksSeats=${shown.asksSeats}
      .guestsMoveTo=${shown.guestsMoveTo}
      .strandsGuests=${shown.strandsGuests}
      .seatsRequired=${splitting.seatsRequired}
      .busy=${splitting.sent !== null}
      .refusal=${splitting.refusal}
      @split-joined-confirm=${(event: CustomEvent<SplitJoinedDetail>) => {
        event.stopPropagation();
        void this.#splitOff(event.currentTarget as TillSplitJoinedDialog, event.detail);
      }}
      @split-joined-cancel=${(event: Event) => {
        event.stopPropagation();
        this.splittingJoined = null;
      }}
    ></till-split-joined-dialog>`;
  }

  /**
   * The window stays open while the split is sent. The answer is applied only to the window that
   * sent it: that window closes if the table it was opened on leaves the floor read meanwhile, and
   * another can open. A refusal shows in the window while the floor still offers Split tables…, and
   * otherwise on the floor, unless another Split tables… window has opened.
   */
  async #splitOff(dialog: TillSplitJoinedDialog, detail: SplitJoinedDetail): Promise<void> {
    const splitting = this.splittingJoined;
    const shown = splitting === null ? undefined : this.#splitShown(splitting);
    const api = this.api;
    if (splitting === null || shown === undefined || splitting.sent !== null || api === undefined)
      return;
    const sending = { ...splitting, sent: shown, refusal: null };
    this.splittingJoined = sending;
    const revision = this.#revision(shown.joined.zoneId);
    try {
      this.#carry(
        await this.#send(revision, (sent) =>
          api.splitOffToday(
            splitting.tableId,
            {
              partIds: detail.partIds,
              ...(detail.seats === null ? {} : { seats: detail.seats }),
            },
            sent,
          ),
        ),
      );
      if (this.splittingJoined === sending) {
        dialog.commit();
        this.splittingJoined = null;
      }
    } catch (cause) {
      const refused = (cause ?? {}) as { code?: string; field?: unknown };
      const code = refused.code ?? "server.internal";
      if (this.splittingJoined === sending && this.#splitting(splitting.tableId) !== undefined)
        this.splittingJoined = {
          ...splitting,
          sent: null,
          refusal: typeof refused.field === "string" ? { code, field: refused.field } : { code },
          seatsRequired:
            splitting.seatsRequired ||
            code === "merge.seats_required" ||
            code === "joined_table.seats_required",
        };
      else if (this.splittingJoined === sending || this.splittingJoined === null) {
        this.splittingJoined = null;
        this.refusal = codeMessage(code);
      }
    }
    this.#requestFloorRefresh();
  }

  /** A table in a group renames the group. */
  #renameOpening(table: TableState): Renaming {
    const members = this.#mergeRead(table);
    return {
      tableId: table.id,
      value: (members === null ? table.today?.name : table.today?.joinName) ?? "",
      group: this.#groupKey(table),
      sent: null,
      refusal: null,
    };
  }

  /** The tables of `table`'s merge in the floor read now, or null for a table on its own.
   * `#mergeOf` gives the merge as last drawn, which a floor read can be ahead of. */
  #mergeRead(table: TableState): TableState[] | null {
    const joinId = table.today?.joinId ?? null;
    if (joinId === null || !onTodaysPlan(table)) return null;
    return this.tables.filter(
      (each) => each.zoneId === table.zoneId && each.today?.joinId === joinId && onTodaysPlan(each),
    );
  }

  #groupKey(table: TableState): string | null {
    const members = this.#mergeRead(table);
    return members === null
      ? null
      : members
          .map((each) => each.id)
          .sort()
          .join(" ");
  }

  /** The table Rename was opened on, while it still offers Rename. */
  #renamable(tableId: string): TableState | undefined {
    return this.tables.find((each) => each.id === tableId && sheetActions(each).includes("rename"));
  }

  /** While its name is out, the window keeps what it showed until its table leaves the floor read;
   * otherwise it is shown, as the floor reads the table now, while the table offers Rename in the
   * group it was opened in. */
  #renameShown(renaming: Renaming): RenameShown | undefined {
    if (renaming.sent !== null)
      return this.tables.some((each) => each.id === renaming.tableId) ? renaming.sent : undefined;
    const table = this.#renamable(renaming.tableId);
    if (table === undefined || this.#groupKey(table) !== renaming.group) return undefined;
    const members = this.#mergeRead(table);
    const name = members === null ? shownName(table) : groupName(members);
    return {
      table,
      heading: t("floor.rename_title").replace("{table}", () => name),
      normalName: members === null ? table.label : normalGroupName(members),
    };
  }

  #renameWindow(): TemplateResult | typeof nothing {
    const renaming = this.renaming;
    const shown = renaming === null ? undefined : this.#renameShown(renaming);
    if (renaming === null || shown === undefined) return nothing;
    return html`<till-today-name-dialog
      .heading=${shown.heading}
      .value=${renaming.value}
      .normalName=${shown.normalName}
      .busy=${renaming.sent !== null}
      .refusal=${renaming.refusal}
      @today-name-confirm=${(event: CustomEvent<TodayNameDetail>) => {
        event.stopPropagation();
        void this.#rename(event.currentTarget as TillTodayNameDialog, event.detail.name);
      }}
      @today-name-cancel=${(event: Event) => {
        event.stopPropagation();
        this.renaming = null;
      }}
    ></till-today-name-dialog>`;
  }

  /** A refusal shows in the window, keeping what was typed, while the window would still be shown
   * before Save; otherwise it shows on the floor and the window closes, unless another Rename window
   * has opened. */
  async #rename(dialog: TillTodayNameDialog, name: string | null): Promise<void> {
    const renaming = this.renaming;
    const shown = renaming === null ? undefined : this.#renameShown(renaming);
    const api = this.api;
    if (renaming === null || renaming.sent !== null || shown === undefined || api === undefined)
      return;
    const sending = { ...renaming, sent: shown, refusal: null };
    this.renaming = sending;
    try {
      this.#carry(
        await this.#send(this.#revision(shown.table.zoneId), (sent) =>
          api.nameToday(renaming.tableId, name, sent),
        ),
      );
      if (this.renaming === sending) {
        dialog.commit();
        this.renaming = null;
      }
    } catch (cause) {
      const refused = (cause ?? {}) as { code?: string; field?: unknown };
      const code = refused.code ?? "server.internal";
      if (this.renaming === sending && this.#renameShown(renaming) !== undefined)
        this.renaming = {
          ...renaming,
          refusal: typeof refused.field === "string" ? { code, field: refused.field } : { code },
        };
      else if (this.renaming === sending || this.renaming === null) {
        this.renaming = null;
        this.refusal = codeMessage(code);
      }
    }
    this.#requestFloorRefresh();
  }

  /** Reset table's plan for the joined table it was opened for, while some of its tables stay apart. */
  #resetPlan(tableId: string): ResetTablePlan | undefined {
    const joined = this.tables.find((each) => each.id === tableId);
    const plan = joined === undefined ? null : resetTableOf(joined, this.tables);
    return plan === null || plan.whole ? undefined : plan;
  }

  /** While its request is out, the window keeps the plan it sent unless its joined table has left
   * the floor read; otherwise it shows the plan the floor reads now. */
  #resetShown(resetting: ResettingTable): ResetTablePlan | undefined {
    if (resetting.sent === null) return this.#resetPlan(resetting.tableId);
    return this.tables.some((each) => each.id === resetting.tableId) ? resetting.sent : undefined;
  }

  #resetTable(): TemplateResult | typeof nothing {
    const resetting = this.resettingTable;
    const plan = resetting === null ? undefined : this.#resetShown(resetting);
    if (resetting === null || plan === undefined) return nothing;
    return html`<till-reset-table-dialog
      .joined=${plan.joined}
      .apart=${plan.apart}
      .busy=${resetting.sent !== null}
      .refusal=${resetting.refusal}
      @reset-table-confirm=${(event: CustomEvent<ResetTableDetail>) => {
        event.stopPropagation();
        void this.#sendResetTable(event.currentTarget as TillResetTableDialog, event.detail);
      }}
      @reset-table-cancel=${(event: Event) => {
        event.stopPropagation();
        this.resettingTable = null;
      }}
    ></till-reset-table-dialog>`;
  }

  /**
   * As `#splitOff`: the window stays open until the answer, which applies only to the window that
   * sent it. The tables sent are the plan's as the floor reads them at the press, so a poll since
   * the window opened is what the server is asked to check against.
   */
  async #sendResetTable(dialog: TillResetTableDialog, detail: ResetTableDetail): Promise<void> {
    const resetting = this.resettingTable;
    const plan = resetting === null ? undefined : this.#resetPlan(resetting.tableId);
    const api = this.api;
    if (resetting === null || plan === undefined || resetting.sent !== null || api === undefined)
      return;
    const sending = { ...resetting, sent: plan, refusal: null };
    this.resettingTable = sending;
    const revision = this.#revision(plan.joined.zoneId);
    try {
      this.#carry(
        await this.#send(revision, (sent) =>
          api.resetTableToday(
            resetting.tableId,
            { partIds: plan.back.map((each) => each.id), seats: detail.seats },
            sent,
          ),
        ),
      );
      if (this.resettingTable === sending) {
        dialog.commit();
        this.resettingTable = null;
      }
    } catch (cause) {
      const refused = (cause ?? {}) as Refused;
      const code = refused.code ?? "server.internal";
      const message = this.#namedRefusal(code, refused);
      if (this.resettingTable === sending && this.#resetPlan(resetting.tableId) !== undefined)
        this.resettingTable = {
          ...resetting,
          sent: null,
          refusal: {
            code,
            ...(typeof refused.field === "string" ? { field: refused.field } : {}),
            ...(message === undefined ? {} : { message }),
          },
        };
      else if (this.resettingTable === sending || this.resettingTable === null) {
        this.resettingTable = null;
        this.refusal = message ?? codeMessage(code);
      }
    }
    this.#requestFloorRefresh();
  }

  #billChoice(): TemplateResult | typeof nothing {
    const asking = this.askingBills;
    if (asking === null) return nothing;
    const { action } = asking;
    const scope = t("table.combine_scope")
      .replace("{from}", () => partyScope(action.other!, this.tables))
      .replace("{into}", () => partyScope(action.party, this.tables));
    return html`<till-bill-choice-dialog
      .scope=${scope}
      @bill-choice-confirm=${(event: Event) => {
        event.stopPropagation();
        if (this.askingBills !== asking || !this.#joinCurrent(asking)) return;
        this.askingBills = null;
        void this.#join(asking, (event as CustomEvent<BillChoiceDetail>).detail.bills);
      }}
      @bill-choice-cancel=${(event: Event) => {
        event.stopPropagation();
        if (this.askingBills !== asking || !this.#joinCurrent(asking)) return;
        this.#clearJoin();
      }}
    ></till-bill-choice-dialog>`;
  }

  /**
   * Every action is a write through a `take-orders` route, so the menu needs `canChangeToday`. A zone
   * whose department has a set and no tables is offered it too, since only a reset brings in tables its
   * plan has gained. `planned` covers a zone list read before its department had a set: a floor refresh re-reads
   * the tables, not the zones. On a phone the menu also holds List or Map, so it shows whenever the floor
   * does.
   */
  #zoneMenu(
    planned: boolean,
    activeKey: string | undefined,
    view: "map" | "list",
  ): TemplateResult | typeof nothing {
    const zone = this.zones.find((each) => each.id === activeKey) ?? null;
    const zoneId = zone?.id ?? null;
    const canChange = zone !== null && (planned || zone.hasPlan) && this.canChangeToday;
    if (!canChange && !this.#phone.matches) return nothing;
    return html`<till-floor-zone-menu
      .zone=${zone}
      .tables=${this.#zone.visible}
      .phone=${this.#phone.matches}
      .view=${view}
      .canChangeToday=${canChange}
      @zone-toggle-view=${(event: Event) => {
        event.stopPropagation();
        this.#toggleView(view);
      }}
      @zone-place-spare=${(event: CustomEvent<{ tableId: string }>) =>
        this.#onZoneChange(event, zoneId, (api, revision) =>
          this.#send(revision, (sent) =>
            api.placeSpareToday(event.detail.tableId, spareSpot(this.#zone.visible), sent),
          ),
        )}
      @zone-put-back=${(event: CustomEvent<{ tableId: string }>) =>
        this.#onZoneChange(event, zoneId, (api, revision) =>
          this.#send(revision, (sent) => api.putBackToday(event.detail.tableId, sent)),
        )}
      @zone-reset=${(event: CustomEvent<{ zoneId: string }>) =>
        this.#onZoneChange(
          event,
          event.detail.zoneId,
          (api, revision) => api.resetZoneToday(event.detail.zoneId, revision),
          { zones: true },
        )}
    ></till-floor-zone-menu>`;
  }

  #onZoneChange(
    event: Event,
    zoneId: string | null,
    call: (api: TillApi, revision: number | null) => Promise<FloorAnswer>,
    refresh?: FloorRefreshDetail,
  ): void {
    event.stopPropagation();
    this.refusal = null;
    const api = this.api;
    if (api === undefined) return;
    void this.#settle(call(api, this.#revision(zoneId)), { refresh });
  }

  #requestFloorRefresh(detail?: FloorRefreshDetail): void {
    this.dispatchEvent(new CustomEvent("floor-refresh", { detail, bubbles: true, composed: true }));
  }

  /** The zones read says which layout is due, so after Update layout the zones are read again too. */
  #layoutBanner(activeKey: string | undefined): TemplateResult | typeof nothing {
    const zone = this.zones.find((each) => each.id === activeKey);
    const offer = zone?.layoutDue ?? null;
    if (zone === undefined || offer === null || !this.canChangeToday) return nothing;
    const { periodName } = offer;
    return html`<div class="layout-due help-anchor" data-layout-due>
      <p role="status">
        ${
          periodName === null
            ? t("floor.layout_newer")
            : t("floor.layout_ready").replace("{period}", () => periodName)
        }
      </p>
      <wt-button
        data-update-layout
        variant="primary"
        @click=${(event: Event) =>
          this.#onZoneChange(
            event,
            zone.id,
            (api, revision) =>
              api.updateLayoutToday(
                zone.id,
                { setId: offer.setId, revision: offer.revision },
                revision,
              ),
            { zones: true },
          )}
      >
        ${t("floor.update_layout")}
      </wt-button>
      ${helpBadge("help.floor.layout_due", t("floor.update_layout"))}
    </div>`;
  }

  /**
   * A `TableState` carries both the placement half and the occupancy half, so it is passed as both. A
   * seated party's token shows what it still owes; a table needing clearing shows that in the status
   * chip.
   */
  #toFloorTable(table: TableState): FloorTable {
    const tabTotal =
      table.party === null
        ? table.tabTotal
        : isZeroDecimal(decimal(table.party.outstanding))
          ? null
          : table.party.outstanding;
    const status = needsClearing(table)
      ? {
          id: "needs-clearing",
          label: t("floor.needs_clearing"),
          color: "var(--wt-color-warning)",
        }
      : null;
    return toFloorTable(
      { id: table.id, label: shownUnder(table), seats: seatsFor(table) },
      {
        ...table,
        timingBand: lateBand(table),
        // The server reads a table no party holds as free; one needing clearing must not look ready to seat.
        state: needsClearing(table) ? "open-tab" : table.state,
        tabTotal,
        status,
        reservedTime: table.nextReservation?.time ?? null,
        unsentDrafts: table.party?.unsentDrafts.map(unsentText),
        partyName: shownPartyName(table),
        fireDue: this.#fireDue(table),
        chips: tableChips(table, this.#drawnAt),
      },
    );
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
      reminderClock(this.tables, this.#drawnAt),
    ];
    if (this.#zoneInputs?.every((input, i) => input === inputs[i])) return this.#zone;
    this.#zoneInputs = inputs;
    const tabs = buildZoneTabs(
      this.zones.map((zone) => ({
        ...zone,
        name: zone.closed ? `${zone.name} · ${t("floor.closed")}` : zone.name,
      })),
    );
    const refusedZone = this.zones.find(
      (zone) => zone.id === this.refusedZoneId && (zone.closed || !seatsGuests(zone)),
    );
    const activeKey = resolveActiveTabKey(this.activeZone, tabs);
    const visible = this.tables.filter((table): table is ZonedTable => table.zoneId === activeKey);
    const planned = visible.some((table) => table.today !== null);
    const listed = listedTables(visible);
    const pending = this.#pending;
    const drawn = pending === null ? visible : visible.map((table) => placedAt(table, pending));
    const onMap = mapTables(drawn, this.#drawnAt);
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
  #floorMapCopy(): { label: string; allergy: string } {
    const locale = currentLocale();
    if (this.#mapCopy.locale !== locale)
      this.#mapCopy = {
        locale,
        copy: { label: t("floor.map_label"), allergy: t("floor.allergy") },
      };
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
        <div class="zone-toolbar">
          ${
            tabs.length > 1
              ? html`<nav class="tabs" aria-label=${t("floor.zones")}>
                  ${tabs.map((tab) => this.#tab(tab, activeKey))}
                </nav>`
              : nothing
          }
          <div class="actions help-anchor">
            ${
              this.#phone.matches
                ? nothing
                : html`<wt-button
                    class="view-toggle"
                    data-view-toggle
                    variant="secondary"
                    @click=${() => this.#toggleView(view)}
                  >
                    ${view === "map" ? t("floor.view_list") : t("floor.view_map")}
                  </wt-button>`
            }
            ${this.#zoneMenu(planned, activeKey, view)}
            ${helpBadge(
              view === "list"
                ? "help.floor.tables_list"
                : this.canChangeToday
                  ? "help.floor.tables_map"
                  : "help.floor.tables_map_view",
              t("floor.map_label"),
            )}
          </div>
        </div>
        ${this.#layoutBanner(activeKey)}
        ${
          refusedZone === undefined
            ? nothing
            : refusedZone.closed
              ? html`<p data-zone-closed role="status">
                  ${t("menu.zone_closed").replace("{zone}", () => refusedZone.name)}
                </p>`
              : html`<p data-zone-no-seating role="status">
                  ${codeMessage("service_zone.mode_incompatible")}
                </p>`
        }
        ${this.refusal === null ? nothing : html`<p data-floor-refusal role="status">${this.refusal}</p>`}
        ${this.#leaveHereOffer()}
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
        ${this.#seatDialog()} ${this.#waitingDialog("clear")} ${this.#waitingDialog("move")}
        ${this.#detailsSheet()} ${this.#seatsPrompt()} ${this.#splitJoined()} ${this.#resetTable()}
        ${this.#renameWindow()} ${this.#billChoice()} ${this.#joinWith()}
      </section>
    `;
  }

  /** `fitKey` and `tables` change in one update, so a new zone is fitted to its own tables. */
  #plannedMap(
    onMap: FloorMapTable[],
    unplaced: TableState[],
    activeKey: string | undefined,
  ): TemplateResult {
    return html`
      <div class="map">
        <wt-floor-map
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
        .reducedMotion=${this.reducedMotion}
        .locale=${currentLocale()}
        .labels=${{
          covers: t("floor.capacity"),
          toServe: t("floor.to_serve"),
          reserved: t("floor.reserved"),
          unsent: t("floor.unsent_mark"),
          fireDue: t("floor.fire_due"),
          forgotten: t("floor.forgotten"),
        }}
      ></wt-table-token>
    </button>`;
  }

  #tab(tab: ZoneTab, activeKey: string | undefined): TemplateResult {
    const active = tab.key === activeKey;
    return html`<wt-button
      class="tab"
      data-zone=${tab.key}
      variant=${active ? "primary" : "secondary"}
      @click=${() => this.#selectZone(tab.key)}
    >
      ${tab.name}
    </wt-button>`;
  }

  #prefersReducedMotion(): boolean {
    return this.reducedMotion ?? window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  #seatDialog(): TemplateResult | typeof nothing {
    const seating = this.seating;
    if (seating === null) return nothing;
    return html`<till-seat-dialog
      .tableLabel=${seating.heading}
      .named=${seating.named}
      @seat-confirm=${(event: Event) => this.#onSeatConfirm(event, seating)}
      @seat-cancel=${(event: Event) => {
        event.stopPropagation();
        this.seating = null;
      }}
    ></till-seat-dialog>`;
  }

  /** The question a table that needs clearing or moving asks when it is tapped. */
  #waitingDialog(kind: Waiting): TemplateResult | typeof nothing {
    const table = kind === "clear" ? this.clearing : this.moving;
    if (table === null) return nothing;
    const words = WAITING[kind];
    const clear = kind === "clear";
    const close = () => {
      if (clear) this.clearing = null;
      else this.moving = null;
    };
    return html`<wt-dialog
      ${trackDialog()}
      ?data-clear-dialog=${clear}
      ?data-move-dialog=${!clear}
      .open=${true}
      .heading=${tableSentence(table, words.title, words.titleNamed)}
      @wt-close=${close}
    >
      ${
        !clear && this.#actsOn(kind)
          ? helpBadge("help.floor.needs_moving", t("floor.needs_moving"), { slot: "help" })
          : nothing
      }
      <p>${t(words.body)}</p>
      <wt-button
        slot="footer"
        ?data-clear-cancel=${clear}
        ?data-move-cancel=${!clear}
        variant=${clear ? "secondary" : "ghost"}
        @click=${close}
      >
        ${t("action.cancel")}
      </wt-button>
      ${
        !clear && this.#actsOn(kind)
          ? html`<wt-button
              slot="footer"
              data-leave-here
              variant="secondary"
              @click=${() => this.#leaveHere(table)}
            >
              ${t("floor.leave_here")}
            </wt-button>`
          : nothing
      }
      ${
        this.#actsOn(kind)
          ? html`<wt-button
              slot="footer"
              ?data-mark-cleared=${clear}
              ?data-mark-moved=${!clear}
              variant="primary"
              @click=${() => this.#markWaiting(kind, table)}
            >
              ${t(words.action)}
            </wt-button>`
          : nothing
      }
    </wt-dialog>`;
  }

  /** A card is one button, so a table needing clearing or moving is a plain box instead. */
  #waitingCard(table: TableState, kind: Waiting): TemplateResult {
    const words = WAITING[kind];
    const clear = kind === "clear";
    const sending = this.sendingToday.get(table.id);
    return html`<div class="card state-${table.state} clearing" data-table=${table.id}>
      <span class="card-head">${this.#cardName(table)} ${this.#seats(table)}</span>
      <span class="occupancy" ?data-needs-clearing=${clear} ?data-needs-moving=${!clear}
        >${t(words.state)}</span
      >
      ${
        !clear && this.#actsOn(kind)
          ? html`<wt-button
              size="sm"
              variant="secondary"
              data-leave-here
              .loading=${sending === "leave-here"}
              .disabled=${sending !== undefined}
              @click=${() => this.#leaveHere(table)}
            >
              ${t("floor.leave_here")}
            </wt-button>`
          : nothing
      }
      ${
        this.#actsOn(kind)
          ? html`<wt-button
              size="sm"
              variant="secondary"
              ?data-mark-cleared=${clear}
              ?data-mark-moved=${!clear}
              .loading=${!clear && sending === "mark-moved"}
              .disabled=${!clear && sending !== undefined}
              @click=${() => this.#markWaiting(kind, table)}
            >
              ${t(words.action)}
            </wt-button>`
          : nothing
      }
    </div>`;
  }

  #actsOn(kind: Waiting): boolean {
    return kind === "clear" || this.canChangeToday;
  }

  #markWaiting(kind: Waiting, table: TableState): void {
    if (kind === "clear") this.#markCleared(table);
    else this.#markMoved(table);
  }

  /** Today's name, with the saved name small after it when they differ. */
  #cardName(table: TableState): TemplateResult {
    const shown = shownUnder(table);
    return html`<span
      ><span class="label">${shown}</span>${
        shown === table.label
          ? nothing
          : html` <span class="saved-label" data-saved-label>${table.label}</span>`
      }</span
    >`;
  }

  #seats(table: TableState): TemplateResult | typeof nothing {
    const seats = seatsFor(table);
    return seats !== null
      ? html`<span class="capacity">${seats} ${t("floor.capacity")}</span>`
      : nothing;
  }

  #card(table: TableState): TemplateResult {
    if (needsClearing(table)) return this.#waitingCard(table, "clear");
    if (needsMovingToday(table)) return this.#waitingCard(table, "move");
    const states = tableStates(table, this.#drawnAt);
    const top = states[0];
    const ring = states.map((kind) => RING_OF[kind]).find((r) => r !== undefined) ?? null;
    const moving = !this.#prefersReducedMotion();
    const edge = top === "forgotten" && !moving ? " edge-forgotten" : "";
    const calm = top === "held" || top === "nothing-needed" ? " calm" : "";
    return html`<button
      class="card state-${table.state}${edge}${calm}"
      data-table=${table.id}
      data-top=${top ?? nothing}
      @click=${() => this.#openTable(table)}
    >
      ${renderFloorRing(ring, moving)}
      <span class="card-head">${this.#cardName(table)} ${this.#seats(table)}</span>
      ${this.#partyName(table)} ${this.#occupancy(table)}
      <span class="badges"
        >${byPrecedence(this.#marks(table, top), (mark) => mark.kind).map(({ mark }) => mark)}</span
      >
    </button>`;
  }

  #marks(table: TableState, top: TableStateKind | undefined): CardMark[] {
    const marks: CardMark[] = [];
    if (top === "nothing-needed") {
      marks.push({
        kind: "nothing-needed",
        mark: html`<span class="calm-line" data-nothing-needed
          ><wt-icon name="floor-check" size="sm"></wt-icon>${t("floor.nothing_needed")}</span
        >`,
      });
    }
    if (lateBand(table) === "forgotten") {
      marks.push({
        kind: "forgotten",
        mark: html`<span class="badge forgotten" data-forgotten
          ><wt-icon name="floor-timer" size="sm"></wt-icon>${t("floor.forgotten")}</span
        >`,
      });
    }
    if (this.#fireDue(table)) {
      marks.push({
        kind: "fire",
        mark: html`<span class="badge fire-due" data-fire-due
          ><wt-icon name="floor-fire" size="sm"></wt-icon>${t("floor.fire_due")}</span
        >`,
      });
    }
    const hint = this.#hint(table);
    if (hint !== null) marks.push(hint);
    for (const draft of table.party?.unsentDrafts ?? []) {
      marks.push({
        kind: "not-sent",
        mark: html`<span class="badge unsent" data-unsent
          ><wt-icon name="floor-unsent" size="sm"></wt-icon>${unsentText(draft)}</span
        >`,
      });
    }
    if (table.nextReservation !== null) {
      marks.push({
        kind: "reserved",
        mark: html`<span class="badge reserved" data-reserved
          >${t("floor.reserved")} ${table.nextReservation.time}</span
        >`,
      });
    }
    for (const chip of tableChips(table, this.#drawnAt)) {
      marks.push({ kind: chipState(chip, table.signals), mark: renderFloorChips([chip])[0]! });
    }
    return marks;
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
  #hint(table: TableState): CardMark | null {
    if (table.enRoute > 0) {
      return {
        kind: "ready",
        mark: html`<span class="badge en-route" data-en-route
          >${table.enRoute} ${t("floor.en_route")}</span
        >`,
      };
    }
    if (table.readyToServe > 0) {
      if (signalOf(table.signals, "ready") !== undefined) return null;
      return {
        kind: "ready",
        mark: html`<span class="badge ready" data-ready
          >${table.readyToServe} ${t("floor.ready")}</span
        >`,
      };
    }
    if (table.pendingToServe > 0) {
      return {
        kind: undefined,
        mark: html`<span class="badge to-serve" data-to-serve
          >${table.pendingToServe} ${t("floor.to_serve")}</span
        >`,
      };
    }
    return null;
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
