import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { t } from "../i18n/t.js";
import { descriptionFor, trimQuantity } from "./dish-format.js";
import type {
  StationQueueCourse,
  StationQueueGroup,
  StationQueueItem,
  TicketState,
} from "../api/client.js";

/** The kitchen state each ticket item advances TO next. `ready` is terminal (a counter order's handover
 *  is an order-level collect, not a kitchen state — KDS-1 §2d), so a `ready` line has no bump. */
const NEXT: Record<TicketState, Exclude<TicketState, "queued"> | undefined> = {
  queued: "preparing",
  preparing: "ready",
  ready: undefined,
};

/** The three kitchen states in flow order — the kanban columns (Nuevo / Preparando / Listo), left to
 *  right, and the order a `ready`-tail line sorts after a fresh one. */
const COLUMNS: readonly TicketState[] = ["queued", "preparing", "ready"];

/** How the two views bump: `line` (the source of truth) advances the one tapped item; `ticket` (the
 *  convenience the `bump_mode = 'ticket'` venue setting drives) advances the whole order at the station. */
export type BumpMode = "line" | "ticket";

/** Which surface owns the per-course fire action (KDS-2/3 §2c, `locations.fire_control`): `kitchen` (the
 *  station display shows "Empezar curso" on a held course), `waiter` (the tab screen does — so this widget
 *  shows no fire affordance) or `expo` (KDS-3 — the expo/pass display owns it, so again not this widget).
 *  Threaded from the app via the boot payload. */
export type FireControlMode = "waiter" | "kitchen" | "expo";

/** A line paired with the order it belongs to — what a kanban column renders (its cells cut across
 *  orders, so each carries back its order's number + queued-time for the label and the age accent). */
interface FlatItem {
  item: StationQueueItem;
  group: StationQueueGroup;
}

/** One coursing subsection of an order's rail card (KDS-2 §5a): a course (or `null` for the courseless,
 *  auto-fired earliest lines) with its lines and whether the whole course is still HELD (every line
 *  unfired). Held ⇒ greyed lines + the kitchen-fire affordance; a null course is never held (its lines
 *  auto-fire), so it never offers fire. */
interface CourseSection {
  course: StationQueueCourse | null;
  items: StationQueueItem[];
  held: boolean;
}

/** A course's ordering key: the null (courseless) group sorts FIRST — it is the auto-fired earliest set —
 *  then named courses by `displayOrder` ascending, matching the server's coursing sequence. */
function courseOrder(course: StationQueueCourse | null): number {
  return course === null ? Number.NEGATIVE_INFINITY : course.displayOrder;
}

/**
 * The per-station KITCHEN QUEUE (KDS-1, design §5a): one station's ticket items grouped by order, shown
 * through one of two lenses — a **kanban board** (Nuevo / Preparando / Listo columns, the default) or a
 * **ticket rail** (a card per order). Both render the SAME data; the parent flips {@link view}.
 *
 * It is the per-line/per-station successor to #63's whole-order prep-queue widget. Like that widget (and
 * `till-held-orders`) it is a PURE VIEW: it holds no state, never talks to the store or the API, and the
 * container it sits in (the station screen, or — for the default station — the app) owns the {@link groups}
 * and refreshes them. A tap on a line emits a composed, bubbling advance the container turns into an API
 * call, exactly the event → container → server shape the prep-queue widget established (only the events and
 * the entry shape changed): {@link BumpMode} `line` (the default) fires `advance-ticket-item { itemId, to }`
 * — the per-line source of truth — while `ticket` fires `advance-ticket { orderId, stationId, to }`, the
 * whole-order convenience (so ticket mode needs {@link stationId}). A `ready` line is terminal and renders
 * inert (no button), like the prep-queue's collected row.
 *
 * AGE. Each order is coloured by how long its OLDEST line has waited ({@link StationQueueGroup.queuedAt}):
 * fresh (< 5 min), warm (< 10), hot (≥ 10). The accent is a LEFT BORDER, never a text background, so the
 * arbitrary colour cannot fail a11y contrast (the `till-floor-screen` occupancy-accent trick). `now` is an
 * injectable clock so the buckets are deterministic under test.
 *
 * Lit + `@waitron/ui` `baseStyles` + theme tokens only — no hardcoded chrome colour/spacing, so it follows
 * the operator's theme like every sibling. Copy is the till's i18n (`station.*`); identifiers stay English.
 */
