import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
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
 * station/floor screens use (the pass touches no fiscal path). AGE: each card is accented by how long its
 * order has been open (`openedMinutes`, the server's urgency clock — no local clock needed): fresh (< 5),
 * warm (< 10), hot (≥ 10), as a LEFT BORDER (never behind text, so the accent cannot fail a11y contrast).
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

      /* Age accents on the card's left edge — a data-driven colour, never behind text (a11y). Fresh keeps
         the default border; warm/hot escalate, matching the station rail's age accents. */
      .order.age-warm {
        border-left-color: var(--wt-color-primary);
      }

      .order.age-hot {
        border-left-color: var(--wt-color-danger);
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
         per COURSE, not per item), themed like the station display's line cell. */
      .item {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-left: var(--wt-space-1) solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
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
   *  `display_order` (null course first). */
  #card(order: ExpoOrder): TemplateResult {
    const bucket = this.#ageBucket(order.openedMinutes);
    return html`<article class="order age-${bucket}" data-order=${order.orderNumber}>
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
   *  guard, unlike the station display). Its accessible name is the slotted "Reprint" text (like every
   *  other wt-button in the till): `aria-label` on a `wt-button` host is a11y-prohibited (the host carries
   *  no role — the inner `<button>` does), so the card heading (#N) supplies the order context. The click
   *  runs {@link #reprint}. */
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

  /** An item row: the dish (`qty× name`), its STATION (the cross-station label), and its kitchen state.
   *  Greyed when HELD (its course unfired) — a non-interactive box (the pass acts per course). */
  #item(item: ExpoItem): TemplateResult {
    const held = item.firedAt === null;
    return html`<span class="item state-${item.state} ${held ? "held" : ""}" data-item=${item.id}>
      <span class="item-name">${trimQuantity(item.qty)}× ${descriptionFor(item.name, "")}</span>
      <span class="item-station">${item.stationName}</span>
      <span class="item-state">${t(`station.state.${item.state}` as const)}</span>
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

  /** The age bucket for a card, from the order's open-minutes: fresh (< 5), warm (< 10), hot (≥ 10). */
  #ageBucket(openedMinutes: number): "fresh" | "warm" | "hot" {
    if (openedMinutes >= 10) return "hot";
    if (openedMinutes >= 5) return "warm";
    return "fresh";
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-expo-screen": TillExpoScreen;
  }
}
