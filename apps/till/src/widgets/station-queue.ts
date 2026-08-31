import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { TickingClock, baseStyles } from "@waitron/ui";
import { BAND_RANK, type TimingBand, classifyBand } from "@waitron/shared";
import { currentLocale, t } from "../i18n/t.js";
import { allergenName } from "../i18n/allergen-names.js";
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
 * AGE (KDS order-timing alerts, design §3/§7.1). Each order is banded by how long its OLDEST line has
 * waited ({@link StationQueueGroup.queuedAt}) against ITS STATION's own thresholds
 * ({@link StationQueueGroup.thresholds}), via the shared `classifyBand` (`@waitron/shared`): fresh → warm
 * → overdue → **forgotten**. The accent is a LEFT BORDER, never a text background, so the arbitrary
 * colour cannot fail a11y contrast (the `till-floor-screen` occupancy-accent trick) — applied to the
 * rail's `.ticket` card AND, nested outside the kitchen-state border, the kanban's per-cell wrapper. A
 * `forgotten` band additionally FLASHES the border unless the OS/browser has asked for reduced motion
 * (`prefers-reduced-motion`, checked live or injected via {@link reducedMotion}), in which case it
 * renders the same steady red instead — never colour/motion as the only signal, and the header's
 * {@link #overdueCount} count badge is the non-colour tell for the whole station. A `TickingClock`
 * ({@link #clock}) advances the display while it sits idle, between the container's own refreshes; `now`
 * is still directly injectable so a test controls the band deterministically.
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
         ready-tail cell renders the same box as a non-interactive span (.line.terminal). Column layout so
         the dish row (.line-main) can carry an indented modifiers list beneath it (ordering modifiers,
         Task 14); a modifier-free item has none, so it renders exactly as the single-row box did before. */
      .line {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: var(--wt-space-1);
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

      /* The dish row: qty× name (left) and the lens-specific secondary element (right) — the SAME row
         .line rendered as its whole content before Task 14 added the modifiers list beneath it. */
      .line-main {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-2);
        width: 100%;
      }

      /* The dish's selected options (ordering modifiers, Task 14), indented beneath it — matching the
         kitchen-print ticket's own "+ name" sub-text style (apps/server/src/kitchen-ticket.ts). Muted
         text, never a tap target of its own (removing an option removes the whole dish). */
      .line-modifiers {
        display: flex;
        flex-direction: column;
        gap: 0;
        padding-left: var(--wt-space-3);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      /* The dish's AS-SERVED allergen profile (modifier↔allergen, Task 9), indented beneath the dish +
         modifiers: localised "contains" chips, struck localised "NO <allergen name>" removal callouts
         (e.g. "NO Cereals containing gluten" / "SIN Leche"), and a pending note. A flex-wrap row
         (chips + callouts flow), the same indent as the modifiers list. */
      .line-allergens {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-1) var(--wt-space-2);
        padding-left: var(--wt-space-3);
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }

      .allergen-label {
        font-weight: var(--wt-font-weight-bold);
      }

      .allergen-chip {
        display: inline-block;
        padding: 0 var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-full, 999px);
      }

      /* A REMOVED base allergen — a struck "NO <allergen>" callout (e.g. "SIN Leche"). Colour is NEVER
         the only signal: the "NO"/"SIN" text AND the strike-through both mark it, so it reads on a
         monochrome display and passes the contrast sweep (danger-as-text on the surface, the same
         pairing the expo forgotten-flag ships). The allergen is localised via allergenName, exactly
         like the chips — never a raw English code beside a localised chip on a Spanish kitchen surface. */
      .allergen-removed {
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-danger);
        text-decoration: line-through;
      }

      /* The pending note earns emphasis — a cook must NOT read an unreviewed dish as allergen-free (the
         Cautious policy). Text weight is the non-colour tell beside the colour (house a11y rule). */
      .allergen-pending {
        color: var(--wt-color-warning-text, var(--wt-color-text));
        font-weight: var(--wt-font-weight-bold);
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

      /* Age accents on the rail card's left edge — a data-driven colour, never behind text (a11y).
         Three escalating bands (KDS order-timing alerts, design §7.1): warm (amber-ish primary),
         overdue (red), forgotten (red + a repeating flash, .flash below). 'fresh' gets no override —
         it keeps the base .ticket border colour. */
      .ticket.age-warm {
        border-left-color: var(--wt-color-primary);
      }

      .ticket.age-overdue,
      .ticket.age-forgotten {
        border-left-color: var(--wt-color-danger);
      }

      /* KANBAN age accent — the cell wrapper's OWN left border, nested outside the inner .line's
         kitchen-STATE border (queued/preparing/ready) so the two colours never overwrite each other —
         the same outer/inner nesting the rail's .ticket/.line pair already uses. */
      .cell {
        border-left: var(--wt-space-1) solid var(--wt-color-border);
        min-width: 0;
      }

      .cell.age-warm {
        border-left-color: var(--wt-color-primary);
      }

      .cell.age-overdue,
      .cell.age-forgotten {
        border-left-color: var(--wt-color-danger);
      }

      /* The FORGOTTEN flash (design §7.1/§2): a repeating fade of the left border, never a colour/motion
         change behind text — .flash is applied only when the OS/browser has NOT asked for reduced
         motion (#prefersReducedMotion), so an assistive-motion setting renders the steady red border
         above with no @keyframes at all. The @media guard is a second, CSS-only line of defence for
         the same preference (belt-and-suspenders, house a11y rule). */
      .ticket.age-forgotten.flash,
      .cell.age-forgotten.flash {
        animation: age-forgotten-flash 1s ease-in-out infinite;
      }

      @keyframes age-forgotten-flash {
        50% {
          border-left-color: transparent;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .ticket.age-forgotten.flash,
        .cell.age-forgotten.flash {
          animation: none;
        }
      }

      /* The header's overdue+forgotten count badge (design §7.1) — a non-colour tell ("3 overdue") so
         the escalation is legible without relying on the border colour alone (a11y). */
      .overdue-count {
        margin: 0 0 var(--wt-space-2);
        padding: var(--wt-space-1) var(--wt-space-3);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-danger);
        color: var(--wt-color-on-danger);
        font-weight: var(--wt-font-weight-bold);
        display: inline-block;
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
  /** Injectable clock for age colouring; falls back to the {@link #clock}'s ticked time (never a bare
   *  `Date.now()`, so a re-render from the tick and a re-render from a fresh fetch use the SAME clock
   *  source) when unset. Set in tests for deterministic bands. */
  @property({ attribute: false }) now?: number;
  /**
   * Whether to render the FORGOTTEN band's flash as a steady accent instead (house a11y rule — never
   * colour/motion as the only signal, and the flash must honour `prefers-reduced-motion`). `undefined`
   * (the default) checks the live media query on every render; a test injects `true`/`false` for a
   * deterministic assertion, the same injectable-override shape {@link now} already uses.
   */
  @property({ attribute: false }) reducedMotion?: boolean;

  /** Drives the display forward while it sits idle — no refetch, just the client-side re-tick the
   *  order-timing design calls for (§5.2): every ~20s it bumps {@link TickingClock.now} and requests a
   *  re-render, so a ticket can climb fresh → warm → overdue → forgotten between the container's own
   *  refreshes. {@link now}, when set, always wins (tests stay deterministic). */
  readonly #clock = new TickingClock(this);

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

  /** The current clock reading for age classification: {@link now} when injected (deterministic
   *  tests), else the {@link #clock}'s own ticked time — never a fresh `Date.now()` call, so every
   *  render in one tick sees the identical `now` and the display genuinely advances only when the
   *  clock ticks (or a test moves {@link now}). */
  #clockNow(): number {
    return this.now ?? this.#clock.now;
  }

  /** The escalation band for a group's oldest line, against its OWN station's thresholds
   *  (`classifyBand`, `@waitron/shared`) — fresh / warm / overdue / forgotten (KDS order-timing
   *  alerts, design §3). Replaces the old hardcoded 5/10-minute two-band `#ageBucket`. */
  #band(group: StationQueueGroup): TimingBand {
    return classifyBand(Date.parse(group.queuedAt), this.#clockNow(), group.thresholds);
  }

  /** Whole minutes a group has waited (never negative), for the "N min" age label. */
  #elapsedMinutes(queuedAt: string): number {
    return Math.max(0, Math.floor((this.#clockNow() - Date.parse(queuedAt)) / 60000));
  }

  /** Whether the flash animation should be suppressed in favour of a steady accent — the live
   *  `prefers-reduced-motion` media query unless {@link reducedMotion} is injected (house a11y rule:
   *  motion must respect the OS preference; the ticking of bands themselves is unaffected). */
  #prefersReducedMotion(): boolean {
    return this.reducedMotion ?? window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /** The age-accent class list for a band: always `age-${band}`, plus `flash` for `forgotten` unless
   *  motion is reduced — the CSS `.age-forgotten.flash` rule carries the `@keyframes`, so a reduced-
   *  motion render never gets the class an animation is defined against (belt-and-suspenders with the
   *  `@media` guard in the stylesheet, which also disables it if this check is ever bypassed). */
  #accentClasses(band: TimingBand): string {
    const flash = band === "forgotten" && !this.#prefersReducedMotion();
    return `age-${band}${flash ? " flash" : ""}`;
  }

  /** Count of groups whose band has escalated to at least `overdue` (overdue OR forgotten,
   *  `BAND_RANK`) — the header's non-colour tell (design §7.1): a cook who cannot distinguish the
   *  border colours still sees a number. */
  #overdueCount(): number {
    return this.groups.filter((group) => BAND_RANK[this.#band(group)] >= BAND_RANK.overdue).length;
  }

  /** The queue header: the overdue+forgotten count badge, shown only when the count is non-zero (a
   *  station running entirely fresh/warm shows no badge at all, rather than a noisy "0 overdue"). */
  #header(): TemplateResult | typeof nothing {
    const count = this.#overdueCount();
    if (count === 0) return nothing;
    return html`<p class="overdue-count">${count} ${t("station.overdue_count")}</p>`;
  }

  override render() {
    if (this.groups.length === 0) {
      return html`<p class="empty">${t("station.empty")}</p>`;
    }
    return html`${this.#header()}${this.view === "rail" ? this.#rail() : this.#kanban()}`;
  }

  /** RAIL — a card per order, its lines GROUPED BY COURSE (KDS-2 §5a) with per-line bump on fired lines. */
  #rail(): TemplateResult {
    return html`<div class="rail">
      ${this.groups.map((group) => {
        const band = this.#band(group);
        return html`<article
          class="ticket ${this.#accentClasses(band)}"
          data-order=${group.orderNumber}
        >
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
   * the collect handover. Its accessible name is the slotted "Reprint" text; that suffices here (a
   * "Reprint" button is self-explanatory and the order context comes from the card heading, #N), so no
   * `aria-label` is added and no differentiated per-order name is needed — the light/dark axe sweeps pass
   * with the button present. Emits `reprint-order` (via {@link #reprint}). */
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
          ${cells.map(({ group, item }) => this.#kanbanCell(group, item))}
        </section>`;
      })}
    </div>`;
  }

  /** A kanban cell wrapped in its order's age accent (KDS order-timing alerts, design §7.1 — the
   *  kanban lens carried no age colour before this; today only the rail's `.ticket` did). The accent
   *  is the WRAPPER's own left border, nested outside the inner `.line`'s kitchen-STATE border — the
   *  same outer/inner nesting the rail's `.ticket`/`.line` pair already uses — so the age colour never
   *  overwrites the queued/preparing/ready colour the cell itself carries. */
  #kanbanCell(group: StationQueueGroup, item: StationQueueItem): TemplateResult {
    const band = this.#band(group);
    return html`<div class="cell ${this.#accentClasses(band)}">${this.#cell(group, item)}</div>`;
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
   *  rail's state text or the kanban's order tag), plus the dish's selected options as indented `+ name`
   *  sub-text beneath (ordering modifiers, Task 14) — empty for a plain dish, so nothing renders there. A
   *  line is a NON-INTERACTIVE span — never a bump button — when it is HELD (its course unfired, KDS-2
   *  §5a: greyed + non-advanceable, carrying `.held`) or TERMINAL (`ready`, no successor). Any other line
   *  is the tappable bump button, with the SAME class/aria-label/@click wiring across both views, so the
   *  two lenses stay a single source of truth. */
  #renderLine(
    group: StationQueueGroup,
    item: StationQueueItem,
    secondary: TemplateResult,
  ): TemplateResult {
    const main = html`<span class="line-main">
      <span class="line-name">${this.#dish(item)}</span>${secondary}
    </span>`;
    const modifiers = this.#modifiers(item);
    const allergens = this.#allergens(item);
    const held = item.firedAt === null;
    if (held || NEXT[item.state] === undefined) {
      const stateModifier = held ? "held" : "terminal";
      return html`<span class="line state-${item.state} ${stateModifier}" data-item=${item.id}
        >${main}${modifiers}${allergens}</span
      >`;
    }
    return html`<button
      class="line state-${item.state}"
      data-item=${item.id}
      aria-label=${this.#bumpLabel(group)}
      @click=${() => this.#bump(group, item)}
    >
      ${main}${modifiers}${allergens}
    </button>`;
  }

  /**
   * The dish's AS-SERVED allergen profile (modifier↔allergen, Task 9), indented beneath the dish + its
   * modifiers: the folded {@link StationQueueItem.asServed} codes as localised "contains" chips
   * (`allergenName`, never a hardcoded EU-14 list), each {@link StationQueueItem.removed} base code as a
   * struck **"NO &lt;allergen&gt;"** callout (a swap made the plate safe of it) — the allergen localised
   * the SAME way as the chips (`allergenName`), never a raw English code — and a "not reviewed" warning
   * whenever the fold is `pending` (the dish's own allergens unreviewed — the Cautious policy, since a
   * cook must never read an unverified plate as allergen-free). Colour is NEVER the only signal (house
   * a11y rule, the order-timing bands' convention): the removal carries its "NO" text + strike-through,
   * the chips their names, the warning its text/weight. `nothing` when there is nothing to say — no
   * profile attached, nothing removed, not pending — so a plain dish renders exactly as before this task.
   */
  #allergens(item: StationQueueItem): TemplateResult | typeof nothing {
    const asServed = item.asServed;
    const removed = item.removed ?? [];
    const codes = asServed ? Object.keys(asServed.allergens).sort() : [];
    const pending = asServed?.pending ?? false;
    if (codes.length === 0 && removed.length === 0 && !pending) return nothing;
    const locale = currentLocale();
    return html`<span class="line-allergens" data-item-allergens=${item.id}>
      ${
        codes.length > 0
          ? html`<span class="allergen-label">${t("allergens.contains")}</span> ${codes.map(
                (code) => html`<span class="allergen-chip">${allergenName(code, locale)}</span>`,
              )}`
          : nothing
      }
      ${[...removed]
        .sort()
        .map(
          (code) =>
            html`<span class="allergen-removed" data-removed=${code}
              >${t("allergens.without")} ${allergenName(code, locale)}</span
            >`,
        )}
      ${
        pending
          ? html`<span class="allergen-pending">${t("allergens.not_reviewed")}</span>`
          : nothing
      }
    </span>`;
  }

  /** The dish's selected options (ordering modifiers, Task 14) as indented `+ <name>` sub-text beneath
   *  the dish row — matching the kitchen-print ticket's own sub-text style
   *  (`apps/server/src/kitchen-ticket.ts`'s `formatKitchenTicket`). Each name resolves in the operator
   *  locale with the same first-available fallback the dish name uses. `nothing` for a plain dish (no
   *  `modifiers`, or an empty array), so a modifier-free item renders identically to before this task. */
  #modifiers(item: StationQueueItem): TemplateResult | typeof nothing {
    const modifiers = item.modifiers ?? [];
    if (modifiers.length === 0) return nothing;
    return html`<span class="line-modifiers">
      ${modifiers.map(
        (modifier) =>
          html`<span class="modifier">+ ${descriptionFor(modifier.descriptions, "")}</span>`,
      )}
    </span>`;
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
