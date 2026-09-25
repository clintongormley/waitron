import { optionAnswers } from "./option-snapshot.js";
import { ContentLanguageController } from "@waitron/ui";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { TickingClock, baseStyles } from "@waitron/ui";
import { BAND_RANK, type TimingBand, classifyBand } from "@waitron/shared";
import { currentLocale, t } from "../i18n/t.js";
import { allergenName } from "../i18n/allergen-names.js";
import { dietBadgeStyles, dietBadges, extraNutrition } from "./diet-badges.js";
import { snapshotDescriptionFor, trimQuantity } from "./dish-format.js";
import type {
  StationQueueCourse,
  StationQueueGroup,
  StationQueueItem,
  TicketState,
} from "../api/client.js";

/** `ready` is terminal: a counter order's handover is an order-level collect, not a kitchen state. */
const NEXT: Record<TicketState, Exclude<TicketState, "queued"> | undefined> = {
  queued: "preparing",
  preparing: "ready",
  ready: undefined,
};

const COLUMNS: readonly TicketState[] = ["queued", "preparing", "ready"];

/** `line` advances the one tapped item; `ticket` (the venue's `bump_mode` setting) advances the whole
 *  order at the station. */
export type BumpMode = "line" | "ticket";

/** Which surface owns the per-course fire action (`locations.fire_control`): `kitchen` is this widget;
 *  under `waiter` the table-order screen fires and under `expo` the expo screen does. */
export type FireControlMode = "waiter" | "kitchen" | "expo";

interface FlatItem {
  item: StationQueueItem;
  group: StationQueueGroup;
}

interface CourseSection {
  course: StationQueueCourse | null;
  items: StationQueueItem[];
  held: boolean;
}

/** Courseless lines sort first: the server fires them at once unless the send asks to hold them. */
function courseOrder(course: StationQueueCourse | null): number {
  return course === null ? Number.NEGATIVE_INFINITY : course.displayOrder;
}

/**
 * One station's ticket items grouped by order, shown as a kanban board (a column per kitchen state) or a
 * ticket rail (a card per order). A pure view: the container owns {@link groups} and turns the events
 * this emits into API calls.
 *
 * An order is aged by its oldest line against its own station's thresholds. The age accent is a left
 * border, never a text background, so its colour cannot fail contrast; a `forgotten` border flashes
 * unless reduced motion is asked for, and the header's overdue count is the signal that is not colour.
 */
@customElement("till-station-queue")
export class TillStationQueue extends LitElement {
  constructor() {
    super();
    new ContentLanguageController(this);
  }

  static override styles = [
    baseStyles,
    dietBadgeStyles,
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

      /* Each selected extra's OWN allergens/diet (nutrition redesign, pass 1), flowing inline after the
         extra's "+ name" — never a fold, just the extra's own list beside the dish's own rows below. */
      .extra-nutrition,
      .extra-allergens,
      .extra-diet {
        display: inline-flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-1);
      }

      .extra-nutrition {
        margin-left: var(--wt-space-1);
      }

      /* The per-line kitchen customisation (order-line customisation, Task 5), indented beneath the dish
         like the modifiers list: the free-text note as muted sub-text. */
      .line-customisation {
        display: flex;
        flex-direction: column;
        gap: 0;
        padding-left: var(--wt-space-3);
        font-size: var(--wt-font-size-sm);
      }

      .line-note {
        color: var(--wt-color-text-muted);
      }

      /* The dish's OWN allergen profile (modifier↔allergen), indented beneath the dish + modifiers:
         localised "contains" chips and a pending note. A flex-wrap row (chips flow), the same indent as
         the modifiers list. */
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

      /* The pending note earns emphasis — a cook must NOT read an unreviewed dish as allergen-free (the
         Cautious policy). Text weight is the non-colour tell beside the colour (house a11y rule). */
      .allergen-pending {
        color: var(--wt-color-warning-text, var(--wt-color-text));
        font-weight: var(--wt-font-weight-bold);
      }

