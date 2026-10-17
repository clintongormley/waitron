import type { RosterBreach, WorkTimeRuleset } from "@waitron/workforce/roster-validation";
import "./publish-dialog.js";
import "./shift-edit-dialog.js";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { QueryController, codeMessage, codeOf } from "@waitron/dashboard-kit";
import { baseStyles, visuallyHiddenStyles } from "@waitron/ui";
import { fixedTitle, fixedTitleStyles } from "@waitron/venue-service/dashboard/fixed-title";
import { areaKey, type AreaRef, type Slot } from "../slots.js";
import type { RotaWeek } from "../staffing-types.js";
import type { StaffingApi } from "./client.js";
import { dateFormat, utc, weekTitleParts } from "./format.js";
import {
  EVERYONE,
  attentionTargets,
  chosenShow,
  dayCounts,
  hasSlots,
  isClosed,
  openSlots,
  paintTarget,
  rolesShown,
  summary,
  weekCounts,
  weekShiftCount,
  type Show,
  type Target,
} from "./rota-model.js";
import { STAFFING_STRINGS, countWords, t, tf } from "./strings.js";
import "./rota-by-area.js";
import "./rota-by-person.js";
import "./rota-day.js";
import "./rota-popup.js";
import { openHeading } from "./open-slots-menu.js";
import { slotHeading } from "./slot-picker.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";

const step = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

type PopupPick = { key: string; grid: string; selector: string; fallback: string };
type Grid = LitElement & { focusTarget(target: Target): boolean };

/** Below this many pixels of the rota's own width it draws one day: the Calendar Week's
 *  `PHONE_WIDTH` (`opening-hours-week.ts`), which venue-service does not export. */
export const PHONE_WIDTH = 560;
/** The least a finger moves across the day to step a day: the Calendar Week's `SWIPE_PX`
 *  (`opening-hours-week.ts:42`), which venue-service does not export. */
const SWIPE_PX = 48;

