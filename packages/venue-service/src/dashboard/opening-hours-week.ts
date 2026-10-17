import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";
import { baseStyles, visuallyHiddenStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import { holidayDateName } from "../holiday-naming.js";
import type { LocalDate } from "../hours-types.js";
import { addDays } from "../hours-rules.js";
import type { OpeningHoursMonth } from "../opening-hours-calendar.js";
import { showPicker } from "./calendar-show.js";
import { formatDayHeading, formatWeekTitleParts } from "./hours-view.js";
import { monthNames, type MonthNames } from "./opening-hours-day.js";
import {
  FIRST_MONTH,
  LAST_MONTH,
  type CalendarDayOpen,
  type MonthDepartment,
} from "./opening-hours-month.js";
import { fixedTitle, fixedTitleStyles } from "./fixed-title.js";
import { scrollTargets, visibleTop } from "./flat-tree.js";
import { closedHatch, periodColourStyles } from "./period-colour-styles.js";
import { t, VENUE_SERVICE_STRINGS } from "./strings.js";
import { weekDates, weekDays, weekMonth, weekRows, type WeekRow } from "./week-rows.js";

type Day = OpeningHoursMonth["days"][number];

const RULER_STEP = 120;
/** How many steps apart the ruler's labels may be drawn, the closest that fits chosen. */
const RULER_SPACINGS = [1, 2, 3, 4, 6, 12];

type TitlePart = ReturnType<typeof formatWeekTitleParts>[number];

let widthCandidates: TemplateResult[] | undefined;
/** The titles of every week whose Monday falls in 2026, in each interface language. A candidate
 *  is shaped as the title is, its links inline-blocks; shaped otherwise, Chromium measured the
 *  Month's title a hair wider. */
function titleCandidates(): TemplateResult[] {
  if (!widthCandidates) {
    const parts: TitlePart[][] = [];
    for (const language of Object.keys(VENUE_SERVICE_STRINGS))
      for (let monday = "2026-01-05"; monday < "2027-01-01"; monday = addDays(monday, 7))
        parts.push(formatWeekTitleParts(monday, addDays(monday, 6), language));
    widthCandidates = parts.map(
      (title) =>
        html`${title.map((part) =>
          part.month || part.year ? html`<span class="title-link">${part.text}</span>` : part.text,
        )}`,
    );
  }
  return widthCandidates;
}

const TIP_EDGE = 8;
/** How long an unpinned tip outlasts the pointer leaving its block or itself: long enough for a
 *  path from any point of the block to reach the tip, which the bridge alone does not cover. */
const TIP_LEAVE_DELAY = 300;

/** Shows `tip` and places it in the same call, so it never paints where it was last: above
 *  `block` when it fits below the top of the area the block scrolls in, else below; its left lined
 *  up with the block's and kept inside the window's edges. */
function placeTip(tip: HTMLElement, block: HTMLElement): void {
  if (!tip.matches(":popover-open")) tip.showPopover();
  tip.style.left = "0px";
  tip.style.top = "0px";
  tip.style.maxWidth = `${window.innerWidth - 2 * TIP_EDGE}px`;
  const gap = parseFloat(getComputedStyle(tip).getPropertyValue("--wt-space-1"));
  const at = block.getBoundingClientRect();
  const size = tip.getBoundingClientRect();
  const above = at.top - gap - size.height;
  const fits = above >= visibleTop(block);
  tip.dataset.side = fits ? "above" : "below";
  tip.style.top = `${fits ? above : at.bottom + gap}px`;
  tip.style.left = `${Math.max(TIP_EDGE, Math.min(at.left, window.innerWidth - TIP_EDGE - size.width))}px`;
}

function clockText(cutover: string, minutes: number): string {
  const [h, m] = cutover.split(":").map(Number) as [number, number];
  const total = (h * 60 + m + minutes) % 1440;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** The Monday-to-Sunday week holding `date`, each day a section of rows with its hours drawn as
 *  blocks on one scale, the week's longest day. A day's name sends `calendar-day-open`; ‹ › send
 *  `week-change`, the title's months and years `week-month-open` and `week-year-open`, and Show
 *  `week-department-change`. */
@customElement("opening-hours-week")
export class OpeningHoursWeekView extends LitElement {
  static override styles = [
    baseStyles,
    periodColourStyles,
    fixedTitleStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      .head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
        margin-block-end: var(--wt-space-2);
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
      .hint {
        ${visuallyHiddenStyles}
      }
      .ruler,
      .row {
        display: grid;
        grid-template-columns: calc(var(--wt-tap-min) * 4) minmax(0, 1fr);
        column-gap: var(--wt-space-2);
        align-items: center;
      }
      .ruler {
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
        border-block-end: 1px solid var(--wt-color-border);
        padding-block-end: var(--wt-space-1);
      }
      .scale {
        position: relative;
        grid-column: 2;
        height: var(--wt-space-4);
      }
      .label {
        position: absolute;
        inset-block-start: 0;
        translate: -50% 0;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .label[data-thinned] {
        visibility: hidden;
      }
      section {
        padding-block: var(--wt-space-2);
        border-block-end: 1px solid var(--wt-color-border);
      }
      h3 {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: var(--wt-space-2);
        margin: 0 0 var(--wt-space-1);
        font-size: var(--wt-font-size-md);
      }
      .day-name {
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--wt-color-text);
        font: inherit;
        font-weight: var(--wt-font-weight-bold);
        cursor: pointer;
      }
      .day-name:focus-visible {
        outline: var(--wt-field-line-width-active) solid var(--wt-color-focus);
        outline-offset: var(--wt-focus-offset);
      }
      .name {
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
      }
      .name.special {
        color: var(--wt-color-palette-purple);
      }
      .name.holiday {
        color: var(--wt-color-palette-red);
      }
      .row {
        margin-block-start: var(--wt-space-1);
        font-size: var(--wt-font-size-sm);
      }
      .row-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--wt-color-text);
      }
      .row-name.strong {
        font-weight: var(--wt-font-weight-bold);
      }
      .spoken {
        ${visuallyHiddenStyles}
      }
      .lane {
        min-width: 0;
      }
      .track {
        position: relative;
        display: flex;
        align-items: center;
        height: calc(var(--wt-tap-min) / 2);
        padding-inline: var(--wt-space-1);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-border);
        color: var(--wt-color-text);
        overflow: hidden;
        white-space: nowrap;
      }
      .block {
        position: absolute;
        inset-block: 0;
        display: flex;
        align-items: center;
        padding-inline: var(--wt-space-1);
        overflow: hidden;
        background: var(--period-fill);
        color: var(--period-on-fill);
        font-weight: var(--wt-font-weight-bold);
      }
      .block[data-kind="closed"] {
        background: ${closedHatch};
        color: var(--wt-color-text);
      }
      .block[data-faded] {
        opacity: var(--wt-opacity-disabled);
      }
      .tip {
        position: fixed;
        inset: auto;
        margin: 0;
        overflow: visible;
        padding: var(--wt-space-1) var(--wt-space-2);
        border: 0;
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-text);
        color: var(--wt-color-bg);
        font-size: var(--wt-font-size-sm);
        overflow-wrap: anywhere;
      }
      /* Bridges the gap between the tip and its block, so the pointer crossing it never leaves
         both (WCAG 1.4.13). */
      .tip::before {
        content: "";
        position: absolute;
        inset-inline: 0;
        block-size: var(--wt-space-1);
      }
      .tip[data-side="above"]::before {
        inset-block-start: 100%;
      }
      .tip[data-side="below"]::before {
        inset-block-end: 100%;
      }
      .text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `,
  ];

  /** The read of `weekMonth(date)`. */
  @property({ attribute: false }) model?: OpeningHoursMonth;
  /** The shown date; the week holding it is drawn. */
  @property() date = "";
  /** The chosen department; "" draws every department. */
  @property() departmentId = "";
  @property({ attribute: false }) departments: readonly MonthDepartment[] = [];

  /** The block the tip was pinned to by a click or tap; leaving does not hide a pinned tip. */
  #pinned: HTMLElement | null = null;
  #shownFor: HTMLElement | null = null;
  #scrollTargets: EventTarget[] = [];
  #hideLater: ReturnType<typeof setTimeout> | undefined;
  #size = "";

  #tip(): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>('[data-test="block-tip"]');
  }

  #showTip(block: HTMLElement, label: string, pinned: boolean): void {
    const tip = this.#tip();
    if (!tip) return;
    this.#stayShown();
    tip.textContent = label;
    this.#shownFor = block;
    this.#pinned = pinned ? block : null;
    placeTip(tip, block);
    if (!this.#scrollTargets.length) {
      this.#scrollTargets = scrollTargets(block);
      for (const target of this.#scrollTargets)
        target.addEventListener("scroll", this.#onScroll, { capture: true, passive: true });
    }
  }

  #hideTip(): void {
    this.#stayShown();
    this.#pinned = null;
    this.#shownFor = null;
    for (const target of this.#scrollTargets.splice(0))
      target.removeEventListener("scroll", this.#onScroll, { capture: true });
    const tip = this.#tip();
    if (tip?.matches(":popover-open")) tip.hidePopover();
  }

  #leave(): void {
    if (this.#pinned || !this.#shownFor) return;
    clearTimeout(this.#hideLater);
    this.#hideLater = setTimeout(() => this.#hideTip(), TIP_LEAVE_DELAY);
  }

  #stayShown(): void {
    clearTimeout(this.#hideLater);
    this.#hideLater = undefined;
  }

  #onWindowClick = (event: MouseEvent): void => {
    if (!this.#shownFor) return;
    const path = event.composedPath();
    const tip = this.#tip();
    if (
      path.some(
        (node) =>
          node === tip ||
          (node instanceof HTMLElement &&
            node.classList.contains("block") &&
            this.renderRoot.contains(node)),
      )
    )
      return;
    this.#hideTip();
  };

  #onWindowKeydown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape" || !this.#shownFor) return;
    event.preventDefault();
    event.stopPropagation();
    this.#hideTip();
  };

  #onScroll = (): void => {
    if (this.#shownFor) this.#hideTip();
  };

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("model") || changed.has("date") || changed.has("departmentId")) this.#hideTip();
  }

  /** A change of size moves the blocks, so a shown tip is hidden as a scroll hides it. */
  #resizes = new ResizeObserver(([entry]) => {
    const size = `${entry!.contentRect.width}x${entry!.contentRect.height}`;
    if (this.#size && size !== this.#size) this.#hideTip();
    this.#size = size;
    this.#fitRuler();
  });

  override updated(): void {
    this.#fitRuler();
  }

  /** Leaves out labels until none is drawn over its neighbour: every step's label, else every
   *  second's, third's and so on; then the one before the last when the last, pulled back inside
   *  the track, would come within a gap of it. */
  #fitRuler(): void {
    const scale = this.renderRoot.querySelector<HTMLElement>(".scale");
    if (!scale) return;
    const labels = [...scale.querySelectorAll<HTMLElement>(".label")];
    const gap = parseFloat(getComputedStyle(scale).getPropertyValue("--wt-space-2"));
    const room = Math.max(...labels.map((label) => label.getBoundingClientRect().width)) + gap;
    const stepWidth = (RULER_STEP / Number(scale.dataset.longest)) * scale.clientWidth;
    const spacing =
      RULER_SPACINGS.find((steps) => steps * stepWidth >= room) ?? RULER_SPACINGS.at(-1)!;
    const kept = labels.filter((_, i) => i % spacing === 0);
    const [before, last] = kept.slice(-2);
    if (
      before &&
      last &&
      last.getBoundingClientRect().left - before.getBoundingClientRect().right < gap
    )
      kept.splice(-2, 1);
    for (const label of labels) label.toggleAttribute("data-thinned", !kept.includes(label));
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#resizes.observe(this);
    window.addEventListener("click", this.#onWindowClick);
    window.addEventListener("keydown", this.#onWindowKeydown, { capture: true });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#resizes.disconnect();
    window.removeEventListener("click", this.#onWindowClick);
    window.removeEventListener("keydown", this.#onWindowKeydown, { capture: true });
    this.#hideTip();
  }

  #emit<T>(name: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(name, { detail, bubbles: true, composed: true }));
  }

  #dayButton(date: LocalDate): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>(
      `[data-test="day-name"][data-date="${date}"]`,
    );
  }

  #chosen(model: OpeningHoursMonth): string {
    return model.days[0]!.departments.some((d) => d.departmentId === this.departmentId)
      ? this.departmentId
      : "";
  }

  override render() {
    if (!this.date) return nothing;
    const dates = weekDates(this.date);
    const step = (by: number, test: string, label: Parameters<typeof t>[0], glyph: string) => {
      const target = addDays(this.date, by);
      const month = weekMonth(target);
      const blocked = month < FIRST_MONTH || month > LAST_MONTH;
      return html`<wt-button
        variant="secondary"
        data-test=${test}
        aria-label=${t(label)}
        ?disabled=${blocked}
        @click=${() => {
          if (!blocked) this.#emit("week-change", { date: target });
        }}
        >${glyph}</wt-button
      >`;
    };
    const heading = html`${formatWeekTitleParts(dates[0]!, dates[6]!).map((part) => {
      const { month, year } = part;
      if (month)
        return html`<button
          type="button"
          class="title-link"
          data-test="week-month"
          data-month=${month}
          aria-describedby="month-hint"
          @click=${() => this.#emit("week-month-open", { month })}
        >
          ${part.text}
        </button>`;
      if (year)
        return html`<button
          type="button"
          class="title-link"
          data-test="week-year"
          data-year=${year}
          aria-describedby="year-hint"
          @click=${() => this.#emit("week-year-open", { year })}
        >
          ${part.text}
        </button>`;
      return part.text;
    })}`;
    const days = this.model ? weekDays(this.model, this.date) : undefined;
    return html`<div class="head">
        ${step(-7, "previous-week", "week.previous", "‹")}
        ${fixedTitle(html`<h2 data-test="week" aria-live="polite">${heading}</h2>`, titleCandidates())}
        ${step(7, "next-week", "week.next", "›")}
        ${days && this.model ? this.#show(this.model) : nothing}
      </div>
      <span id="month-hint" class="hint">${t("week.month_view_hint")}</span>
      <span id="year-hint" class="hint">${t("month.year_view_hint")}</span>
      ${days && this.model ? this.#week(this.model, days) : nothing}
      <div
        popover="manual"
        class="tip"
        data-test="block-tip"
        aria-hidden="true"
        @pointerenter=${() => this.#stayShown()}
        @pointerleave=${() => this.#leave()}
      ></div>`;
  }

  #show(model: OpeningHoursMonth) {
    return showPicker({
      model,
      chosen: this.#chosen(model),
      names: monthNames(this.departments),
      onDepartment: (departmentId) => this.#emit("week-department-change", { departmentId }),
    });
  }

  #week(model: OpeningHoursMonth, days: Day[]) {
    const chosen = this.#chosen(model);
    const names = monthNames(this.departments);
    const longest = Math.max(...days.map((day) => day.endMinute));
    const labels = Array.from(
      { length: Math.floor(longest / RULER_STEP) + 1 },
      (_, i) => i * RULER_STEP,
    );
    return html`<div class="ruler" aria-hidden="true">
        <div class="scale" data-longest=${longest}>
          ${labels.map(
            (minute) =>
              html`<span
                class="label"
                style=${styleMap({ left: `min(${(minute / longest) * 100}%, calc(100% - 2.5ch))` })}
                >${clockText(days[0]!.dayCutover, minute)}</span
              >`,
          )}
        </div>
      </div>
      ${days.map((day) => this.#day(day, chosen, names, longest))}`;
  }

  #day(day: Day, chosen: string, names: MonthNames, longest: number) {
    const holiday = holidayDateName(day.holidays, day.date, "");
    const special = day.specialDay?.name ?? "";
    const lines = [
      ...(special && special !== holiday ? [{ name: special, kind: "special" }] : []),
      ...(holiday ? [{ name: holiday, kind: "holiday" }] : []),
    ];
    return html`<section data-date=${day.date}>
      <h3>
        <button
          type="button"
          class="day-name"
          data-test="day-name"
          data-date=${day.date}
          @click=${() =>
            this.#emit<CalendarDayOpen>("calendar-day-open", {
              date: day.date,
              returnTo: () => this.#dayButton(day.date),
            })}
        >
          ${formatDayHeading(day.date)}
        </button>
        ${lines.map((line) => html`<span class="name ${line.kind}">${line.name}</span>`)}
      </h3>
      ${weekRows(day, chosen, names).map((row) => this.#row(row, day, names, longest))}
    </section>`;
  }

  #row(row: WeekRow, day: Day, names: MonthNames, longest: number) {
    const span = day.endMinute;
    return html`<div class="row" data-row=${row.key}>
      <span class="row-name ${row.zone ? "" : "strong"}" aria-hidden="true">${row.name}</span>
      <span class="spoken">${`${row.name}: ${row.words}`}</span>
      <div class="lane">
        <div
          class="track"
          aria-hidden="true"
          style=${styleMap({ width: `${(span / longest) * 100}%` })}
        >
          ${
            row.blocks.length
              ? row.blocks.map(
                  (block) =>
                    html`<span
                      class="block"
                      data-kind=${block.kind}
                      data-colour=${
                        (block.periodId && names.period(block.periodId).colour) || nothing
                      }
                      ?data-faded=${block.faded}
                      @pointerenter=${(event: PointerEvent) => {
                        if (event.pointerType === "mouse" && !this.#pinned)
                          this.#showTip(event.currentTarget as HTMLElement, block.label, false);
                      }}
                      @pointerleave=${() => this.#leave()}
                      @click=${(event: MouseEvent) => {
                        const target = event.currentTarget as HTMLElement;
                        if (this.#pinned === target) this.#hideTip();
                        else this.#showTip(target, block.label, true);
                      }}
                      style=${styleMap({
                        left: `${(block.start / span) * 100}%`,
                        width: `${((block.end - block.start) / span) * 100}%`,
                      })}
                      ><span class="text">${block.text}</span></span
                    >`,
                )
              : row.empty
          }
        </div>
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "opening-hours-week": OpeningHoursWeekView;
  }
}