@customElement("till-station-queue")
export class TillStationQueue extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }

      .empty {
        margin: 0;
        padding: var(--wt-space-4);
        color: var(--wt-color-text-muted);
        text-align: center;
      }

      /* KANBAN — three state columns that flow to fill the width and wrap on a narrow till. */
      .kanban {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr));
        gap: var(--wt-space-3);
      }

      .column {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        min-width: 0;
      }

      .column-title {
        margin: 0 0 var(--wt-space-1);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-text-muted);
        text-transform: uppercase;
      }

      /* RAIL — a card per order, wrapping across rows. */
      .rail {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-3);
        align-items: flex-start;
      }

      .ticket {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        min-width: 12rem;
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        /* The age accent lives on the left edge (coloured by bucket below), never behind text. */
        border-left: var(--wt-space-1) solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
      }

      .ticket-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--wt-space-2);
      }

      .number {
        font-weight: var(--wt-font-weight-bold);
      }

      .label {
        color: var(--wt-color-text);
      }

      .age {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .lines {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        margin: 0;
        padding: 0;
        list-style: none;
      }

      /* A line cell — the tappable bump target (a plain button so it themes like the floor cards). A
         ready-tail cell renders the same box as a non-interactive span (.line.terminal). */
      .line {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-left: var(--wt-space-1) solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
        text-align: left;
      }

      button.line {
        cursor: pointer;
      }

      .line.state-queued {
        border-left-color: var(--wt-color-text-muted);
      }

      .line.state-preparing {
        border-left-color: var(--wt-color-primary);
      }

      .line.state-ready {
        border-left-color: var(--wt-color-success);
      }

      /* A HELD line (its course not yet fired, KDS-2 §5a) — greyed and non-advanceable. Greying is a
         MUTED text colour (the token every secondary label uses, so it keeps a11y contrast on the
         surface) plus a dashed box, NOT reduced opacity (which would composite the text against the
         background and fail the color-contrast sweep). It renders as an inert span, so there is no bump. */
      .line.held {
        border-style: dashed;
        border-left-style: solid;
        color: var(--wt-color-text-muted);
      }

      /* The dish label (qty × name) — the primary text a cook reads. Truncates rather than wrapping so
         a long name never blows out the cell/line width (min-width:0 lets a flex child shrink). */
      .line-name {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .line-state {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      /* Age accents on the rail card's left edge — a data-driven colour, never behind text (a11y). */
      .ticket.age-warm {
        border-left-color: var(--wt-color-primary);
      }

      .ticket.age-hot {
        border-left-color: var(--wt-color-danger);
      }

      /* A course subsection within a rail card (KDS-2 §5a) — its held/fired lines under a course header,
         with the held course's fire button at its foot. Just vertical rhythm; the lines carry the visual. */
      .course {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
      }

      /* The course header — the coursing section's name ("Entrantes"). A muted, uppercased label like the
         kanban column titles; the null (auto-fired earliest) course has no header at all. */
      .course-head {
        margin: var(--wt-space-1) 0 0;
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-text-muted);
        text-transform: uppercase;
      }

      /* The per-order Mode-P handover action (.collect) and the per-course kitchen-fire action (.fire,
         KDS-2 §5a) — full-width primary buttons at the foot of a rail card / course section. The
         wt-color-primary on wt-color-on-primary pairing is the SAME a11y-correct one wt-button's primary
         variant uses, so contrast holds in both themes. */
      .collect,
      .fire {
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-primary);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-primary);
        color: var(--wt-color-on-primary);
        font: inherit;
        font-weight: var(--wt-font-weight-bold);
        cursor: pointer;
      }

      /* The per-order REPRINT action (KDS-4 §3d) — a full-width SECONDARY wt-button at the card foot,
         under the primary collect handover. wt-button hosts as inline-block; display:block lets it span
         the card width like the collect/fire buttons above. Secondary (not primary) because reprint is a
         recover-from-a-jam utility, not a workflow step — its own a11y-correct colour pairing lives inside
         wt-button, so no chrome is hardcoded here. */
      wt-button.reprint {
        display: block;
      }
    `,
  ];

  /** One station's ticket items grouped by order, oldest first (the container owns + refreshes them). */
  @property({ attribute: false }) groups: StationQueueGroup[] = [];
  /** The lens: `kanban` board (default) or `ticket` rail — flipped by the station screen's toggle. */
  @property() view: "kanban" | "rail" = "kanban";
  /** Per-line (default) vs whole-ticket bump — the `bump_mode` venue setting, threaded from the app. */
  @property() bumpMode: BumpMode = "line";
  /** The station these items are AT — required for the whole-ticket bump's event (ticket mode). */
  @property() stationId?: string;
  /** Whether THIS display owns the per-course fire action (KDS-2 §5a) — `kitchen` shows "Empezar curso"
   * on a held course's rail section; `waiter` (the default) shows none (the tab screen fires, Task 7). */
  @property() fireControl: FireControlMode = "waiter";
  /**
   * ADVANCE-ONLY (device-identity-1 §5a). When `true` the widget renders NEITHER the Mode-P collect
   * handover NOR the kitchen-fire button — an enrolled DEVICE display has an advance-only surface (spec
   * §3d: the device routes are the per-line advance alone; there is no device collect/fire route, so
   * those buttons would only 401 → silently no-op). Default `false` keeps the operator display unchanged
   * (it owns a session and both verbs). Advancing itself, and the held-line greying, are unaffected.
   */
  @property({ type: Boolean }) advanceOnly = false;
  /**
   * Whether to offer the per-order REPRINT action (KDS-4 §3d) on each rail card. Default `false` — the
   * counter's default-station widget (`till-app`) and the counter screen embed this widget WITHOUT a
   * reprint affordance, so it must be opt-in and off for them. Only the station-display screen turns it on,
   * and only in OPERATOR mode (`!deviceMode`): the reprint route is session-guarded, so an enrolled device
   * display holds no session for it (there is no device reprint route — the R-K ruling). A per-order
   * `reprint-order { orderId }` event the container turns into a `reprintOrder` call, the same
   * event → container → server shape a bump/collect/fire uses. Rail-only, like collect: kanban columns cut
   * across orders, so a per-order action has no home there.
   */
  @property({ type: Boolean }) showReprint = false;
  /** Injectable clock for age colouring; defaults to the wall clock. Set in tests for deterministic buckets. */
  @property({ attribute: false }) now?: number;

  /** Advance the tapped line — per-line in `line` mode (the truth), whole-ticket in `ticket` mode (the
   * convenience). A terminal (`ready`) line has no successor, so this is a no-op for it; ticket mode with
   * no {@link stationId} likewise no-ops (the whole-ticket route is keyed by station). */
  #bump(group: StationQueueGroup, item: StationQueueItem): void {
    const to = NEXT[item.state];
    if (to === undefined) return;
    if (this.bumpMode === "ticket") {
      if (this.stationId === undefined) return;
      this.dispatchEvent(
        new CustomEvent("advance-ticket", {
          detail: { orderId: group.orderId, stationId: this.stationId, to },
          bubbles: true,
          composed: true,
        }),
      );
    } else {
      this.dispatchEvent(
        new CustomEvent("advance-ticket-item", {
          detail: { itemId: item.id, to },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  /** Hand a collectable order to the customer — the Mode-P counter handover (KDS-1 §3e). Emits a
   * composed, bubbling `mark-collected { orderId }` the container (the app, or the station screen)
   * turns into a `markCollected` call, the same event → container → server shape a bump uses. Order-level
   * (not per-line): `collected_at` is on the order, so it is one action for the whole card. */
  #collect(group: StationQueueGroup): void {
    this.dispatchEvent(
      new CustomEvent("mark-collected", {
        detail: { orderId: group.orderId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Fire a HELD course of an order (KDS-2 §5a) — the kitchen's "release this course" tap in
   * `fire_control = 'kitchen'` mode. Emits a composed, bubbling `fire-course { orderId, courseId }` the
   * container turns into a `fireCourse` call, the same event → container → server shape a bump/collect
   * uses. Per-order/per-course (the route is `/api/orders/:id/courses/:courseId/fire`), so both ids ride. */
  #fire(group: StationQueueGroup, course: StationQueueCourse): void {
    this.dispatchEvent(
      new CustomEvent("fire-course", {
        detail: { orderId: group.orderId, courseId: course.id },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Reprint an order's current kitchen tickets (KDS-4 §3d) — the "a jam ate the paper, print it again"
   * tap on a rail card. Emits a composed, bubbling `reprint-order { orderId }` the container (the station
   * screen) turns into a `reprintOrder` call, the same event → container → server shape a bump/collect/fire
   * uses. Order-level (the route is `/api/orders/:id/reprint`), so only the order id rides. */
  #reprint(group: StationQueueGroup): void {
    this.dispatchEvent(
      new CustomEvent("reprint-order", {
        detail: { orderId: group.orderId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Group one order's lines into coursing subsections (KDS-2 §5a): keyed by course id (the null course
   * its own key), each carrying whether the whole course is still HELD. Sorted null-course-first then by
   * `displayOrder`, so the sections render in the kitchen's coursing sequence. Item order WITHIN a course
   * is preserved (the server already ordered by `queued_at, line_no`). A missing/undefined course is
   * treated as the null course, so an older/partial payload still groups cleanly. */
  #courseSections(group: StationQueueGroup): CourseSection[] {
    const byCourse = new Map<string | null, CourseSection>();
    for (const item of group.items) {
      const course = item.course ?? null;
      const key = course?.id ?? null;
      let section = byCourse.get(key);
      if (section === undefined) {
        section = { course, items: [], held: true };
        byCourse.set(key, section);
      }
      section.items.push(item);
      // A course is HELD only while EVERY line is unfired; one fired line means it is on.
      if (item.firedAt !== null) section.held = false;
    }
    return [...byCourse.values()].sort((a, b) => courseOrder(a.course) - courseOrder(b.course));
  }

  /** The age bucket for a group's oldest line: fresh (< 5 min), warm (< 10), hot (≥ 10). */
  #ageBucket(queuedAt: string): "fresh" | "warm" | "hot" {
    const elapsedMin = ((this.now ?? Date.now()) - Date.parse(queuedAt)) / 60000;
    if (elapsedMin >= 10) return "hot";
    if (elapsedMin >= 5) return "warm";
    return "fresh";
  }

  /** Whole minutes a group has waited (never negative), for the "N min" age label. */
  #elapsedMinutes(queuedAt: string): number {
    return Math.max(0, Math.floor(((this.now ?? Date.now()) - Date.parse(queuedAt)) / 60000));
  }

  override render() {
    if (this.groups.length === 0) {
      return html`<p class="empty">${t("station.empty")}</p>`;
    }
    return this.view === "rail" ? this.#rail() : this.#kanban();
  }

  /** RAIL — a card per order, its lines GROUPED BY COURSE (KDS-2 §5a) with per-line bump on fired lines. */
  #rail(): TemplateResult {
    return html`<div class="rail">
      ${this.groups.map((group) => {
        const bucket = this.#ageBucket(group.queuedAt);
        return html`<article class="ticket age-${bucket}" data-order=${group.orderNumber}>
          <div class="ticket-head">
            <span class="number">#${group.orderNumber}</span>
            ${group.label ? html`<span class="label">${group.label}</span>` : nothing}
            <span class="age">${this.#elapsedMinutes(group.queuedAt)} ${t("station.min")}</span>
          </div>
          ${this.#courseSections(group).map((section) => this.#courseSection(group, section))}
          ${this.#collectAction(group)} ${this.#reprintAction(group)}
        </article>`;
      })}
    </div>`;
  }

  /** One coursing subsection of a rail card (KDS-2 §5a): its named course's header (the null course has
   *  none), its lines, and — for a HELD course under `fire_control = 'kitchen'` — the fire button. */
  #courseSection(group: StationQueueGroup, section: CourseSection): TemplateResult {
    return html`<div class="course" data-course=${section.course?.id ?? "none"}>
      ${section.course ? html`<div class="course-head">${section.course.name}</div>` : nothing}
      <ul class="lines">
        ${section.items.map((item) => html`<li>${this.#line(group, item)}</li>`)}
      </ul>
      ${this.#fireAction(group, section)}
    </div>`;
  }

  /** The per-course kitchen-fire button, shown only when THIS display owns the fire
   *  (`fire_control = 'kitchen'`) AND the course is a NAMED course still fully HELD — the null (auto-fired)
   *  course and any already-fired course have nothing to release, so they offer none. Emits `fire-course`
   *  (via {@link #fire}); the label names the course for an accessible control. Under `waiter` the tab
   *  screen owns the fire (Task 7), so this renders nothing here. */
  #fireAction(group: StationQueueGroup, section: CourseSection): TemplateResult | typeof nothing {
    // Advance-only device display: no device fire route (§3d), so never offer the fire button.
    if (this.advanceOnly) return nothing;
    if (this.fireControl !== "kitchen" || section.course === null || !section.held) return nothing;
    const course = section.course;
    return html`<button
      class="fire"
      data-fire=${course.id}
      aria-label=${`${t("station.fire_course")} ${course.name}`}
      @click=${() => this.#fire(group, course)}
    >
      ${t("station.fire_course")}
    </button>`;
  }

  /** The per-order collect button, shown only for a COLLECTABLE order — a `settled` Mode-P pickup awaiting
   * its counter handover (every order on the queue is already non-abandoned and uncollected; the server
   * filters both, so `settled` is the whole collectability test). An `open` (tab) or `placed` (awaiting the
   * fiscal collect) order renders none. The label names the order for an accessible control. */
  #collectAction(group: StationQueueGroup): TemplateResult | typeof nothing {
    // Advance-only device display: no device collect route (§3d), so never offer the handover button.
    if (this.advanceOnly) return nothing;
    if (group.status !== "settled") return nothing;
    return html`<button
      class="collect"
      data-collect=${group.orderId}
      aria-label=${`${t("station.collect")} #${group.orderNumber}`}
      @click=${() => this.#collect(group)}
    >
      ${t("station.collect")}
    </button>`;
  }

  /** The per-order reprint button (KDS-4 §3d), shown only when {@link showReprint} is on (the station
   * display's OPERATOR mode — the R-K guard). A full-width secondary `wt-button` at the card foot, under
   * the collect handover. Its accessible name is the slotted "Reprint" text (like every other wt-button in
   * the till): `aria-label` on a `wt-button` host is a11y-prohibited (the host carries no role — the inner
   * `<button>` does), so the card heading (#N) supplies the order context, not the button name. Emits
   * `reprint-order` (via {@link #reprint}). */
  #reprintAction(group: StationQueueGroup): TemplateResult | typeof nothing {
    if (!this.showReprint) return nothing;
    return html`<wt-button
      class="reprint"
      data-reprint=${group.orderId}
      variant="secondary"
      @click=${() => this.#reprint(group)}
    >
      ${t("station.reprint")}
    </wt-button>`;
  }

  /** KANBAN — three state columns, each holding every order's lines in that state, oldest order first. */
  #kanban(): TemplateResult {
    // Flatten to (item, group) pairs once, preserving the groups' oldest-first order, then bucket by state.
    const flat: FlatItem[] = this.groups.flatMap((group) =>
      group.items.map((item) => ({ item, group })),
    );
    return html`<div class="kanban">
      ${COLUMNS.map((state) => {
        const cells = flat.filter((f) => f.item.state === state);
        return html`<section class="column column-${state}" data-column=${state}>
          <h2 class="column-title">${t(`station.state.${state}` as const)}</h2>
          ${cells.map(({ group, item }) => this.#cell(group, item))}
        </section>`;
      })}
    </div>`;
  }

  /** A rail line: the dish (`qty× name`) + its localised state, tappable to bump unless terminal
   *  (`ready`). The card head already names the order, so a line needs only its dish + state. */
  #line(group: StationQueueGroup, item: StationQueueItem): TemplateResult {
    const state = html`<span class="line-state"
      >${t(`station.state.${item.state}` as const)}</span
    >`;
    return this.#renderLine(group, item, state);
  }

  /** A kanban cell: the dish (`qty× name`) tagged with its order — the columns cut across orders, so a
   *  cell keeps the order number (which order this dish belongs to) beside the dish. Tappable to bump
   *  unless terminal (`ready`). */
  #cell(group: StationQueueGroup, item: StationQueueItem): TemplateResult {
    const tag = html`<span class="number"
      >#${group.orderNumber}${group.label ? html` · ${group.label}` : nothing}</span
    >`;
    return this.#renderLine(group, item, tag);
  }

  /** The shared line box both lenses render: the dish label followed by a `secondary` element (the
   *  rail's state text or the kanban's order tag). A line is a NON-INTERACTIVE span — never a bump button
   *  — when it is HELD (its course unfired, KDS-2 §5a: greyed + non-advanceable, carrying `.held`) or
   *  TERMINAL (`ready`, no successor). Any other line is the tappable bump button, with the SAME
   *  class/aria-label/@click wiring across both views, so the two lenses stay a single source of truth. */
  #renderLine(
    group: StationQueueGroup,
    item: StationQueueItem,
    secondary: TemplateResult,
  ): TemplateResult {
    const dish = html`<span class="line-name">${this.#dish(item)}</span>`;
    const held = item.firedAt === null;
    if (held || NEXT[item.state] === undefined) {
      const modifier = held ? "held" : "terminal";
      return html`<span class="line state-${item.state} ${modifier}" data-item=${item.id}
        >${dish}${secondary}</span
      >`;
    }
    return html`<button
      class="line state-${item.state}"
      data-item=${item.id}
      aria-label=${this.#bumpLabel(group)}
      @click=${() => this.#bump(group, item)}
    >
      ${dish}${secondary}
    </button>`;
  }

  /** The line's dish label for the kitchen display: `qty× name`, e.g. "2× Paella". The name resolves in
   *  the operator locale with a first-available fallback ({@link descriptionFor}, degrading to "" for an
   *  empty map — the till's set-at-boot `currentLocale()` is `TillInfo.locale`); the quantity is the
   *  line's numeric(_,3) trimmed of trailing zeros ({@link trimQuantity}, shared with the table screen). */
  #dish(item: StationQueueItem): string {
    return `${trimQuantity(item.quantity)}× ${descriptionFor(item.descriptions, "")}`;
  }

  /** The accessible name for a bump control — whole-ticket vs per-line, named with the order number. */
  #bumpLabel(group: StationQueueGroup): string {
    const verb = this.bumpMode === "ticket" ? t("station.bump_ticket") : t("station.advance");
    return `${verb} #${group.orderNumber}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-station-queue": TillStationQueue;
  }
}