/** The calendar date now in `timeZone`. */
function dateIn(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

let widthCandidates: TemplateResult[] | undefined;
/** The titles of every week whose Monday falls in 2026, in each interface language, its month
 *  names shaped as the links are, as the Calendar Week sizes its title. */
function titleCandidates(): TemplateResult[] {
  if (!widthCandidates) {
    widthCandidates = [];
    for (const language of Object.keys(STAFFING_STRINGS))
      for (let monday = "2026-01-05"; monday < "2027-01-01"; monday = step(monday, 7))
        widthCandidates.push(
          html`${weekTitleParts(monday, language).map((part) =>
            part.month ? html`<span class="title-link">${part.text}</span>` : part.text,
          )}`,
        );
  }
  return widthCandidates;
}
@customElement("staffing-rota")
export class RotaView extends LitElement {
  static override styles = [
    baseStyles,
    fixedTitleStyles,
    css`
      :host {
        display: block;
        min-width: 0;
        container: rota / inline-size;
      }
      rota-day {
        touch-action: pan-y;
      }
      .head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
        margin-block-end: var(--wt-space-3);
      }
      .title-link {
        display: inline-block;
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--wt-color-primary-text);
        font: inherit;
        text-decoration: underline;
        cursor: pointer;
      }
      .title-link:focus-visible {
        outline: var(--wt-field-line-width-active) solid var(--wt-color-focus);
        outline-offset: var(--wt-focus-offset);
      }
      .head wt-combobox {
        min-width: calc(var(--wt-tap-min) * 4);
      }
      .end {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-3);
        margin-inline-start: auto;
      }
      .state {
        padding: var(--wt-space-1) var(--wt-space-2);
        border: 1px solid transparent;
        border-radius: var(--wt-radius-full);
        background: var(--wt-color-surface-sunken);
        color: var(--wt-color-text);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
      }
      .state[data-published] {
        border-color: var(--wt-color-success);
        background: var(--wt-color-surface);
        color: var(--wt-color-success);
      }
      .note {
        color: var(--wt-color-text-muted);
      }
      .attention {
        display: inline-flex;
        flex-wrap: wrap;
        align-items: center;
        column-gap: var(--wt-space-1);
      }
      /* A separator travels with the words after it, so a wrap never leaves it alone. */
      .joined {
        white-space: nowrap;
      }
      .joined.note {
        white-space: normal;
      }
      .count {
        min-block-size: var(--wt-tap-min);
        padding: 0;
        border: 0;
        background: none;
        color: var(--wt-color-warning);
        font: inherit;
        font-weight: var(--wt-font-weight-medium);
        text-decoration: underline dotted;
        text-underline-offset: var(--wt-space-1);
        cursor: pointer;
      }
      .summary {
        color: var(--wt-color-text-muted);
      }
      .summary[data-summary="all_filled"] {
        color: var(--wt-color-success);
        font-weight: var(--wt-font-weight-medium);
      }
      .labour {
        color: var(--wt-color-danger);
        font-weight: var(--wt-font-weight-medium);
      }
      .swap {
        margin: 0 0 var(--wt-space-3);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface-raised);
      }
      .visually-hidden {
        ${visuallyHiddenStyles}
      }
      .error {
        color: var(--wt-color-danger);
      }
      .unpainted {
        margin-block-end: var(--wt-space-3);
        padding: var(--wt-space-4);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
      }
      .unpainted h3 {
        margin: 0 0 var(--wt-space-2);
      }
      .unpainted p {
        margin: 0 0 var(--wt-space-3);
      }
      .head.phone {
        flex-wrap: wrap;
      }
      .phone .fixed-title {
        flex: 1 1 0;
        min-width: 0;
      }
      .phone .strip,
      .phone wt-combobox,
      .phone .end {
        flex-basis: 100%;
      }
      .phone .end {
        margin-inline-start: 0;
      }
      .strip {
        display: grid;
        grid-template-columns: repeat(7, minmax(0, 1fr));
        gap: var(--wt-space-1);
      }
      .strip button {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        min-width: 0;
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-1) 0;
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
        cursor: pointer;
      }
      .strip button:focus-visible {
        outline: var(--wt-field-line-width-active) solid var(--wt-color-focus);
        outline-offset: var(--wt-focus-offset);
      }
      .strip button[data-closed] {
        color: var(--wt-color-text-muted);
      }
      .strip button[aria-pressed="true"] {
        border-color: var(--wt-color-primary);
        background: var(--wt-color-primary);
        color: var(--wt-color-on-primary);
      }
      .strip .date {
        font-size: var(--wt-font-size-lg);
        font-weight: var(--wt-font-weight-bold);
      }
      .strip .dot {
        position: absolute;
        inset-block-start: var(--wt-space-1);
        inset-inline-end: var(--wt-space-1);
        width: var(--wt-space-2);
        height: var(--wt-space-2);
        border-radius: var(--wt-radius-full);
        background: var(--wt-color-warning);
      }
      .foot {
        position: sticky;
        bottom: 0;
        margin-block-start: var(--wt-space-3);
        padding-block: var(--wt-space-2);
        background: var(--wt-color-bg);
      }
      .foot wt-button {
        display: block;
        width: 100%;
      }
      .unpainted .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }
    `,
  ];
  @property({ attribute: false }) api!: StaffingApi;
  @property() week = "";
  @property({ attribute: false }) params: Readonly<Record<string, string>> = {};
  @property({ type: Boolean }) canWrite = false;
  @property({ type: Boolean }) canWriteStaffing = false;
  @property({ type: Boolean }) canOpenStaffing = false;
  @property({ attribute: false }) open!: (view: string, params: Record<string, string>) => void;
  @state() private read?: RotaWeek;
  @state() private loadError = "";
  @state() private actionError = "";
  @state() private picked?: Slot;
  /** A person's day whose open slots are shown; `offered` is whether it had any when opened. */
  @state() private openDay?: { personId: string; businessDay: string; offered: boolean };
  @state() private editor?: {
    shiftId?: string;
    businessDay?: string;
    personId?: string;
    area?: AreaRef;
    staffRoleId?: string;
  };
  @state() private busy = false;
  @state() private warnings?: { breaches: RosterBreach[]; ruleset: WorkTimeRuleset | null };
  @state() private warningsError = "";
  @state() private swapNotice: number | undefined;
  @state() private changingError = "";
  @state() private publishing = false;
  @state() private publishError = "";
  @state() narrow = false;
  /** The phone's shown business day. */
  @state() private day = "";
  // The rota observation triggers this read; a second live observation would duplicate it.
  readonly #warningQueries = new QueryController(
    this,
    () => undefined,
    (e) => {
      this.warnings = undefined;
      this.warningsError = tf("staffing.rota.warnings_error", { reason: codeMessage(codeOf(e)) });
    },
  );
  #watching = "";
  #area = "";
  #anchor: HTMLElement | undefined;
  /** The pick the popup was last opened for: a slot key, or a person's day. */
  #shownFor: string | undefined;
  #generation = 0;
  /** The day a week arrow asked for, shown once the host moves to its week. */
  #arriving: string | undefined;
  #narrowing = 0;
  readonly #resizes = new ResizeObserver(([entry]) => {
    const narrow = entry!.contentRect.width < PHONE_WIDTH;
    cancelAnimationFrame(this.#narrowing);
    // Set in this callback, the redraw would change the host's height inside the observer's own
    // pass, which the browser reports as a resize loop.
    this.#narrowing = requestAnimationFrame(() => (this.narrow = narrow));
  });
  /** The target each count button last focused, to step on from. */
  #stepped: Partial<Record<"unfilled" | "partly" | "over", Target>> = {};
  readonly #queries = new QueryController(
    this,
    () => this.api.liveData,
    (e) => {
      this.loadError = tf("staffing.rota.load_error", { reason: codeMessage(codeOf(e)) });
    },
    () => {
      this.loadError = "";
    },
  );
  override connectedCallback() {
    super.connectedCallback();
    this.#watching = "";
    // Measured now as well, so a phone's first paint is already its day.
    const box = getComputedStyle(this);
    const around = ["paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth"] as const;
    this.narrow =
      this.getBoundingClientRect().width -
        around.reduce((sum, side) => sum + parseFloat(box[side]), 0) <
      PHONE_WIDTH;
    this.#resizes.observe(this);
    this.requestUpdate();
  }
  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#generation++;
    this.#resizes.disconnect();
    cancelAnimationFrame(this.#narrowing);
    this.#swipeStop();
  }
  override willUpdate(changed: PropertyValues<this>) {
    if (changed.has("narrow")) this.#swipeStop();
    if ((this.params.area ?? "") !== this.#area) {
      this.#area = this.params.area ?? "";
      this.picked = undefined;
      this.openDay = undefined;
      this.actionError = "";
    }
    if (this.week && this.week !== this.#watching) {
      this.#watching = this.week;
      this.#generation++;
      const arriving = this.#arriving;
      this.#arriving = undefined;
      this.day =
        arriving && arriving >= this.week && arriving <= step(this.week, 6) ? arriving : "";
      this.editor = undefined;
      this.warnings = undefined;
      this.warningsError = "";
      this.publishing = false;
      this.swapNotice = undefined;
      this.changingError = "";
      this.publishError = "";
      this.#warningQueries.release("rota-warnings");
      this.picked = undefined;
      this.openDay = undefined;
      this.actionError = "";
      this.busy = false;
      this.loadError = "";
      this.#watch();
    }
  }
  #watch() {
    const week = this.week;
    void this.api
      .watchRota(this.#queries, week, (read) => {
        this.read = read;
        this.loadError = "";
        if (week === this.week && !read.days.some((d) => d.businessDay === this.day)) {
          const today = dateIn(read.timeZone);
          this.day = read.days.some((d) => d.businessDay === today) ? today : week;
        }
        this.warnings = undefined;
        void this.api
          .watchRotaWarnings(this.#warningQueries, read.locationId, week, (warnings) => {
            this.warnings = warnings;
            this.warningsError = "";
          })
          .catch(() => undefined);
        if (read.version?.status === "published") {
          this.publishing = false;
          this.editor = undefined;
        }
        const picked = this.picked;
        const listed = picked
          ? read.days
              .flatMap((d) => d.areas)
              .flatMap((a) => a.match.slots)
              .find((s) => s.slot.key === picked.key)
          : undefined;
        // The picker reads its slot's area from the week, so it cannot outlive the slot or the area,
        // even mid-fill.
        if (
          picked &&
          (!listed || !read.areas.some((a) => areaKey(a.area) === areaKey(picked.area)))
        )
          this.picked = undefined;
        else if (
          picked &&
          !this.busy &&
          (read.version?.status === "published" || listed!.status.kind !== "unfilled")
        )
          this.picked = undefined;
        const day = this.openDay;
        // The menu reads its person from the week, so it cannot outlive them, even mid-fill.
        if (day && !read.people.some((p) => p.personId === day.personId)) this.openDay = undefined;
        else if (day && !this.busy) {
          const left = openSlots(read, day.personId, day.businessDay);
          if (
            read.version?.status === "published" ||
            (day.offered && left.own.length + left.other.length === 0)
          )
            this.openDay = undefined;
        }
      })
      .catch(() => undefined);
  }
  /** What the popup is open for, as a key, and where its anchor is drawn: `selector`, else
   *  `fallback`. */
  #pick(): PopupPick | undefined {
    if (this.picked) {
      const selector = `[data-slot="${this.picked.key}"]`;
      const grid = this.narrow ? "rota-day" : "rota-by-area";
      return { key: this.picked.key, grid, selector, fallback: selector };
    }
    if (this.openDay && this.narrow) {
      const person = `[data-person="${this.openDay.personId}"]`;
      return {
        key: `${this.openDay.personId} ${this.openDay.businessDay}`,
        grid: "rota-day",
        selector: `${person} [data-test=person]`,
        fallback: person,
      };
    }
    if (this.openDay) {
      const cell = `[data-person="${this.openDay.personId}"] td[data-day="${this.openDay.businessDay}"]`;
      return {
        key: `${this.openDay.personId} ${this.openDay.businessDay}`,
        grid: "rota-by-person",
        selector: `${cell} [data-test=day-add]`,
        fallback: cell,
      };
    }
    return undefined;
  }
  override updated() {
    const popup = this.renderRoot.querySelector("rota-popup");
    const pick = this.#pick();
    if (!pick) {
      if (this.#shownFor !== undefined) popup?.hide();
      this.#shownFor = undefined;
      return;
    }
    if (this.#shownFor === pick.key) {
      void this.#reanchor(pick);
      return;
    }
    this.#shownFor = pick.key;
    void this.renderRoot.querySelector<LitElement>("rota-popup > *")!.updateComplete.then(() => {
      if (this.#pick()?.key === pick.key) popup!.show(this.#anchor!);
    });
  }
  /** The element a pick opened from is redrawn once the grid turns editable or read-only, as it
   *  does while a fill is in flight, so an open popup follows the one now drawn for the pick. In
   *  Everyone no day button is drawn while the fill is in flight, so the popup follows the day's
   *  cell until it returns. */
  async #reanchor(pick: PopupPick) {
    const grid = this.renderRoot.querySelector<LitElement>(pick.grid);
    if (!grid) return;
    await grid.updateComplete;
    const root = grid.shadowRoot!;
    const found =
      root.querySelector<HTMLElement>(pick.selector) ??
      root.querySelector<HTMLElement>(pick.fallback);
    const popup = this.renderRoot.querySelector("rota-popup");
    if (this.#pick()?.key !== pick.key || !found || found === this.#anchor) return;
    this.#anchor = found;
    if (popup?.shown) popup.show(found);
  }
  readonly #popupClosed = () => {
    // A close that arrives while the popup is open again belongs to an earlier showing: leave the
    // pick alone.
    if (this.renderRoot.querySelector("rota-popup")?.shown) return;
    this.picked = undefined;
    this.openDay = undefined;
    this.actionError = "";
  };
  /** A fill that settles once its popup is gone leaves focus on nothing, or inside the closed
   *  popup: the element it started from was redrawn while the fill was in flight. */
  async #refocus(grid: string, selector: string) {
    await this.updateComplete;
    const shown = this.renderRoot.querySelector<LitElement>(grid);
    if (this.#pick() || !shown) return;
    await shown.updateComplete;
    if (
      document.activeElement === document.body ||
      this.shadowRoot!.activeElement?.localName === "rota-popup"
    )
      shown.shadowRoot!.querySelector<HTMLElement>(selector)?.focus();
  }
  #go(week: string, area = this.params.area) {
    this.open("rota", { week, ...(area ? { area } : {}) });
  }
  /** A week arrow: the phone keeps its weekday in the week it moves to. */
  #stepWeek(days: number) {
    if (this.day) this.#arriving = step(this.day, days);
    this.#go(step(this.week, days));
  }
  #swipeFrom: { id: number; x: number; y: number } | undefined;
  /** The touch and pen contacts down on the day. */
  #contacts = new Set<number>();
  #swipeStart(event: PointerEvent) {
    if (event.pointerType === "mouse") return;
    if (this.#contacts.size === 0) {
      // Heard on the window, so a contact lifted where the day does not hear it still ends.
      window.addEventListener("pointerup", this.#swipeEnd);
      window.addEventListener("pointercancel", this.#swipeEnd);
      this.#swipeFrom = { id: event.pointerId, x: event.clientX, y: event.clientY };
    } else {
      // A second contact ends the swipe; none starts until every contact has ended.
      this.#swipeFrom = undefined;
    }
    this.#contacts.add(event.pointerId);
  }
  #swipeEnd = (event: PointerEvent): void => {
    if (!this.#contacts.delete(event.pointerId)) return;
    const from = this.#swipeFrom;
    if (this.#contacts.size === 0) this.#swipeStop();
    if (event.type !== "pointerup" || from?.id !== event.pointerId) return;
    const across = event.clientX - from.x;
    const down = event.clientY - from.y;
    if (Math.abs(across) < SWIPE_PX || Math.abs(across) <= 2 * Math.abs(down)) return;
    const next = step(this.day, across < 0 ? 1 : -1);
    if (next >= this.week && next <= step(this.week, 6)) this.day = next;
    else {
      this.#arriving = next;
      this.#go(step(this.week, across < 0 ? 7 : -7));
    }
  };
  #swipeStop(): void {
    this.#swipeFrom = undefined;
    this.#contacts.clear();
    window.removeEventListener("pointerup", this.#swipeEnd);
    window.removeEventListener("pointercancel", this.#swipeEnd);
  }
  async #fill(slot: Slot, personId: string) {
    const pick = this.#pick(),
      read = this.read,
      generation = this.#generation;
    if (
      this.busy ||
      !pick ||
      !read ||
      read.week !== this.week ||
      read.version?.status === "published" ||
      !this.canWrite
    )
      return;
    this.busy = true;
    this.actionError = "";
    try {
      await this.api.addRotaShift({
        week: this.week,
        businessDay: slot.businessDay,
        area: slot.area,
        staffRoleId: slot.staffRoleId,
        startsAt: slot.startsAt,
        endsAt: slot.endsAt,
        personId,
      });
      if (generation !== this.#generation) return;
      this.picked = undefined;
      this.openDay = undefined;
      this.#watch();
    } catch (e) {
      if (generation === this.#generation)
        this.actionError = tf("staffing.rota.save_error", { reason: codeMessage(codeOf(e)) });
    } finally {
      if (generation === this.#generation) {
        this.busy = false;
        void this.#refocus(pick.grid, pick.selector);
      }
    }
  }
  async #changeWeek() {
    const generation = this.#generation;
    if (this.busy || !this.canWrite || this.read?.version?.status !== "published") return;
    this.busy = true;
    this.changingError = "";
    try {
      const result = await this.api.changeRotaWeek(this.week);
      if (generation !== this.#generation) return;
      this.swapNotice = result.openSwaps.length || undefined;
      this.#watch();
    } catch (e) {
      if (generation === this.#generation)
        this.changingError = tf("staffing.rota.change_error", { reason: codeMessage(codeOf(e)) });
    } finally {
      if (generation === this.#generation) this.busy = false;
    }
  }
  async #publish() {
    const version = this.read?.version,
      generation = this.#generation;
    if (
      this.busy ||
      !this.canWrite ||
      !this.publishing ||
      !this.warnings ||
      version?.status !== "draft"
    )
      return;
    this.busy = true;
    this.publishError = "";
    try {
      await this.api.publishRota(version.id);
      if (generation !== this.#generation) return;
      this.publishing = false;
      this.#watch();
    } catch (e) {
      if (generation === this.#generation)
        this.publishError = tf("staffing.rota.publish_error", { reason: codeMessage(codeOf(e)) });
    } finally {
      if (generation === this.#generation) this.busy = false;
    }
  }
  #attention(read: RotaWeek, show: Show) {
    const kind = summary(read, show);
    if (kind !== "counts") {
      const words = t(`staffing.rota.${kind}`);
      return {
        words,
        body: html`<span class="summary" data-test="summary" data-summary=${kind}>${words}</span>`,
      };
    }
    const counts = weekCounts(read, show);
    const kinds = (["unfilled", "partly", "over"] as const).filter((k) => counts[k] > 0);
    return {
      words: kinds.map((k) => countWords(k, counts[k])).join(" · "),
      body: kinds.map((k, i) => {
        const button = html`<button
          type="button"
          class="count"
          data-kind=${k}
          @click=${() => void this.#step(read, show, k)}
        >
          ${countWords(k, counts[k])}
        </button>`;
        return i ? html`<span class="joined"> ·&nbsp;${button}</span>` : button;
      }),
    };
  }
  async #step(read: RotaWeek, show: Show, kind: "unfilled" | "partly" | "over") {
    const targets = attentionTargets(read, show, kind);
    const same = (a: Target, b: Target | undefined) =>
      !!b && (["businessDay", "slotKey", "shiftId", "header"] as const).every((k) => a[k] === b[k]);
    const next =
      targets[(targets.findIndex((t) => same(t, this.#stepped[kind])) + 1) % targets.length]!;
    if (this.narrow) {
      this.day = next.businessDay;
      await this.updateComplete;
    }
    if (this.narrow && next.header) {
      const button = this.renderRoot.querySelector<HTMLElement>(
        `[data-test=strip] [data-day="${next.businessDay}"]`,
      )!;
      button.focus();
      button.scrollIntoView({ block: "nearest", inline: "nearest" });
      this.#stepped[kind] = next;
      return;
    }
    const grid = this.renderRoot.querySelector<Grid>(
      this.narrow ? "rota-day" : show.kind === "everyone" ? "rota-by-person" : "rota-by-area",
    )!;
    await grid.updateComplete;
    if (grid.focusTarget(next)) this.#stepped[kind] = next;
  }
  #labour() {
    if (!this.warnings) return nothing;
    if (this.warnings.ruleset === null)
      return html`<span class="joined note"
        ><span aria-hidden="true">·</span>&nbsp;<span role="status" data-test="no-rules"
          >${t("staffing.rota.no_rules")}</span
        ></span
      >`;
    const count = this.warnings.breaches.length;
    return html`<span class="labour" role="status" data-test="labour-count"
      ><span aria-hidden="true">⚠</span>
      ${count === 1 ? t("staffing.rota.labour_one") : tf("staffing.rota.labour_count", { count: String(count) })}</span
    >`;
  }
  #action(read: RotaWeek) {
    if (!this.canWrite) return nothing;
    if (read.version?.status === "published")
      return html`<wt-button
        variant="secondary"
        data-test="change-week"
        ?disabled=${this.busy}
        @click=${() => void this.#changeWeek()}
        >${t("staffing.rota.change_week")}</wt-button
      >`;
    const ready = !!this.warnings && weekShiftCount(read) > 0;
    return html`<wt-button
      data-test="publish-week"
      variant=${ready ? "primary" : "secondary"}
      ?disabled=${this.busy || !ready}
      @click=${() => {
        this.publishing = true;
        this.publishError = "";
      }}
      >${t(read.version?.changedSincePublished ? "staffing.rota.publish_changes" : "staffing.rota.publish")}</wt-button
    >`;
  }
  /** Why an area with no slots this week has nothing to fill, and the painter that gives it some. */
  #unpainted(read: RotaWeek, show: Show & { kind: "area" }) {
    const target = paintTarget(read, this.narrow ? this.day : undefined);
    const words = { area: show.name, season: target?.name ?? "" };
    const label =
      target?.painter === "season"
        ? this.canWriteStaffing
          ? "staffing.rota.paint_week"
          : "staffing.day.show_week"
        : this.canWriteStaffing
          ? "staffing.day.edit_special"
          : "staffing.day.show_special";
    return html`<section class="unpainted" data-test="unpainted">
      <h3>${tf("staffing.rota.unpainted_title", { area: show.name })}</h3>
      <p>
        ${tf(target?.painter === "season" ? "staffing.rota.unpainted_season" : "staffing.rota.unpainted_plain", words)}
      </p>
      <div class="actions">
        ${
          target && this.canOpenStaffing
            ? html`<wt-button
                variant="primary"
                data-test="paint"
                @click=${() =>
                  this.open("staffing", {
                    month: this.week.slice(0, 7),
                    area: show.key,
                    painter: target.painter,
                    [target.painter === "season" ? "season" : "special-day"]: target.id,
                  })}
                >${tf(label, { season: target.name, name: target.name })}</wt-button
              >`
            : nothing
        }
        <wt-button
          variant="secondary"
          data-test="show-everyone"
          @click=${() => this.#go(this.week, EVERYONE)}
          >${t("staffing.rota.show_everyone")}</wt-button
        >
      </div>
    </section>`;
  }
  #title(show: Show | undefined) {
    if (!this.week) return nothing;
    return weekTitleParts(this.week).map((part) => {
      const { month } = part;
      if (!month || !this.canOpenStaffing || this.narrow) return part.text;
      return html`<button
        type="button"
        class="title-link"
        aria-describedby="month-hint"
        @click=${() =>
          this.open("staffing", { month, ...(show?.kind === "area" ? { area: show.key } : {}) })}
      >
        ${part.text}
      </button>`;
    });
  }
  /** The phone's week: a button per day, marked when it needs attention and muted when Closed. */
  #strip(read: RotaWeek, show: Show) {
    return html`<div
      class="strip"
      role="group"
      aria-label=${t("staffing.rota.days")}
      data-test="strip"
    >
      ${read.days.map(({ businessDay }) => {
        const counts = dayCounts(read, show, businessDay);
        const attention = counts.unfilled + counts.partly + counts.over > 0;
        return html`<button
          type="button"
          data-day=${businessDay}
          aria-pressed=${businessDay === this.day ? "true" : "false"}
          ?data-attention=${attention}
          ?data-closed=${isClosed(read, show, businessDay)}
          @click=${() => {
            this.day = businessDay;
          }}
        >
          <span>${dateFormat({ weekday: "short" }).format(utc(businessDay))}</span>
          <span class="date">${dateFormat({ day: "numeric" }).format(utc(businessDay))}</span>
          ${
            attention
              ? html`<span class="dot" aria-hidden="true"></span>
                  <span class="visually-hidden">${t("staffing.rota.needs_attention")}</span>`
              : nothing
          }
        </button>`;
      })}
    </div>`;
  }
  readonly #editShift = (e: CustomEvent<{ shiftId: string }>) => {
    this.editor = e.detail;
  };
  readonly #pickSlot = (e: CustomEvent<{ slot: Slot; anchor: HTMLElement }>) => {
    this.picked = e.detail.slot;
    this.#anchor = e.detail.anchor;
    this.actionError = "";
  };
  readonly #openDay = (
    e: CustomEvent<{ personId: string; businessDay: string; anchor: HTMLElement }>,
  ) => {
    const { personId, businessDay, anchor } = e.detail;
    const open = openSlots(this.read!, personId, businessDay);
    this.openDay = { personId, businessDay, offered: open.own.length + open.other.length > 0 };
    this.#anchor = anchor;
    this.actionError = "";
  };
  #grid(read: RotaWeek, show: Show) {
    const editable = this.canWrite && read.version?.status !== "published" && !this.busy;
    const breaches = this.warnings?.breaches ?? [];
    if (this.narrow)
      return html`<rota-day
        .week=${read}
        .show=${show}
        .businessDay=${this.day}
        .breaches=${breaches}
        .editable=${editable}
        .canAdd=${read.areas.length > 0}
        @edit-shift=${this.#editShift}
        @pick-slot=${this.#pickSlot}
        @open-day=${this.#openDay}
        @pointerdown=${(e: PointerEvent) => this.#swipeStart(e)}
      ></rota-day>`;
    if (show.kind === "everyone")
      return html`<rota-by-person
        .week=${read}
        .canAdd=${read.areas.length > 0}
        .breaches=${breaches}
        .editable=${editable}
        @edit-shift=${this.#editShift}
        @open-day=${this.#openDay}
      ></rota-by-person>`;
    if (rolesShown(read, show).length === 0 && !read.days.some((d) => d.notInSlot.length > 0))
      return nothing;
    return html`<rota-by-area
      .week=${read}
      .breaches=${breaches}
      .area=${show.area}
      .editable=${editable}
      @edit-shift=${this.#editShift}
      @add-shift=${(
        e: CustomEvent<{ businessDay: string; area: AreaRef; staffRoleId: string }>,
      ) => {
        this.editor = e.detail;
      }}
      @pick-slot=${this.#pickSlot}
    ></rota-by-area>`;
  }
  override render() {
    const read = this.read?.week === this.week ? this.read : undefined;
    const show = read ? chosenShow(read, this.params.area) : undefined;
    const attention = read && show ? this.#attention(read, show) : undefined;
    const published = read?.version?.status === "published";
    const action = read ? this.#action(read) : nothing;
    return html`<div class="head ${this.narrow ? "phone" : ""}" data-test="bar">
        <wt-button
          variant="secondary"
          data-test="previous-week"
          aria-label=${t("staffing.rota.previous")}
          @click=${() => this.#stepWeek(-7)}
          >‹</wt-button
        >
        ${fixedTitle(html`<h2 data-test="week">${this.#title(show)}</h2>`, titleCandidates())}
        <wt-button
          variant="secondary"
          data-test="next-week"
          aria-label=${t("staffing.rota.next")}
          @click=${() => this.#stepWeek(7)}
          >›</wt-button
        >
        ${
          read
            ? html`${this.narrow ? this.#strip(read, show!) : nothing}
                <wt-combobox
                  name="area"
                  label=${t("staffing.month.area")}
                  search="never"
                  .value=${show!.kind === "area" ? show!.key : EVERYONE}
                  .options=${[{ value: EVERYONE, label: t("staffing.rota.everyone") }, ...read.areas.map((a) => ({ value: areaKey(a.area), label: a.name }))]}
                  @wt-change=${(e: CustomEvent<{ value: string }>) => this.#go(this.week, e.detail.value)}
                ></wt-combobox>
                <div class="end">
                  <span class="state" data-test="state" ?data-published=${published}
                    >${t(published ? "staffing.rota.published" : "staffing.rota.draft")}</span
                  >
                  ${
                    !published && read.version?.changedSincePublished
                      ? html`<span class="note" data-test="still-published"
                          >${t("staffing.rota.still_published")}</span
                        >`
                      : nothing
                  }
                  <span class="attention" data-test="attention">${attention!.body}</span>
                  ${this.#labour()} ${this.narrow ? nothing : action}
                </div>`
            : nothing
        }
      </div>
      <span id="month-hint" class="visually-hidden">${t("staffing.rota.month_hint")}</span>
      <span class="visually-hidden" role="status" data-test="attention-status"
        >${attention?.words ?? ""}</span
      >
      ${this.swapNotice ? html`<p class="swap" role="status" data-test="swap-notice">${tf(this.swapNotice === 1 ? "staffing.rota.open_swap_one" : "staffing.rota.open_swaps", { count: String(this.swapNotice) })}</p>` : nothing}
      ${this.changingError ? html`<p role="alert">${this.changingError}</p>` : nothing}
      ${this.warningsError ? html`<p role="alert">${this.warningsError}</p>` : nothing}
      ${this.loadError ? html`<p class="error" role="alert" data-test="load-error">${this.loadError}</p>` : nothing}
      ${this.actionError && !this.#pick() ? html`<p class="error" role="alert" data-test="fill-error">${this.actionError}</p>` : nothing}
      ${
        read
          ? html`${read.areas.length === 0 ? html`<p>${t("staffing.rota.empty")}</p>` : nothing}
              ${
                show!.kind === "everyone" &&
                read.areas.length > 0 &&
                this.canWrite &&
                weekShiftCount(read) === 0
                  ? html`<p data-test="no-shifts-hint">
                      ${t(this.narrow ? "staffing.rota.no_shifts_hint_phone" : "staffing.rota.no_shifts_hint")}
                    </p>`
                  : nothing
              }
              ${show!.kind === "area" && !hasSlots(read, show!) ? this.#unpainted(read, show!) : nothing}
              ${this.#grid(read, show!)}
              <rota-popup
                .sheet=${this.narrow}
                .heading=${this.picked ? slotHeading(read, this.picked) : this.openDay ? openHeading(read, this.openDay.personId, this.openDay.businessDay) : ""}
                @rota-popup-close=${this.#popupClosed}
              >
                ${
                  this.picked
                    ? html`<slot-picker
                        .week=${read}
                        .pickedSlot=${this.picked}
                        .ruleset=${this.warnings?.ruleset ?? null}
                        .busy=${this.busy}
                        .error=${this.actionError}
                        .sheet=${this.narrow}
                        @choose=${(e: CustomEvent<{ personId: string }>) => void this.#fill(this.picked!, e.detail.personId)}
                        @close-picker=${() => {
                          this.picked = undefined;
                          this.actionError = "";
                        }}
                      ></slot-picker>`
                    : this.openDay
                      ? html`<rota-open-slots
                          .week=${read}
                          .personId=${this.openDay.personId}
                          .businessDay=${this.openDay.businessDay}
                          .busy=${this.busy}
                          .error=${this.actionError}
                          .sheet=${this.narrow}
                          @choose-slot=${(e: CustomEvent<{ slot: Slot }>) => void this.#fill(e.detail.slot, this.openDay!.personId)}
                          @another-shift=${(
                            e: CustomEvent<{ personId: string; businessDay: string }>,
                          ) => {
                            this.openDay = undefined;
                            this.editor = e.detail;
                          }}
                          @close-menu=${() => {
                            this.openDay = undefined;
                            this.actionError = "";
                          }}
                        ></rota-open-slots>`
                      : nothing
                }
              </rota-popup>`
          : this.loadError
            ? nothing
            : html`<p role="status">${t("staffing.rota.loading")}</p>`
      }
      ${
        read
          ? html`<rota-shift-dialog
              .open=${!!this.editor}
              .api=${this.api}
              .week=${read}
              .shiftId=${this.editor?.shiftId}
              .businessDay=${this.editor?.businessDay ?? ""}
              .personId=${this.editor?.personId ?? ""}
              .area=${this.editor?.area ? areaKey(this.editor.area) : ""}
              .staffRoleId=${this.editor?.staffRoleId ?? ""}
              @shift-close=${() => {
                this.editor = undefined;
              }}
              @shift-saved=${() => {
                this.editor = undefined;
                this.#watch();
              }}
            ></rota-shift-dialog>`
          : nothing
      }
      <rota-publish-dialog
        .open=${this.publishing}
        .week=${read}
        .breaches=${this.warnings?.breaches ?? []}
        .busy=${this.busy}
        .error=${this.publishError}
        @back=${() => {
          if (!this.busy) this.publishing = false;
        }}
        @publish=${() => void this.#publish()}
      ></rota-publish-dialog>
      ${this.narrow && action !== nothing ? html`<div class="foot" data-test="foot">${action}</div>` : nothing}`;
  }
}