      /* The as-served DIET & contains row (dietary-classification, Task 7), indented like the allergen
         row beneath the dish. The badge/chip look comes from the shared dietBadgeStyles; only the indent
         is station-specific. */
      .line-diet {
        padding-left: var(--wt-space-3);
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

  @property({ attribute: false }) groups: StationQueueGroup[] = [];
  @property() view: "kanban" | "rail" = "kanban";
  @property() bumpMode: BumpMode = "line";
  /** The station these items are AT — required for the whole-ticket bump's event (ticket mode). */
  @property() stationId?: string;
  @property() fireControl: FireControlMode = "waiter";
  /** For an enrolled device display: the server's device routes are the per-line advance alone, and the
   *  collect and fire routes need a session, so both buttons are hidden. */
  @property({ type: Boolean }) advanceOnly = false;
  /** Rail-only, like collect: kanban columns cut across orders, so a per-order action has no home there. */
  @property({ type: Boolean }) showReprint = false;
  /** Injectable clock for age colouring. Set in tests for deterministic bands. */
  @property({ attribute: false }) now?: number;
  @property({ attribute: false }) reducedMotion?: boolean;

  /** Re-renders while the display sits idle, so a ticket can climb fresh → warm → overdue → forgotten
   *  between the container's own refreshes. */
  readonly #clock = new TickingClock(this);

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

  #collect(group: StationQueueGroup): void {
    this.dispatchEvent(
      new CustomEvent("mark-collected", {
        detail: { orderId: group.orderId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #fire(group: StationQueueGroup, course: StationQueueCourse): void {
    this.dispatchEvent(
      new CustomEvent("fire-course", {
        detail: { orderId: group.orderId, courseId: course.id },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #reprint(group: StationQueueGroup): void {
    this.dispatchEvent(
      new CustomEvent("reprint-order", {
        detail: { orderId: group.orderId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** Item order WITHIN a course is preserved (the server already ordered by `queued_at, line_no`). A
   * missing/undefined course is treated as the null course, so an older/partial payload still groups
   * cleanly. */
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
      if (item.firedAt !== null) section.held = false;
    }
    return [...byCourse.values()].sort((a, b) => courseOrder(a.course) - courseOrder(b.course));
  }

  /** Never a fresh `Date.now()` call, so every render in one tick sees the identical `now`. */
  #clockNow(): number {
    return this.now ?? this.#clock.now;
  }

  #band(group: StationQueueGroup): TimingBand {
    return classifyBand(Date.parse(group.queuedAt), this.#clockNow(), group.thresholds);
  }

  #elapsedMinutes(queuedAt: string): number {
    return Math.max(0, Math.floor((this.#clockNow() - Date.parse(queuedAt)) / 60000));
  }

  #prefersReducedMotion(): boolean {
    return this.reducedMotion ?? window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  #accentClasses(band: TimingBand): string {
    const flash = band === "forgotten" && !this.#prefersReducedMotion();
    return `age-${band}${flash ? " flash" : ""}`;
  }

  #overdueCount(): number {
    return this.groups.filter((group) => BAND_RANK[this.#band(group)] >= BAND_RANK.overdue).length;
  }

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

  #courseSection(group: StationQueueGroup, section: CourseSection): TemplateResult {
    return html`<div class="course" data-course=${section.course?.id ?? "none"}>
      ${section.course ? html`<div class="course-head">${section.course.name}</div>` : nothing}
      <ul class="lines">
        ${section.items.map((item) => html`<li>${this.#line(group, item)}</li>`)}
      </ul>
      ${this.#fireAction(group, section)}
    </div>`;
  }

  #fireAction(group: StationQueueGroup, section: CourseSection): TemplateResult | typeof nothing {
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

  /** Every order on the queue is already non-abandoned and uncollected (the server filters both), so
   * `settled` is the whole collectability test. */
  #collectAction(group: StationQueueGroup): TemplateResult | typeof nothing {
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

  /** Its accessible name is the slotted "Reprint" text; the order context comes from the card heading,
   * so no `aria-label` is added. */
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

  #kanban(): TemplateResult {
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

  /** The age accent is the WRAPPER's own left border, so it never overwrites the inner `.line`'s
   *  kitchen-state colour. */
  #kanbanCell(group: StationQueueGroup, item: StationQueueItem): TemplateResult {
    const band = this.#band(group);
    return html`<div class="cell ${this.#accentClasses(band)}">${this.#cell(group, item)}</div>`;
  }

  #line(group: StationQueueGroup, item: StationQueueItem): TemplateResult {
    const state = html`<span class="line-state"
      >${t(`station.state.${item.state}` as const)}</span
    >`;
    return this.#renderLine(group, item, state);
  }

  /** The columns cut across orders, so a cell keeps the order number beside the dish. */
  #cell(group: StationQueueGroup, item: StationQueueItem): TemplateResult {
    const tag = html`<span class="number"
      >#${group.orderNumber}${group.label ? html` · ${group.label}` : nothing}</span
    >`;
    return this.#renderLine(group, item, tag);
  }

  #renderLine(
    group: StationQueueGroup,
    item: StationQueueItem,
    secondary: TemplateResult,
  ): TemplateResult {
    const main = html`<span class="line-main">
      <span class="line-name">${this.#dish(item)}</span>${secondary}
    </span>`;
    const customisation = this.#customisation(item);
    const modifiers = this.#modifiers(item);
    const allergens = this.#allergens(item);
    const diet = dietBadges(item.asServedDiet, `line-diet-${item.id}`);
    const held = item.firedAt === null;
    if (held || NEXT[item.state] === undefined) {
      const stateModifier = held ? "held" : "terminal";
      return html`<span class="line state-${item.state} ${stateModifier}" data-item=${item.id}
        >${main}${customisation}${modifiers}${allergens}${diet}</span
      >`;
    }
    return html`<button
      class="line state-${item.state}"
      data-item=${item.id}
      aria-label=${this.#bumpLabel(group)}
      @click=${() => this.#bump(group, item)}
    >
      ${main}${customisation}${modifiers}${allergens}${diet}
    </button>`;
  }

  #customisation(item: StationQueueItem): TemplateResult | typeof nothing {
    const note = item.note ?? null;
    if (note === null || note === "") return nothing;
    return html`<span class="line-customisation" data-item-customisation=${item.id}>
      <span class="line-note" data-note>${note}</span>
    </span>`;
  }

  /** A `pending` profile shows a "not reviewed" warning: a cook must never read an unverified plate as
   *  allergen-free. Each extra's own allergens are shown separately. */
  #allergens(item: StationQueueItem): TemplateResult | typeof nothing {
    const asServed = item.asServed;
    const codes = asServed ? Object.keys(asServed.allergens).sort() : [];
    const pending = asServed?.pending ?? false;
    if (codes.length === 0 && !pending) return nothing;
    const locale = currentLocale();
    return html`<span class="line-allergens" data-item-allergens=${item.id}>
      ${
        codes.length > 0
          ? html`<span class="allergen-label">${t("allergens.contains")}</span> ${codes.map(
                (code) => html`<span class="allergen-chip">${allergenName(code, locale)}</span>`,
              )}`
          : nothing
      }
      ${
        pending
          ? html`<span class="allergen-pending">${t("allergens.not_reviewed")}</span>`
          : nothing
      }
    </span>`;
  }

  /** A cook reads the KITCHEN wording of an answer, which carries no per-language text and so needs
   *  no locale; an extra's own name is still a locale map. */
  #modifiers(item: StationQueueItem): TemplateResult | typeof nothing {
    const modifiers = item.modifiers ?? [];
    const answers = optionAnswers(item.optionSnapshots, { reads: "kitchen" });
    if (modifiers.length === 0 && answers.length === 0) return nothing;
    return html`<span class="line-modifiers">
      ${answers.map((answer) => html`<span class="modifier-answer">${answer}</span>`)}
      ${modifiers.map(
        (modifier, i) =>
          html`<span class="modifier"
            >${`+ ${snapshotDescriptionFor(modifier.descriptions, "")}`}${extraNutrition(
              modifier,
              `item-modifier-allergens-${item.id}-${i}`,
              `item-modifier-diet-${item.id}-${i}`,
            )}</span
          >`,
      )}
    </span>`;
  }

  /** The name is the server-resolved kitchen label and is rendered as sent. */
  #dish(item: StationQueueItem): string {
    const unit = item.unitName == null ? "" : ` ${snapshotDescriptionFor(item.unitName, "")}`;
    return `${trimQuantity(item.quantity)}${unit}× ${item.name}`;
  }

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
