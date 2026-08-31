import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { TickingClock, baseStyles } from "@waitron/ui";
import { BAND_RANK, type TimingBand, classifyBand, worstBand } from "@waitron/shared";
import { currentLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { allergenName } from "../i18n/allergen-names.js";
import { donenessLabel } from "../i18n/doneness-label.js";
import { dietBadgeStyles, dietBadges } from "../widgets/diet-badges.js";
import { descriptionFor, trimQuantity } from "../widgets/dish-format.js";
import type { ExpoCourse, ExpoItem, ExpoOrder, TillApi } from "../api/client.js";
import type { FireControlMode } from "../widgets/station-queue.js";

/** A course's ordering key: the null (courseless) group sorts FIRST — it is the auto-fired earliest set —
 *  then named courses by `displayOrder` ascending, matching the server's coursing sequence. The SAME
 *  null-first ordering `till-station-queue`'s `courseOrder` uses, so the pass and the station display
 *  sequence a coursed order identically. */
function courseOrder(course: ExpoCourse): number {
  return course.courseId === null ? Number.NEGATIVE_INFINITY : (course.displayOrder ?? 0);
}

/**
 * The TILL EXPO / PASS display (KDS-3, design §5): the expediter's cross-station board — a card per open
 * order on this node, each order's items grouped BY COURSE in `display_order` (null course first), so the
 * pass sees a whole order's coursing at once. UNLIKE the per-station kitchen display (`till-station-screen`,
 * which filters to ONE station), every item here carries its STATION name, so the expediter reads "the
 * grill is lagging the cold station" off one board.
 *
 * Each course carries the ONE lever its state calls for (design §5, `fire_control`-aware):
 *  - a HELD course (not all items fired) offers **Fire** ({@link TillApi.fireCourse}) — but ONLY under
 *    `fire_control = 'expo'`, the mode that hands the pass the fire; under `waiter`/`kitchen` another
 *    surface owns it, so the pass shows none and the held items sit greyed;
 *  - a FIRED, not-yet-all-plated course offers **"Curso listo"** ({@link TillApi.bumpCourseReady}) — bump
 *    every plated line of the course to `ready`;
 *  - a FIRED, all-`ready` course offers **"En camino"** ({@link TillApi.markCourseAway}) — dispatch the
 *    plated course to the floor.
 * The null (courseless) course has no per-course route (both bump routes are keyed by a course UUID), so
 * it offers no lever; its auto-fired lines advance on the per-station display instead. A fully-away course
 * has been dispatched and DROPS OFF the board (the server keeps the order while any item is not-away and
 * returns all its items, so the SCREEN filters `course.away` — the read does not).
 *
 * Like `till-station-screen` it OWNS its `.api` (the pass is the whole node's, so there is no picker and
 * nothing to screen): it fetches `getExpoQueue` on connect and after every lever, and a failed lever is
 * SWALLOWED and the reload reconciles the board to server truth — the degrade-gracefully shape the
 * station/floor screens use (the pass touches no fiscal path).
 *
 * AGE (KDS order-timing alerts, design §7.2). UNLIKE the per-station kitchen display
 * (`till-station-queue`, one station ⇒ one set of thresholds ⇒ one age per order), an expo order's
 * items can span SEVERAL stations, each with its own thresholds — so each {@link ExpoItem} carries its
 * OWN `queuedAt`/`thresholds`, classified via the shared `classifyBand` (`@waitron/shared`): fresh →
 * warm → overdue → **forgotten**. A card's own accent is the WORST band across its visible items
 * ({@link worstBand}), as a LEFT BORDER (never behind text, so the accent cannot fail a11y contrast) —
 * the same `age-*`/`flash` class scheme `till-station-queue`'s rail card uses, reduced-motion aware
 * (`#prefersReducedMotion`, checked live or injected via {@link reducedMotion}). A `forgotten` band
 * additionally FLAGS the individual lagging item with a non-colour tell (a text label beside its
 * station/state, never a second border colour competing with the item's own kitchen-state border) —
 * the item-level counterpart to the header's {@link #overdueCount} count badge, the pass-wide
 * non-colour tell. A `TickingClock` ({@link #clock}) advances the display while it sits idle, between
 * the container's own refreshes; `now` is still directly injectable so a test controls the band
 * deterministically. The server's `ExpoItem.band`/`ExpoOrder.worstBand` are authoritative only for
 * the very first paint — this screen re-derives both locally so they keep escalating between
 * refreshes with no new fetch.
 *
 * Lit + `@waitron/ui` `baseStyles` + theme tokens only — no hardcoded chrome, so it follows the operator's
 * theme like every sibling; the token/course-header/state-class/action-button primitives mirror
 * `till-station-queue`. Copy is the till's i18n (`expo.*`, reusing `station.*` for item states + "min");
 * identifiers stay English, station/dish names are DATA.
 */
@customElement("till-expo-screen")
export class TillExpoScreen extends LitElement {
  static override styles = [
    baseStyles,
    dietBadgeStyles,
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

      .empty {
        margin: 0;
        padding: var(--wt-space-4);
        color: var(--wt-color-text-muted);
        text-align: center;
      }

      /* BOARD — a card per order, wrapping across rows (the station rail's flex-wrap shape). */
      .board {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-3);
        align-items: flex-start;
      }

      .order {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        min-width: 14rem;
        padding: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        /* The age accent lives on the left edge (coloured by bucket below), never behind text. */
        border-left: var(--wt-space-1) solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
      }

      .order-head {
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

      /* Age accents on the card's left edge — a data-driven colour, never behind text (a11y). Three
         escalating bands (KDS order-timing alerts, design §7.2), the SAME scheme
         till-station-queue's rail card uses: warm (amber-ish primary), overdue (red), forgotten
         (red + a repeating flash, .flash below). 'fresh' gets no override — it keeps the base
         .order border colour. */
      .order.age-warm {
        border-left-color: var(--wt-color-primary);
      }

      .order.age-overdue,
      .order.age-forgotten {
        border-left-color: var(--wt-color-danger);
      }

      /* The FORGOTTEN flash (design §7.1/§7.2/§2): a repeating fade of the left border, never a
         colour/motion change behind text — .flash is applied only when the OS/browser has NOT asked
         for reduced motion (#prefersReducedMotion), so an assistive-motion setting renders the steady
         red border above with no @keyframes at all. The @media guard is a second, CSS-only line of
         defence for the same preference (belt-and-suspenders, house a11y rule) — mirrors
         till-station-queue's identical treatment of its .ticket/.cell. */
      .order.age-forgotten.flash {
        animation: age-forgotten-flash 1s ease-in-out infinite;
      }

      @keyframes age-forgotten-flash {
        50% {
          border-left-color: transparent;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .order.age-forgotten.flash {
          animation: none;
        }
      }

      /* The pass-wide overdue+forgotten count badge (design §7.2) — a non-colour tell ("2 overdue")
         so the escalation is legible without relying on the border colour alone (a11y), mirroring
         till-station-queue's identical header badge. */
      .overdue-count {
        margin: 0;
        padding: var(--wt-space-1) var(--wt-space-3);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-danger);
        color: var(--wt-color-on-danger);
        font-weight: var(--wt-font-weight-bold);
        display: inline-block;
      }

      /* The item-level FORGOTTEN flag (design §7.2) — a non-colour tell (a text label, never a
         second border colour on .item, which would compete with its own kitchen-state border for
         the same CSS property) beside the item's station/state, shown only for a forgotten item. */
      .item-forgotten-flag {
        color: var(--wt-color-danger);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
        white-space: nowrap;
      }

      /* A coursing subsection of a card — its named course header, its items, and the state's one lever. */
      .course {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
      }

      /* The course header — a muted, uppercased label like the station display's; the null (auto-fired
         earliest) course has no header at all. */
      .course-head {
        margin: var(--wt-space-1) 0 0;
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-text-muted);
        text-transform: uppercase;
      }

      .items {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        margin: 0;
        padding: 0;
        list-style: none;
      }

      /* An item row — the dish, its station, and its kitchen state. A non-interactive box (the pass acts
         per COURSE, not per item), themed like the station display's line cell. Column layout so the dish
         row (.item-main) can carry an indented modifiers list beneath it (ordering modifiers, Task 14); a
         modifier-free item has none, so it renders exactly as the single-row box did before. */
      .item {
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
      }

      /* The dish row: name, station and state — the SAME row .item rendered as its whole content before
         Task 14 added the modifiers list beneath it. */
      .item-main {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
      }

      /* The dish's selected options (ordering modifiers, Task 14), indented beneath it — matching the
         kitchen-print ticket's own "+ name" sub-text style (apps/server/src/kitchen-ticket.ts). */
      .item-modifiers {
        display: flex;
        flex-direction: column;
        padding-left: var(--wt-space-3);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      /* The per-line kitchen customisation (order-line customisation, Task 5), indented beneath the dish
         — the same shape the per-station display uses. Doneness is PROMINENT via text WEIGHT (the
         non-colour tell, house a11y rule); the free-text note is muted sub-text like the modifiers. */
      .item-customisation {
        display: flex;
        flex-direction: column;
        padding-left: var(--wt-space-3);
        font-size: var(--wt-font-size-sm);
      }

      .item-doneness {
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-text);
      }

      .item-note {
        color: var(--wt-color-text-muted);
      }

      /* The item's AS-SERVED allergen profile (modifier↔allergen, Task 9), indented beneath the dish +
         modifiers — localised "contains" chips, struck localised "NO <allergen name>" removal callouts
         (e.g. "NO Cereals containing gluten" / "SIN Leche"), and a pending note. A flex-wrap row so
         chips + callouts flow; mirrors the per-station display's identical row. */
      .item-allergens {
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
         pairing .item-forgotten-flag ships). The allergen is localised via allergenName, like the chips. */
      .allergen-removed {
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-danger);
        text-decoration: line-through;
      }

      /* The pending note earns emphasis — the expediter must NOT read an unreviewed dish as
         allergen-free (the Cautious policy). Text weight is the non-colour tell beside the colour. */
      .allergen-pending {
        color: var(--wt-color-warning-text, var(--wt-color-text));
        font-weight: var(--wt-font-weight-bold);
      }

      /* The as-served DIET & contains row (dietary-classification, Task 7), indented like the allergen
         row beneath the dish + modifiers. The badge/chip look comes from the shared dietBadgeStyles;
         only the indent is expo-specific. */
      .line-diet {
        padding-left: var(--wt-space-3);
      }

      .item.state-queued {
        border-left-color: var(--wt-color-text-muted);
      }

      .item.state-preparing {
        border-left-color: var(--wt-color-primary);
      }

      .item.state-ready {
        border-left-color: var(--wt-color-success);
      }

      /* A HELD item (its course not yet fired) — greyed and awaiting a fire. Greying is a MUTED text
         colour (the token every secondary label uses, so it keeps a11y contrast on the surface) plus a
         dashed box, NOT reduced opacity (which would composite the text and fail the contrast sweep) —
         the exact treatment the station display's held line uses. */
      .item.held {
        border-style: dashed;
        border-left-style: solid;
        color: var(--wt-color-text-muted);
      }

      /* The dish label (qty × name) — the primary text; truncates rather than wrapping so a long name
         never blows out the card width (min-width:0 lets a flex child shrink). Grows to push the station
         + state to the row's end. */
      .item-name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .item-station,
      .item-state {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
        white-space: nowrap;
      }

      /* The per-course lever — a full-width primary button at the foot of a course section. The
         wt-color-primary on wt-color-on-primary pairing is the SAME a11y-correct one wt-button's primary
         variant uses, so contrast holds in both themes (the station display's fire/collect shape). */
      .lever {
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

      /* The per-order REPRINT action (KDS-4 §3d) — a full-width SECONDARY wt-button at the card foot, under
         the per-course levers. wt-button hosts as inline-block; display:block lets it span the card width.
         Secondary (not primary) because reprint is a recover-from-a-jam utility, not a coursing step — its
         a11y-correct colour pairing lives inside wt-button, so no chrome is hardcoded here. */
      wt-button.reprint {
        display: block;
      }

      /* The reprint ERROR banner — the SAME danger-on-surface pairing the app + station screen use
         (a11y-safe in both themes), never behind muted text. Shown when a reprint call rejects, so the
         operator sees the ticket did NOT reprint rather than a silent no-op. */
      .error {
        margin: 0;
        padding: var(--wt-space-2) var(--wt-space-3);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-danger);
        color: var(--wt-color-on-danger);
        font-weight: var(--wt-font-weight-bold);
      }
    `,
  ];

  /** The HTTP face of the till — the screen fetches the pass queue and writes its levers through it
   *  (owned by the screen, threaded from the app, like `till-station-screen`). */
  @property({ attribute: false }) api!: TillApi;
  /** Who owns the per-course FIRE — the `fire_control` venue setting, threaded from the app. The pass
   *  shows the Fire lever on a held course ONLY under `expo`; the ready/away levers are the pass's own
   *  regardless of this (the setting decides who FIRES, not who dispatches — server route docs). */
  @property() fireControl: FireControlMode = "waiter";
  /** Injectable clock for age classification; falls back to the {@link #clock}'s ticked time (never a
   *  bare `Date.now()`, so a re-render from the tick and a re-render from a fresh fetch use the SAME
   *  clock source) when unset. Set in tests for deterministic bands — mirrors `till-station-queue`. */
  @property({ attribute: false }) now?: number;
  /**
   * Whether to render the FORGOTTEN band's flash as a steady accent instead (house a11y rule — never
   * colour/motion as the only signal, and the flash must honour `prefers-reduced-motion`). `undefined`
   * (the default) checks the live media query on every render; a test injects `true`/`false` for a
   * deterministic assertion — the same injectable-override shape {@link now} already uses, mirroring
   * `till-station-queue`.
   */
  @property({ attribute: false }) reducedMotion?: boolean;

  /** This node's open orders, grouped into courses across stations (reloaded after every lever). */
  @state() private orders: ExpoOrder[] = [];
  /**
   * The raw error CODE of a rejected reprint (KDS-4 §3d), surfaced via {@link codeMessage} in the banner
   * (never the raw code) — or `undefined` for none. UNLIKE the fire/ready/away levers, a reprint is NOT
   * run through {@link #act}: it changes no order state, so a reload reconciles nothing and a silent
   * swallow would leave the expediter no signal that the ticket did not reprint. So it takes a try/catch →
   * localised banner shape instead. Cleared on the next reprint attempt.
   */
  @state() private reprintErrorCode?: string;

  /** Drives the display forward while it sits idle — no refetch, just the client-side re-tick the
   *  order-timing design calls for (§5.2): every ~20s it bumps {@link TickingClock.now} and requests a
   *  re-render, so an item can climb fresh → warm → overdue → forgotten between the container's own
   *  refreshes. {@link now}, when set, always wins (tests stay deterministic). */
  readonly #clock = new TickingClock(this);

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#reload();
  }

  /** (Re)load the pass queue. A failed read leaves the last-known board in place (degrade gracefully —
   *  the pass touches no fiscal path); no `isConnected` guard (state-only, Lit does not paint a detached
   *  element — the sibling screens' reasoning). */
  async #reload(): Promise<void> {
    try {
      this.orders = await this.api.getExpoQueue();
    } catch {
      // Non-fatal — leave the last-known board; the next reload reconciles.
    }
  }

  /**
   * Run one pass lever, then reconcile on BOTH paths: a rejected call (a race, an already-dispatched
   * course) is SWALLOWED and the reload converges the board on server truth — the degrade-gracefully
   * shape `till-station-screen`'s `#advance` uses.
   */
  async #act(call: () => Promise<void>): Promise<void> {
    try {
      await call();
    } catch {
      // Non-fatal — the reload reconciles the board to server truth.
    }
    await this.#reload();
  }

  /**
   * Reprint an order's current kitchen tickets (KDS-4 §3d). DELIBERATELY not run through {@link #act}: a
   * reprint changes no order state, so there is nothing to reload/reconcile, and a swallow would hide a
   * failure the expediter needs to see (the ticket did not come out). So it surfaces a localised
   * {@link reprintErrorCode} banner on rejection (via {@link codeMessage}, never the raw wire code) and
   * clears it on the next attempt — the enrol path's shape, not the degrade-gracefully lever shape. The
   * expo/pass always runs in a session (R-K), so this is offered on every card with no mode guard.
   */
  async #reprint(orderId: string): Promise<void> {
    this.reprintErrorCode = undefined;
    try {
      await this.api.reprintOrder(orderId);
    } catch (error) {
      this.reprintErrorCode = (error as { code?: string }).code ?? "server.internal";
    }
  }

  /** Return to the counter (basket-preserving, handled by the app — mirrors the station/schedule/floor
   *  screens). */
  #back(): void {
    this.dispatchEvent(new CustomEvent("back-to-counter", { bubbles: true, composed: true }));
  }

  override render() {
    return html`
      <section class="screen" aria-label=${t("expo.title")}>
        <header class="head">
          <h1 class="title">${t("expo.title")}</h1>
          <wt-button class="back" data-back variant="secondary" @click=${() => this.#back()}>
            ${t("expo.back")}
          </wt-button>
        </header>
        ${this.#overdueBadge()}
        ${
          this.reprintErrorCode
            ? html`<p class="error" role="alert">${codeMessage(this.reprintErrorCode)}</p>`
            : nothing
        }
        ${this.orders.length === 0 ? this.#empty() : this.#board()}
      </section>
    `;
  }

  /** No open orders on the pass. */
  #empty(): TemplateResult {
    return html`<p class="empty">${t("expo.empty")}</p>`;
  }

  /** The board — a card per order, oldest first (the server's `opened_at` order is preserved). */
  #board(): TemplateResult {
    return html`<div class="board">${this.orders.map((order) => this.#card(order))}</div>`;
  }

  /** One order's card: its number + optional table label + age, then its non-away courses in
   *  `display_order` (null course first). The left-border accent is the WORST band across the card's
   *  visible items (design §7.2), never the old hardcoded `openedMinutes` bucket. */
  #card(order: ExpoOrder): TemplateResult {
    const band = this.#orderBand(order);
    return html`<article class="order ${this.#accentClasses(band)}" data-order=${order.orderNumber}>
      <div class="order-head">
        <span class="number">#${order.orderNumber}</span>
        ${order.tableLabel ? html`<span class="label">${order.tableLabel}</span>` : nothing}
        <span class="age">${order.openedMinutes} ${t("station.min")}</span>
      </div>
      ${this.#visibleCourses(order).map((course) => this.#courseSection(order, course))}
      ${this.#reprintAction(order)}
    </article>`;
  }

  /** The per-order reprint button (KDS-4 §3d) — a full-width secondary `wt-button` at the card foot, under
   *  the per-course levers. The expo/pass ALWAYS has a session (R-K), so it is shown on every card (no mode
   *  guard, unlike the station display). Its accessible name is the slotted "Reprint" text; that suffices
   *  here (a "Reprint" button is self-explanatory and the order context comes from the card heading, #N), so
   *  no `aria-label` is added and no differentiated per-order name is needed — the light/dark axe sweeps
   *  pass with the button present. The click runs {@link #reprint}. */
  #reprintAction(order: ExpoOrder): TemplateResult {
    return html`<wt-button
      class="reprint"
      data-reprint=${order.orderId}
      variant="secondary"
      @click=${() => void this.#reprint(order.orderId)}
    >
      ${t("expo.reprint")}
    </wt-button>`;
  }

  /** An order's courses to SHOW, oldest coursing first: fully-away (dispatched) courses drop off, the
   *  rest sort null-first then by `displayOrder` (the server already orders them, re-sorted here so the
   *  board is robust to input order — the station display's `courseOrder` discipline). */
  #visibleCourses(order: ExpoOrder): ExpoCourse[] {
    return order.courses
      .filter((course) => !course.away)
      .sort((a, b) => courseOrder(a) - courseOrder(b));
  }

  /** One coursing subsection of a card: its named course header (the null course has none), its items,
   *  and the ONE lever the course state calls for. */
  #courseSection(order: ExpoOrder, course: ExpoCourse): TemplateResult {
    return html`<div class="course" data-course=${course.courseId ?? "none"}>
      ${course.courseName ? html`<div class="course-head">${course.courseName}</div>` : nothing}
      <ul class="items">
        ${course.items.map((item) => html`<li>${this.#item(item)}</li>`)}
      </ul>
      ${this.#lever(order, course)}
    </div>`;
  }

  /** An item row: the dish (`qty× name`), its STATION (the cross-station label), its kitchen state, and
   *  — beneath, indented (ordering modifiers, Task 14) — its selected options as `+ <name>` sub-text.
   *  Greyed when HELD (its course unfired) — a non-interactive box (the pass acts per course). A
   *  FORGOTTEN item additionally carries a non-colour tell (design §7.2) — its own station is badly
   *  lagging, flagged with a text label rather than a second border colour (which would compete with
   *  this item's own kitchen-state border for the same CSS property). */
  #item(item: ExpoItem): TemplateResult {
    const held = item.firedAt === null;
    const forgotten = this.#itemBand(item) === "forgotten";
    return html`<span class="item state-${item.state} ${held ? "held" : ""}" data-item=${item.id}>
      <span class="item-main">
        <span class="item-name">${trimQuantity(item.qty)}× ${descriptionFor(item.name, "")}</span>
        <span class="item-station">${item.stationName}</span>
        <span class="item-state">${t(`station.state.${item.state}` as const)}</span>
        ${
          forgotten
            ? html`<span class="item-forgotten-flag" data-forgotten
                >${t("expo.item_forgotten")}</span
              >`
            : nothing
        }
      </span>
      ${this.#customisation(item)}${this.#modifiers(item)}${this.#allergens(item)}${dietBadges(
        item.asServedDiet,
        `item-diet-${item.id}`,
      )}
    </span>`;
  }

  /** The item's per-line kitchen customisation (order-line customisation, Task 5) as indented sub-text —
   *  the DONENESS rendered PROMINENTLY (localised `doneness.*` label, bold — the expediter must read how a
   *  steak is wanted; the weight is the non-colour tell) and the free-text NOTE as muted sub-text. Reads
   *  the SNAPSHOTTED fields the server froze at fire, the same rendering the per-station display uses.
   *  `nothing` when the line carried neither, so a plain dish renders identically to before this task. */
  #customisation(item: ExpoItem): TemplateResult | typeof nothing {
    const doneness = item.doneness ?? null;
    const note = item.note ?? null;
    if (doneness === null && (note === null || note === "")) return nothing;
    return html`<span class="item-customisation" data-item-customisation=${item.id}>
      ${
        doneness !== null
          ? html`<span class="item-doneness" data-doneness=${doneness}
              >${t("doneness.label")}: ${donenessLabel(doneness)}</span
            >`
          : nothing
      }
      ${
        note !== null && note !== ""
          ? html`<span class="item-note" data-note>${note}</span>`
          : nothing
      }
    </span>`;
  }

  /**
   * The item's AS-SERVED allergen profile (modifier↔allergen, Task 9), indented beneath the dish + its
   * modifiers — the SAME rendering the per-station display uses: the folded {@link ExpoItem.asServed}
   * codes as localised "contains" chips (`allergenName`, never a hardcoded EU-14 list), each
   * {@link ExpoItem.removed} base code as a struck **"NO &lt;allergen&gt;"** callout — the allergen
   * localised the SAME way as the chips (`allergenName`), never a raw English code — and a "not reviewed"
   * warning whenever the fold is `pending` (the dish's own allergens unreviewed — the Cautious policy).
   * Colour is NEVER the only signal (house a11y rule): the removal carries its "NO" text + strike-through,
   * the chips their names, the warning its text/weight. `nothing` when there is nothing to say — no
   * profile attached, nothing removed, not pending — so a plain dish renders identically to before.
   */
  #allergens(item: ExpoItem): TemplateResult | typeof nothing {
    const asServed = item.asServed;
    const removed = item.removed ?? [];
    const codes = asServed ? Object.keys(asServed.allergens).sort() : [];
    const pending = asServed?.pending ?? false;
    if (codes.length === 0 && removed.length === 0 && !pending) return nothing;
    const locale = currentLocale();
    return html`<span class="item-allergens" data-item-allergens=${item.id}>
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
   *  the item row — the same rendering the per-station display uses. `nothing` for a plain dish (no
   *  `modifiers`, or an empty array), so a modifier-free item renders identically to before this task. */
  #modifiers(item: ExpoItem): TemplateResult | typeof nothing {
    const modifiers = item.modifiers ?? [];
    if (modifiers.length === 0) return nothing;
    return html`<span class="item-modifiers">
      ${modifiers.map(
        (modifier) =>
          html`<span class="modifier">+ ${descriptionFor(modifier.descriptions, "")}</span>`,
      )}
    </span>`;
  }

  /**
   * The ONE per-course lever the course state calls for (design §5), or `nothing`:
   *  - a null (courseless) course has no course route — no lever;
   *  - a HELD course (`fired === false`) → **Fire** (`data-fire`), but ONLY under `fire_control = 'expo'`;
   *  - a FIRED, not-all-`ready` course → **"Curso listo"** (`data-ready`, bump the plated lines to ready);
   *  - a FIRED, all-`ready` course → **"En camino"** (`data-away`, dispatch the plated course).
   * A fully-away course never reaches here ({@link #visibleCourses} drops it). The three data-attributes
   * mirror the station display's `data-fire`/`data-collect` convention; each button is a full-width
   * primary control (see `.lever`), named for a11y by its verb + course, running its call through
   * {@link #act} (call then reload). One `?` binding cannot name three attributes, so the branches are
   * explicit — Lit fixes an attribute NAME at template-compile time.
   */
  #lever(order: ExpoOrder, course: ExpoCourse): TemplateResult | typeof nothing {
    if (course.courseId === null) return nothing;
    const courseId = course.courseId;
    const name = course.courseName ?? "";
    if (!course.fired) {
      // Held — the fire lever, shown only when THIS display owns the fire (the tab/kitchen screen does
      // under `waiter`/`kitchen`, so the pass shows none and the items sit greyed).
      if (this.fireControl !== "expo") return nothing;
      return html`<button
        class="lever fire"
        data-fire=${courseId}
        aria-label=${`${t("expo.fire")} ${name}`}
        @click=${() => void this.#act(() => this.api.fireCourse(order.orderId, courseId))}
      >
        ${t("expo.fire")}
      </button>`;
    }
    if (course.items.every((item) => item.state === "ready")) {
      return html`<button
        class="lever away"
        data-away=${courseId}
        aria-label=${`${t("expo.away")} ${name}`}
        @click=${() => void this.#act(() => this.api.markCourseAway(order.orderId, courseId))}
      >
        ${t("expo.away")}
      </button>`;
    }
    return html`<button
      class="lever ready"
      data-ready=${courseId}
      aria-label=${`${t("expo.ready")} ${name}`}
      @click=${() => void this.#act(() => this.api.bumpCourseReady(order.orderId, courseId))}
    >
      ${t("expo.ready")}
    </button>`;
  }

  /** The current clock reading for age classification: {@link now} when injected (deterministic
   *  tests), else the {@link #clock}'s own ticked time — never a fresh `Date.now()` call, so every
   *  render in one tick sees the identical `now` and the display genuinely advances only when the
   *  clock ticks (or a test moves {@link now}). Mirrors `till-station-queue`'s `#clockNow`. */
  #clockNow(): number {
    return this.now ?? this.#clock.now;
  }

  /** An item's escalation band against its OWN station's thresholds (`classifyBand`,
   *  `@waitron/shared`) — fresh / warm / overdue / forgotten (design §7.2). UNLIKE
   *  `till-station-queue`'s per-GROUP `#band` (one station ⇒ one clock), this is per-ITEM: an expo
   *  order's items can span several stations, each with its own `queuedAt`/`thresholds`. Recomputed
   *  from the item's own data on every render rather than trusting the server's `ExpoItem.band`
   *  snapshot, so it keeps climbing between refreshes under the `TickingClock`. */
  #itemBand(item: ExpoItem): TimingBand {
    return classifyBand(Date.parse(item.queuedAt), this.#clockNow(), item.thresholds);
  }

  /** An order's card accent: the WORST band across its currently-VISIBLE items ({@link
   *  #visibleCourses} — a fully-away course's items are already off the board), via `worstBand`
   *  (`@waitron/shared`). Recomputed locally rather than reading the server's `ExpoOrder.worstBand`
   *  snapshot, for the same tick-consistency reason as {@link #itemBand}. */
  #orderBand(order: ExpoOrder): TimingBand {
    return worstBand(
      this.#visibleCourses(order).flatMap((course) =>
        course.items.map((item) => this.#itemBand(item)),
      ),
    );
  }

  /** Whether the flash animation should be suppressed in favour of a steady accent — the live
   *  `prefers-reduced-motion` media query unless {@link reducedMotion} is injected (house a11y rule:
   *  motion must respect the OS preference). Mirrors `till-station-queue`'s identical check. */
  #prefersReducedMotion(): boolean {
    return this.reducedMotion ?? window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /** The age-accent class list for a band: always `age-${band}`, plus `flash` for `forgotten` unless
   *  motion is reduced — the CSS `.order.age-forgotten.flash` rule carries the `@keyframes`, so a
   *  reduced-motion render never gets the class an animation is defined against. Mirrors
   *  `till-station-queue`'s identical helper. */
  #accentClasses(band: TimingBand): string {
    const flash = band === "forgotten" && !this.#prefersReducedMotion();
    return `age-${band}${flash ? " flash" : ""}`;
  }

  /** Count of orders whose card band has escalated to at least `overdue` (overdue OR forgotten,
   *  `BAND_RANK`) — the pass-wide non-colour tell (design §7.2): an expediter who cannot distinguish
   *  the border colours still sees a number, mirroring `till-station-queue`'s per-station count. */
  #overdueOrderCount(): number {
    return this.orders.filter((order) => BAND_RANK[this.#orderBand(order)] >= BAND_RANK.overdue)
      .length;
  }

  /** The pass-wide overdue+forgotten count badge, shown only when the count is non-zero (a pass
   *  running entirely fresh/warm shows no badge at all, rather than a noisy "0 overdue"). */
  #overdueBadge(): TemplateResult | typeof nothing {
    const count = this.#overdueOrderCount();
    if (count === 0) return nothing;
    return html`<p class="overdue-count">${count} ${t("station.overdue_count")}</p>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-expo-screen": TillExpoScreen;
  }
}
