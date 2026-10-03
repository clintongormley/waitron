import { queueCrossRefs } from "../widgets/queue-crossrefs.js";
import { optionAnswers } from "../widgets/option-snapshot.js";
import { ContentLanguageController, UrlStateController } from "@waitron/ui";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { TickingClock, baseStyles } from "@waitron/ui";
import { BAND_RANK, type TimingBand, classifyBand, worstBand } from "@waitron/shared";
import { currentLocale, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { allergenName } from "../i18n/allergen-names.js";
import { dietBadgeStyles, dietBadges, extraNutrition } from "../widgets/diet-badges.js";
import { dishLine, snapshotDescriptionFor } from "../widgets/dish-format.js";
import { tillPath } from "../navigation.js";
import "../widgets/stale-since.js";
import type {
  ExpoCourse,
  ExpoGroup,
  ExpoItem,
  ExpoOrder,
  GroupCommand,
  QueueParty,
  TillApi,
  WatcherSummary,
  WatcherCourse,
  WatcherGroup,
} from "../api/client.js";
import type { FireControlMode } from "../widgets/station-queue.js";

function courseOrder(course: ExpoCourse): number {
  return course.courseId === null ? Number.NEGATIVE_INFINITY : (course.displayOrder ?? 0);
}

/** The section of lines with no group sorts first. */
function groupOrder(group: ExpoGroup): number {
  return group.position ?? Number.NEGATIVE_INFINITY;
}

const REFRESH_MS = 15_000;
const READ_LIMIT_MS = 25_000;

/**
 * The TILL EXPO / PASS display: a card per open order, its items grouped BY COURSE across stations,
 * or by group for a seated party's bill.
 *
 * All stations hides fully-away courses and groups; a watcher retains them until its own Done.
 *
 * AGE. An expo order's items can span several stations, each with its own thresholds, so each item is
 * classified against its OWN `queuedAt`/`thresholds`. The server's `ExpoItem.band`/`ExpoOrder.worstBand`
 * are ignored: this screen re-derives both on every render so they keep escalating between refreshes.
 */
@customElement("till-expo-screen")
export class TillExpoScreen extends LitElement {
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

      .chooser,
      .selection,
      .done-notice {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
      }
      .stale {
        margin: 0;
        color: var(--wt-color-text-muted);
      }
      .stale[data-stale] {
        color: var(--wt-color-danger);
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
         per course or group, not per item), themed like the station display's line cell. Column layout so the dish
         row (.item-main) can carry an indented modifiers list beneath it. */
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

      /* The dish row: name, station and state. */
      .item-main {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
      }

      /* The dish's selected options, indented beneath it — matching the
         kitchen-print ticket's own "+ name" sub-text style (apps/server/src/kitchen-ticket.ts). */
      .item-modifiers {
        display: flex;
        flex-direction: column;
        padding-left: var(--wt-space-3);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .item-crossrefs {
        display: flex;
        flex-direction: column;
        padding-left: var(--wt-space-3);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      /* Each selected extra's OWN allergens/diet (nutrition redesign, pass 1), flowing inline after the
         extra's "+ name" — the extra's own list beside the dish's own, never a fold. */
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
         — the same shape the per-station display uses: the free-text note as muted sub-text. */
      .item-customisation {
        display: flex;
        flex-direction: column;
        padding-left: var(--wt-space-3);
        font-size: var(--wt-font-size-sm);
      }

      .item-note {
        color: var(--wt-color-text-muted);
      }

      /* The dish's OWN allergen profile (modifier↔allergen), indented beneath the dish + modifiers —
         localised "contains" chips and a pending note. A flex-wrap row so the chips flow; mirrors the
         per-station display's identical row. */
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

      .held-note {
        font-weight: var(--wt-font-weight-normal);
        text-transform: none;
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

      .table-changed {
        margin: 0;
        padding: var(--wt-space-2) var(--wt-space-3);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-warning);
        color: var(--wt-color-on-warning);
        font-weight: var(--wt-font-weight-bold);
      }
    `,
  ];

  @property({ attribute: false }) api!: TillApi;
  /** Decides who FIRES a held course or group; the ready/away levers are the pass's own regardless. */
  @property() fireControl: FireControlMode = "waiter";
  /** Injectable clock for age classification; unset falls back to the {@link #clock}'s ticked time. */
  @property({ attribute: false }) now?: number;
  /** `undefined` checks the live `prefers-reduced-motion` query on every render; a test injects a value. */
  @property({ attribute: false }) reducedMotion?: boolean;
  /** Mounted inside a card host, which supplies the header. */
  @property({ type: Boolean }) embedded = false;

  @state() private orders: ExpoOrder[] = [];
  @state() private watchers: WatcherSummary[] = [];
  @state() private selected: string | null = null;
  @state() private choosing = false;
  @state() private watcherRemoved = false;
  @state() private watcherRunsPass = false;
  @state() private doneErrorCode?: string;
  @state() private doneNotice?: { ids: string[]; dish: string };
  @state() private stale = false;
  #lastGoodAt = new Date();
  #refreshTimer?: ReturnType<typeof setInterval>;
  #undoTimer?: ReturnType<typeof setTimeout>;
  readonly #refreshReads = new Set<AbortController>();
  #request = 0;
  #appliedRequest = 0;
  readonly #url = new UrlStateController(
    this,
    () => {
      if (!this.embedded && this.#url.read("till-view") === "expo") void this.#restoreSelection();
    },
    tillPath,
  );
  /**
   * UNLIKE the fire/ready/away levers, a failed reprint is not swallowed: it changes no order state, so a
   * reload reconciles nothing and a silent failure would leave the expediter no signal.
   */
  @state() private reprintErrorCode?: string;
  /** The card whose group lever was refused because its party changed since the board was read:
   * shown by the next successful read, and gone at the one after. */
  @state() private tableChanged: string | null = null;
  #tableChangedNext: string | null = null;

  /** Re-renders the idle display so an item's band can climb between refreshes, with no refetch. */
  readonly #clock = new TickingClock(this);

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.embedded) void this.#reload();
    else void this.#loadWatchers();
    this.#refreshTimer = setInterval(() => void this.#refresh(), REFRESH_MS);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearInterval(this.#refreshTimer);
    clearTimeout(this.#undoTimer);
    for (const read of this.#refreshReads) read.abort();
    this.#refreshReads.clear();
  }

  async #loadWatchers(): Promise<void> {
    try {
      this.watchers = await this.api.listWatchers();
    } catch {
      this.watchers = [];
    }
    this.#restoreSelection();
  }

  #restoreSelection(): void {
    const requested =
      this.#url.read("till-view") === "expo" ? this.#url.read("till-watcher") : null;
    if (this.watchers.length === 0) this.#select("all", true);
    else if (requested === "all" || this.watchers.some((watcher) => watcher.id === requested))
      this.#select(requested!, true);
    else {
      this.selected = null;
      this.choosing = true;
    }
  }

  #select(id: string, restored = false): void {
    if (id !== this.selected) {
      this.orders = [];
      this.doneNotice = undefined;
      clearTimeout(this.#undoTimer);
    }
    this.selected = id;
    this.choosing = false;
    this.watcherRemoved = false;
    if (!restored && !this.embedded && this.#url.read("till-view") === "expo")
      this.#url.write({ "till-watcher": id });
    void this.#reload();
  }

  async #refresh(): Promise<void> {
    if (this.choosing || this.selected === null) return;
    const read = new AbortController();
    const limit = setTimeout(() => read.abort(), READ_LIMIT_MS);
    this.#refreshReads.add(read);
    try {
      await this.#reload(read.signal);
    } finally {
      clearTimeout(limit);
      this.#refreshReads.delete(read);
    }
  }

  async #reload(signal?: AbortSignal): Promise<void> {
    const request = ++this.#request;
    try {
      const result =
        this.selected === null || this.selected === "all"
          ? await this.api.getExpoQueue({ signal })
          : await this.api.getWatcherQueue(this.selected, { signal });
      if (request < this.#appliedRequest || !this.isConnected) return;
      this.#appliedRequest = request;
      if (Array.isArray(result)) this.orders = result;
      else {
        this.orders = result.orders;
        this.watcherRemoved = !result.watcher.active;
        this.watcherRunsPass = result.watcher.runsPass;
      }
      this.stale = false;
      this.#lastGoodAt = new Date();
      this.tableChanged = this.#tableChangedNext;
      this.#tableChangedNext = null;
    } catch (error) {
      if (request > this.#appliedRequest) {
        if ((error as { code?: string }).code === "watcher.not_found") this.watcherRemoved = true;
        this.stale = true;
      }
    }
  }

  async #done(ids: string[], dish: string): Promise<void> {
    if (this.selected === null || this.selected === "all") return;
    this.doneErrorCode = undefined;
    try {
      await this.api.markWatcherDone(this.selected, ids, true);
      this.doneNotice = { ids, dish };
      clearTimeout(this.#undoTimer);
      this.#undoTimer = setTimeout(() => {
        this.doneNotice = undefined;
      }, 10_000);
      await this.#reload();
    } catch (error) {
      this.doneErrorCode = (error as { code?: string }).code ?? "server.internal";
    }
  }

  async #undo(): Promise<void> {
    const notice = this.doneNotice;
    if (!notice || this.selected === null || this.selected === "all") return;
    this.doneNotice = undefined;
    clearTimeout(this.#undoTimer);
    try {
      await this.api.markWatcherDone(this.selected, notice.ids, false);
      await this.#reload();
    } catch (error) {
      this.doneErrorCode = (error as { code?: string }).code ?? "server.internal";
    }
  }

  /** A rejected call (a race, an already-dispatched course) is SWALLOWED; the reload converges the board
   * on server truth. */
  async #act(call: () => Promise<void>): Promise<void> {
    try {
      await call();
    } catch {
      // Non-fatal — the reload reconciles the board to server truth.
    }
    await this.#reload();
  }

  /** Refused `party.out_of_date`, the board is read again and the expediter decides; nothing is
   * resent. Any other refusal is swallowed like a course lever's. */
  async #groupAct(
    order: ExpoOrder,
    party: QueueParty,
    call: (command: GroupCommand) => Promise<{ revision: number }>,
  ): Promise<void> {
    this.tableChanged = null;
    this.#tableChangedNext = null;
    try {
      await call({ submissionId: crypto.randomUUID(), expectedPartyRevision: party.revision });
    } catch (error) {
      if ((error as { code?: string }).code === "party.out_of_date")
        this.#tableChangedNext = order.tableLabel ?? `#${order.orderNumber}`;
    }
    await this.#reload();
  }

  async #reprint(orderId: string): Promise<void> {
    this.reprintErrorCode = undefined;
    try {
      await this.api.reprintOrder(orderId);
    } catch (error) {
      this.reprintErrorCode = (error as { code?: string }).code ?? "server.internal";
    }
  }

  #back(): void {
    this.dispatchEvent(new CustomEvent("back-to-counter", { bubbles: true, composed: true }));
  }

  override render() {
    return html`
      <section class="screen" aria-label=${t("expo.title")}>
        ${
          this.embedded
            ? nothing
            : html`<header class="head">
                <h1 class="title">${t("expo.title")}</h1>
                <wt-button class="back" data-back variant="secondary" @click=${() => this.#back()}>
                  ${t("expo.back")}
                </wt-button>
              </header>`
        }
        ${
          this.choosing
            ? html`<p>${t("expo.choose")}</p>
                <div class="chooser">
                  <wt-button data-watcher="all" @click=${() => this.#select("all")}
                    >${t("expo.all_stations")}</wt-button
                  >
                  ${this.watchers.map((watcher) => html`<wt-button data-watcher=${watcher.id} @click=${() => this.#select(watcher.id)}>${watcher.name}</wt-button>`)}
                </div>`
            : nothing
        }
        ${
          !this.embedded && this.selected !== null && this.watchers.length > 0 && !this.choosing
            ? html`<div class="selection">
                <strong
                  >${this.selected === "all" ? t("expo.all_stations") : this.watchers.find((watcher) => watcher.id === this.selected)?.name}</strong
                ><wt-button
                  data-change
                  variant="secondary"
                  @click=${() => {
                    this.choosing = true;
                  }}
                  >${t("expo.change")}</wt-button
                >
              </div>`
            : nothing
        }
        ${this.choosing ? nothing : this.#overdueBadge()}
        ${this.choosing ? nothing : html`<p class="stale" role="status" ?data-stale=${this.stale}>${this.stale ? html`<till-stale-since .since=${this.#lastGoodAt}></till-stale-since>` : nothing}</p>`}
        ${this.doneNotice && !this.choosing ? html`<p class="done-notice" role="status">${t("expo.marked_done").replace("{dish}", this.doneNotice.dish)} <wt-button data-undo variant="secondary" @click=${() => void this.#undo()}>${t("expo.undo")}</wt-button></p>` : nothing}
        ${this.doneErrorCode ? html`<p class="error" role="alert">${codeMessage(this.doneErrorCode)}</p>` : nothing}
        ${
          this.reprintErrorCode
            ? html`<p class="error" role="alert">${codeMessage(this.reprintErrorCode)}</p>`
            : nothing
        }
        ${
          this.tableChanged === null
            ? nothing
            : html`<p class="table-changed" role="status" data-table-changed>
                ${t("station.table_changed_named").replace("{table}", () => this.tableChanged!)}
                ${t("station.table_changed")}
              </p>`
        }
        ${this.choosing ? nothing : this.watcherRemoved ? html`<p role="alert">${t("expo.watcher_removed")}</p>` : this.orders.length === 0 ? this.#empty() : this.#board()}
      </section>
    `;
  }

  #empty(): TemplateResult {
    return html`<p class="empty">${t(this.#isWatcher() ? "expo.watcher_empty" : "expo.empty")}</p>`;
  }

  #isWatcher(): boolean {
    return this.selected !== null && this.selected !== "all";
  }

  #board(): TemplateResult {
    return html`<div class="board">${this.orders.map((order) => this.#card(order))}</div>`;
  }

  #card(order: ExpoOrder): TemplateResult {
    const band = this.#orderBand(order);
    return html`<article class="order ${this.#accentClasses(band)}" data-order=${order.orderNumber}>
      <div class="order-head">
        <span class="number">#${order.orderNumber}</span>
        ${order.tableLabel ? html`<span class="label">${order.tableLabel}</span>` : nothing}
        <span class="age">${order.openedMinutes} ${t("station.min")}</span>
      </div>
      ${
        order.party === undefined
          ? this.#visibleCourses(order).map((course) => this.#courseSection(order, course))
          : this.#visibleGroups(order).map((group) =>
              this.#groupSection(order, order.party!, group),
            )
      }
      ${
        this.#isWatcher()
          ? html`<wt-button
              data-all-done=${order.orderId}
              @click=${() =>
                void this.#done(
                  (order.party === undefined ? order.courses : (order.groups ?? [])).flatMap(
                    (section) => section.items.map((item) => item.id),
                  ),
                  `#${order.orderNumber}`,
                )}
              >${t("expo.all_done")}</wt-button
            >`
          : nothing
      }
      ${this.#reprintAction(order)}
    </article>`;
  }

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

  #visibleCourses(order: ExpoOrder): ExpoCourse[] {
    return order.courses
      .filter((course) => this.#isWatcher() || !course.away)
      .sort((a, b) => courseOrder(a) - courseOrder(b));
  }

  #visibleGroups(order: ExpoOrder): ExpoGroup[] {
    return (order.groups ?? [])
      .filter((group) => this.#isWatcher() || !group.away)
      .sort((a, b) => groupOrder(a) - groupOrder(b));
  }

  #groupSection(order: ExpoOrder, party: QueueParty, group: ExpoGroup): TemplateResult {
    const name =
      group.position === null ? "" : t("table.group_n").replace("{n}", String(group.position));
    return html`<div class="course" data-group-section=${group.groupId ?? "none"}>
      ${
        group.groupId === null
          ? nothing
          : html`<div class="course-head">
              ${name}${
                group.state === "held"
                  ? html` ·
                      <span class="held-note" data-group-held>${t("station.group_held")}</span>`
                  : nothing
              }
            </div>`
      }
      <ul class="items">
        ${group.items.map((item) => html`<li>${this.#item(item, this.#isWatcher())}${this.#isWatcher() ? this.#doneButton(item) : nothing}</li>`)}
      </ul>
      ${group.groupId === null ? nothing : this.#groupLever(order, party, group, group.groupId, name)}
    </div>`;
  }

  /** The course lever's shape, one group at a time, through the group verbs. */
  #groupLever(
    order: ExpoOrder,
    party: QueueParty,
    group: ExpoGroup,
    groupId: string,
    name: string,
  ): TemplateResult | typeof nothing {
    if (this.#isWatcher() && (!this.#runsPass() || group.away)) return nothing;
    if (group.state === "held") {
      if (this.fireControl !== "expo") return nothing;
      return html`<button
        class="lever fire"
        data-group-fire=${groupId}
        aria-label=${`${t("expo.fire")} ${name}`}
        @click=${() =>
          void this.#groupAct(order, party, (command) =>
            this.api.fireGroup(party.id, groupId, command),
          )}
      >
        ${t("expo.fire")}
      </button>`;
    }
    if (
      this.#isWatcher()
        ? (group as WatcherGroup).allReady
        : group.items.every((item) => item.state === "ready")
    ) {
      return html`<button
        class="lever away"
        data-group-away=${groupId}
        aria-label=${`${t("expo.away")} ${name}`}
        @click=${() =>
          void this.#groupAct(order, party, async (command) => {
            const result = await this.api.markGroupAway(party.id, groupId, command);
            if (this.#isWatcher())
              await this.#done(
                group.items.map((item) => item.id),
                name,
              );
            return result;
          })}
      >
        ${t("expo.away")}
      </button>`;
    }
    return html`<button
      class="lever ready"
      data-group-ready=${groupId}
      aria-label=${`${t("expo.group_ready")} ${name}`}
      @click=${() =>
        void this.#groupAct(order, party, (command) =>
          this.api.bumpGroupReady(party.id, groupId, command),
        )}
    >
      ${t("expo.group_ready")}
    </button>`;
  }

  #courseSection(order: ExpoOrder, course: ExpoCourse): TemplateResult {
    return html`<div class="course" data-course=${course.courseId ?? "none"}>
      ${course.courseName ? html`<div class="course-head">${course.courseName}</div>` : nothing}
      <ul class="items">
        ${course.items.map((item) => html`<li>${this.#item(item, this.#isWatcher())}${this.#isWatcher() ? this.#doneButton(item) : nothing}</li>`)}
      </ul>
      ${this.#lever(order, course)}
    </div>`;
  }

  /** A FORGOTTEN item is flagged with a text label, not a second border colour, which would compete with
   *  the item's own kitchen-state border for the same CSS property. */
  #item(item: ExpoItem, watcher = false): TemplateResult {
    const held = item.firedAt === null;
    const forgotten = !(watcher && item.awayAt !== null) && this.#itemBand(item) === "forgotten";
    const label = dishLine(
      { quantity: item.qty, unitName: item.unitName, soldInEach: item.soldInEach },
      item.name,
    );
    return html`<span class="item state-${item.state} ${held ? "held" : ""}" data-item=${item.id}>
      <span class="item-main">
        <span class="item-name">${label}</span>
        <span class="item-station">${item.stationName}</span>
        <span class="item-state">${t(`station.state.${item.state}` as const)}</span>
        ${watcher && item.awayAt !== null ? html`<span>${t("expo.sent_out")}</span>` : nothing}
        ${
          forgotten
            ? html`<span class="item-forgotten-flag" data-forgotten
                >${t("expo.item_forgotten")}</span
              >`
            : nothing
        }
      </span>
      ${this.#customisation(item)}${this.#modifiers(item)}${queueCrossRefs(item, "item")}${this.#allergens(item)}${dietBadges(
        item.asServedDiet,
        `item-diet-${item.id}`,
      )}
    </span>`;
  }

  #doneButton(item: ExpoItem): TemplateResult {
    return html`<wt-button
      data-done=${item.id}
      aria-label=${t("expo.done_dish").replace("{dish}", item.name)}
      @click=${() => void this.#done([item.id], item.name)}
      >${t("expo.done")}</wt-button
    >`;
  }

  #runsPass(): boolean {
    return this.watcherRunsPass;
  }

  #customisation(item: ExpoItem): TemplateResult | typeof nothing {
    const note = item.note ?? null;
    if (note === null || note === "") return nothing;
    return html`<span class="item-customisation" data-item-customisation=${item.id}>
      <span class="item-note" data-note>${note}</span>
    </span>`;
  }

  /** The dish's OWN allergen profile; each extra's own allergens are shown separately. */
  #allergens(item: ExpoItem): TemplateResult | typeof nothing {
    const asServed = item.asServed;
    const codes = asServed ? Object.keys(asServed.allergens).sort() : [];
    const pending = asServed?.pending ?? false;
    if (codes.length === 0 && !pending) return nothing;
    const locale = currentLocale();
    return html`<span class="item-allergens" data-item-allergens=${item.id}>
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

  #modifiers(item: ExpoItem): TemplateResult | typeof nothing {
    const modifiers = item.modifiers ?? [];
    const answers = optionAnswers(item.optionSnapshots, { reads: "kitchen" });
    if (modifiers.length === 0 && answers.length === 0) return nothing;
    return html`<span class="item-modifiers">
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

  /**
   * The null (courseless) course has no per-course route, so no lever. The branches are explicit because
   * Lit fixes an attribute NAME at template-compile time, so one binding cannot name three attributes.
   */
  #lever(order: ExpoOrder, course: ExpoCourse): TemplateResult | typeof nothing {
    if (this.#isWatcher() && (!this.#runsPass() || course.away)) return nothing;
    if (course.courseId === null) return nothing;
    const courseId = course.courseId;
    const name = course.courseName ?? "";
    if (!course.fired) {
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
    if (
      this.#isWatcher()
        ? (course as WatcherCourse).allReady
        : course.items.every((item) => item.state === "ready")
    ) {
      return html`<button
        class="lever away"
        data-away=${courseId}
        aria-label=${`${t("expo.away")} ${name}`}
        @click=${() =>
          void this.#act(async () => {
            await this.api.markCourseAway(order.orderId, courseId);
            if (this.#isWatcher())
              await this.#done(
                course.items.map((item) => item.id),
                name,
              );
          })}
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

  /** Never a fresh `Date.now()`, so every render in one tick sees the identical `now`. */
  #clockNow(): number {
    return this.now ?? this.#clock.now;
  }

  #itemBand(item: ExpoItem): TimingBand {
    return classifyBand(Date.parse(item.queuedAt), this.#clockNow(), item.thresholds);
  }

  #orderBand(order: ExpoOrder): TimingBand {
    const sections =
      order.party === undefined ? this.#visibleCourses(order) : this.#visibleGroups(order);
    return worstBand(
      sections.flatMap((section) =>
        section.items
          .filter((item) => !this.#isWatcher() || item.awayAt === null)
          .map((item) => this.#itemBand(item)),
      ),
    );
  }

  #prefersReducedMotion(): boolean {
    return this.reducedMotion ?? window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  #accentClasses(band: TimingBand): string {
    const flash = band === "forgotten" && !this.#prefersReducedMotion();
    return `age-${band}${flash ? " flash" : ""}`;
  }

  /** The pass-wide non-colour tell: an expediter who cannot distinguish the border colours still sees a
   *  number. */
  #overdueOrderCount(): number {
    return this.orders.filter((order) => BAND_RANK[this.#orderBand(order)] >= BAND_RANK.overdue)
      .length;
  }

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
