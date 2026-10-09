import { occursOn } from "../named-day-rules.js";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { codeOf } from "@waitron/dashboard-kit";
import {
  baseStyles,
  draftScopeFor,
  leaveCoordinatorFor,
  saveActionState,
  type DraftScope,
} from "@waitron/ui";
import type { MenuPeriodInput, MenuWeekDay, OpeningHoursModel } from "../menu-timetable-types.js";
import type { ClosedRange, ServiceRange } from "../service-day.js";
import { addDays, weekdayOf } from "../hours-rules.js";
import type { OpeningHoursApi } from "./opening-hours-client.js";
import type { GridBlockChange, GridBlockOpen, GridRangeSelection } from "./service-grid.js";
import type { RangeDialog } from "./range-dialog.js";
import type { PeriodEditor } from "./period-editor.js";
import type { NamedDaysModel } from "../holiday-types.js";
import type { NamedCalendarAction } from "./hours-calendar.js";
import { format, formatDate } from "./hours-view.js";
import { t } from "./strings.js";
import "./service-grid.js";
import "./range-dialog.js";
import "./period-editor.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-button.js";

type Department = OpeningHoursModel["departments"][number];
type Zone = Department["zones"][number];
type ClosedDay = { weekday: number; ranges: ClosedRange[] };
type Draft = { menus: Record<string, MenuWeekDay[]>; zones: Record<string, ClosedDay[]> };
type Opening = { department: Department; index?: number; input: ServiceRange };
const minuteOfServiceDay = (time: string, cutover: string) =>
  (Number(time.slice(0, 2)) * 60 +
    Number(time.slice(3)) -
    Number(cutover.slice(0, 2)) * 60 -
    Number(cutover.slice(3)) +
    1440) %
  1440;
export function businessDateToday(model: OpeningHoursModel): string {
  if (!model.clockReadable) return "";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: model.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date());
    const value = (type: string) => parts.find((part) => part.type === type)!.value;
    const date = `${value("year")}-${value("month")}-${value("day")}`;
    return `${value("hour")}:${value("minute")}` < model.dayCutover ? addDays(date, -1) : date;
  } catch {
    return "";
  }
}
const clone = (draft: Draft): Draft => structuredClone(draft);
const same = (a: readonly MenuWeekDay[], b: readonly MenuWeekDay[]) =>
  a.length === b.length &&
  a.every((day) => {
    const other = b.find((value) => value.weekday === day.weekday);
    return (
      !!other &&
      day.slots.length === other.slots.length &&
      day.slots.every((slot) =>
        other.slots.some(
          (value) =>
            value.periodId === slot.periodId &&
            value.startsAt === slot.startsAt &&
            value.endsAt === slot.endsAt,
        ),
      )
    );
  });
const sameClosed = (a: readonly ClosedDay[], b: readonly ClosedDay[]) =>
  a.length === b.length &&
  a.every((day) => {
    const other = b.find((value) => value.weekday === day.weekday);
    return (
      !!other &&
      day.ranges.length === other.ranges.length &&
      day.ranges.every((range) =>
        other.ranges.some(
          (value) => value.startsAt === range.startsAt && value.endsAt === range.endsAt,
        ),
      )
    );
  });
const equal = (a: Draft, b: Draft) =>
  Object.keys(a.menus).length === Object.keys(b.menus).length &&
  Object.keys(a.menus).every(
    (id) => b.menus[id] !== undefined && same(a.menus[id]!, b.menus[id]!),
  ) &&
  Object.keys(a.zones).length === Object.keys(b.zones).length &&
  Object.keys(a.zones).every(
    (id) => b.zones[id] !== undefined && sameClosed(a.zones[id]!, b.zones[id]!),
  );

@customElement("opening-hours-day")
export class OpeningHoursDay extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      .date-nav {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--wt-space-3);
        margin-block: var(--wt-space-4);
      }
      .date-nav p {
        margin: 0;
      }
      .note {
        font-weight: var(--wt-font-weight-normal);
      }
      .refusal {
        color: var(--wt-color-danger);
      }
      wt-form-actions {
        margin-block-start: var(--wt-space-4);
      }
    `,
  ];
  @property({ attribute: false }) api!: OpeningHoursApi;
  @property({ attribute: false }) model!: OpeningHoursModel;
  @property({ type: Boolean }) readOnly = false;
  @state() private date = "";
  @state() private draft: Draft = { menus: {}, zones: {} };
  @state() private opening?: Opening;
  @state() private periodOpening?: { range: Opening };
  @state() private created: Record<string, Department["periods"][number][]> = {};
  @state() private saving = false;
  @state() private creating = false;
  @state() private error = "";
  @state() private errorDepartment = "";
  @state() private skippedTime = false;
  @state() private offsetClash = false;
  @state() private zoneOpening?: { zone: Zone; index: number; input: ClosedRange };
  @state() private errorZone = "";
  @state() private calendar?: NamedDaysModel;
  @state() private calendarError = false;
  private calendarDate = "";
  private detachCalendar?: () => void;
  private scope?: DraftScope<Draft>;
  private baseline: Draft = { menus: {}, zones: {} };
  private source?: OpeningHoursModel;
  private contextDepartments: readonly Department[] = [];
  private contextSpecial?: OpeningHoursModel["namedDays"][number];
  private generation = {};
  override connectedCallback() {
    super.connectedCallback();
    this.requestUpdate();
  }
  override disconnectedCallback() {
    this.detachCalendar?.();
    this.calendarDate = "";
    this.scope?.dispose();
    this.scope = undefined;
    this.generation = {};
    super.disconnectedCallback();
  }
  protected override willUpdate() {
    if (!this.date && this.model.clockReadable) this.date = businessDateToday(this.model);
    if (!this.source) {
      this.draft = this.seed();
      this.baseline = clone(this.draft);
      this.source = this.model;
    }
    this.registerScope();
    if (this.source !== this.model) {
      if (
        (this.scope ? saveActionState(this.scope).unchanged : equal(this.draft, this.baseline)) &&
        !this.saving
      ) {
        this.draft = this.seed();
        this.baseline = clone(this.draft);
        this.scope?.commit(this.baseline);
      }
      this.source = this.model;
    }
    this.watchCalendar();
  }
  private registerScope() {
    if (this.isConnected && !this.scope) {
      this.scope = draftScopeFor(this, {
        id: this,
        current: () => this.draft,
        snapshot: clone,
        equal,
        restore: (draft) => {
          this.draft = clone(draft);
        },
      }).scope;
      this.scope.commit(this.baseline);
    }
  }
  private departments() {
    return this.contextDepartments;
  }
  private special() {
    return this.contextSpecial;
  }
  private seed(): Draft {
    this.contextDepartments = structuredClone(
      this.model.departments.filter((department) => department.active),
    );
    this.contextSpecial = this.model.namedDays.find((special) => occursOn(special, this.date));
    if (this.contextSpecial) this.contextSpecial = { ...this.contextSpecial };
    if (!this.date) return { menus: {}, zones: {} };
    const special = this.special(),
      weekday = weekdayOf(this.date);
    const menus = Object.fromEntries(
      this.departments().map((department) => {
        const days: MenuWeekDay[] = Array.from({ length: 7 }, (_, day) => ({
          weekday: day,
          slots: (department.week.find((row) => row.weekday === day)?.slots ?? []).map((slot) => ({
            ...slot,
          })),
        }));
        const own =
          special?.ownHours && department.dates.find((row) => row.specialDateId === special.id);
        if (own) days[weekday]!.slots = own.slots.map((slot) => ({ ...slot }));
        return [department.id, days];
      }),
    );
    const zones = Object.fromEntries(
      this.departments().flatMap((department) =>
        (department.zones ?? []).map((zone) => [
          zone.id,
          Array.from({ length: 7 }, (_, day) => ({
            weekday: day,
            ranges: (special?.ownHours && day === weekday
              ? (zone.dates.find((row) => row.specialDateId === special.id)?.ranges ?? [])
              : (zone.week.find((row) => row.weekday === day)?.ranges ?? [])
            ).map((range) => ({ ...range })),
          })),
        ]),
      ),
    );
    return { menus, zones };
  }
  private watchCalendar() {
    if (!this.isConnected || !this.date || this.calendarDate === this.date) return;
    this.detachCalendar?.();
    const date = this.date;
    this.calendarDate = date;
    this.calendar = undefined;
    this.calendarError = false;
    this.detachCalendar = this.api.namedDays.watchNamedDays(
      date,
      date,
      (model) => {
        if (this.isConnected && this.calendarDate === date) {
          this.calendar = model;
          this.calendarError = false;
        }
      },
      () => {
        if (this.isConnected && this.calendarDate === date) this.calendarError = true;
      },
      () => {
        if (this.isConnected && this.calendarDate === date) this.calendarError = false;
      },
    );
  }
  private editable() {
    return (
      this.isConnected &&
      !this.readOnly &&
      !this.saving &&
      !this.creating &&
      !this.special()?.closeWholeVenue
    );
  }
  private slots(id: string) {
    return this.draft.menus[id]?.[weekdayOf(this.date)]?.slots ?? [];
  }
  private periods(department: Department) {
    return [
      ...department.periods,
      ...(this.created[department.id] ?? []).filter(
        (period) => !department.periods.some((saved) => saved.id === period.id),
      ),
    ];
  }
  private stage(id: string, slots: readonly ServiceRange[]) {
    this.draft = {
      ...this.draft,
      menus: {
        ...this.draft.menus,
        [id]: this.draft.menus[id]!.map((day) =>
          day.weekday === weekdayOf(this.date)
            ? { weekday: day.weekday, slots: slots.map((slot) => ({ ...slot })) }
            : day,
        ),
      },
    };
    this.error = "";
    this.errorDepartment = "";
    this.errorZone = "";
    this.scope?.changed();
  }
  private async stepDate(delta: number) {
    if (
      !this.isConnected ||
      this.saving ||
      this.opening ||
      this.zoneOpening ||
      !this.date ||
      addDays(this.date, delta) < businessDateToday(this.model)
    )
      return;
    const generation = this.generation,
      date = this.date;
    const proceed = () => {
      if (!this.isConnected || generation !== this.generation || this.date !== date) return;
      this.date = addDays(date, delta);
      this.draft = this.seed();
      this.baseline = clone(this.draft);
      this.scope?.commit(this.baseline);
      this.error = "";
      this.errorDepartment = "";
      this.errorZone = "";
    };
    const coordinator = leaveCoordinatorFor(this);
    if (coordinator) await coordinator.request({ scopes: "all", reason: "navigation", proceed });
    else proceed();
  }
  private openRange(event: CustomEvent<GridRangeSelection | GridBlockOpen>) {
    event.stopPropagation();
    if (!this.editable() || this.opening || this.zoneOpening) return;
    const department = this.departments().find((row) => row.id === event.detail.columnKey);
    if (!department || !this.draft.menus[department.id]) return;
    if ("index" in event.detail) {
      const slot = this.slots(department.id)[event.detail.index];
      if (slot) this.opening = { department, index: event.detail.index, input: { ...slot } };
    } else
      this.opening = {
        department,
        input: { periodId: "", startsAt: event.detail.startsAt, endsAt: event.detail.endsAt },
      };
  }
  private resize(event: CustomEvent<GridBlockChange>) {
    event.stopPropagation();
    if (!this.editable() || this.opening || this.zoneOpening) return;
    const { columnKey, index, startsAt, endsAt } = event.detail;
    if (!this.departments().some((row) => row.id === columnKey) || !this.slots(columnKey)[index])
      return;
    this.stage(
      columnKey,
      this.slots(columnKey).map((slot, i) => (i === index ? { ...slot, startsAt, endsAt } : slot)),
    );
  }
  private closedRanges(id: string) {
    return this.draft.zones[id]?.[weekdayOf(this.date)]?.ranges ?? [];
  }
  private zone(id: string) {
    return this.departments()
      .flatMap((department) => department.zones ?? [])
      .find((zone) => `zone:${zone.id}` === id);
  }
  private stageZone(id: string, ranges: readonly ClosedRange[]) {
    this.draft = {
      ...this.draft,
      zones: {
        ...this.draft.zones,
        [id]: this.draft.zones[id]!.map((day) =>
          day.weekday === weekdayOf(this.date)
            ? {
                weekday: day.weekday,
                ranges: ranges
                  .map(({ startsAt, endsAt }) => ({ startsAt, endsAt }))
                  .sort(
                    (a, b) =>
                      minuteOfServiceDay(a.startsAt, this.model.dayCutover) -
                      minuteOfServiceDay(b.startsAt, this.model.dayCutover),
                  ),
              }
            : day,
        ),
      },
    };
    this.error = "";
    this.errorZone = "";
    this.errorDepartment = "";
    this.scope?.changed();
  }
  private selectRange(event: CustomEvent<GridRangeSelection>) {
    const zone = this.zone(event.detail.columnKey);
    if (!zone) {
      this.openRange(event);
      return;
    }
    event.stopPropagation();
    if (!this.editable() || this.opening || this.zoneOpening) return;
    this.stageZone(zone.id, [
      ...this.closedRanges(zone.id),
      { startsAt: event.detail.startsAt, endsAt: event.detail.endsAt },
    ]);
  }
  private openBlock(event: CustomEvent<GridBlockOpen>) {
    const zone = this.zone(event.detail.columnKey);
    if (!zone) {
      this.openRange(event);
      return;
    }
    event.stopPropagation();
    if (!this.editable() || this.opening || this.zoneOpening) return;
    const input = this.closedRanges(zone.id)[event.detail.index];
    if (input) this.zoneOpening = { zone, index: event.detail.index, input: { ...input } };
  }
  private changeBlock(event: CustomEvent<GridBlockChange>) {
    const zone = this.zone(event.detail.columnKey);
    if (!zone) {
      this.resize(event);
      return;
    }
    event.stopPropagation();
    if (
      !this.editable() ||
      this.opening ||
      this.zoneOpening ||
      !this.closedRanges(zone.id)[event.detail.index]
    )
      return;
    this.stageZone(
      zone.id,
      this.closedRanges(zone.id).map((range, index) =>
        index === event.detail.index
          ? { startsAt: event.detail.startsAt, endsAt: event.detail.endsAt }
          : range,
      ),
    );
  }
  private currentZone(
    opening: NonNullable<OpeningHoursDay["zoneOpening"]>,
    target: EventTarget | null,
  ) {
    return (
      this.editable() &&
      this.zoneOpening === opening &&
      target === this.shadowRoot?.querySelector("range-dialog")
    );
  }
  private currentRange(opening: Opening, target: EventTarget | null) {
    return (
      this.editable() &&
      this.opening === opening &&
      !this.periodOpening &&
      target === this.shadowRoot?.querySelector("range-dialog")
    );
  }
  private applyRange(event: CustomEvent<{ input: ServiceRange }>, opening: Opening) {
    event.stopPropagation();
    if (!this.currentRange(opening, event.currentTarget)) return;
    const slots = this.slots(opening.department.id).map((slot) => ({ ...slot }));
    if (opening.index === undefined) slots.push({ ...event.detail.input });
    else slots[opening.index] = { ...event.detail.input };
    slots.sort(
      (a, b) =>
        minuteOfServiceDay(a.startsAt, this.model.dayCutover) -
        minuteOfServiceDay(b.startsAt, this.model.dayCutover),
    );
    this.stage(opening.department.id, slots);
    this.opening = undefined;
  }
  private deleteRange(event: Event, opening: Opening) {
    event.stopPropagation();
    if (!this.currentRange(opening, event.currentTarget) || opening.index === undefined) return;
    this.stage(
      opening.department.id,
      this.slots(opening.department.id).filter((_, i) => i !== opening.index),
    );
    this.opening = undefined;
  }
  private async save() {
    if (
      !this.editable() ||
      this.opening ||
      this.zoneOpening ||
      saveActionState(this.scope).unchanged
    )
      return;
    const submitted = clone(this.draft),
      generation = this.generation,
      special = this.special(),
      weekday = weekdayOf(this.date);
    this.saving = true;
    this.error = "";
    this.errorDepartment = "";
    this.errorZone = "";
    this.skippedTime = false;
    this.offsetClash = false;
    try {
      for (const department of this.departments()) {
        const days = submitted.menus[department.id];
        if (!days || same(days, this.baseline.menus[department.id] ?? [])) continue;
        try {
          if (special?.ownHours)
            await this.api.saveDateMenus(special.id, department.id, days[weekday]!.slots);
          else await this.api.saveWeek(department.id, days);
        } catch (error) {
          if (generation !== this.generation || !this.isConnected) return;
          this.error = t("menu.save_error");
          const field = (error as { params?: { field?: unknown } })?.params?.field;
          if (
            codeOf(error) === "menu_timetable.invalid" &&
            typeof field === "string" &&
            (special?.ownHours
              ? /^(?:slots(?:\.|$)|date$)/.test(field)
              : new RegExp(`^days\\.${weekday}(?:\\.|$)`).test(field))
          ) {
            this.errorDepartment = department.id;
            this.offsetClash =
              (error as { params?: { reason?: unknown } }).params?.reason === "end_offset";
            this.skippedTime =
              (error as { params?: { reason?: unknown } }).params?.reason === "clock_skips";
          }
          return;
        }
        if (generation !== this.generation || !this.isConnected) return;
        // Each route commits one department; a later refusal must not resend successful writes.
        this.baseline = {
          ...this.baseline,
          menus: { ...this.baseline.menus, [department.id]: days },
        };
        this.scope?.commit(this.baseline);
      }
      for (const department of this.departments())
        for (const zone of department.zones ?? []) {
          const days = submitted.zones[zone.id];
          if (!days || sameClosed(days, this.baseline.zones[zone.id] ?? [])) continue;
          try {
            if (special?.ownHours)
              await this.api.saveZoneDate(special.id, zone.id, days[weekday]!.ranges);
            else await this.api.saveZoneWeek(zone.id, days);
          } catch (error) {
            if (generation !== this.generation || !this.isConnected) return;
            const invalid = codeOf(error) === "zone_closed_time.invalid";
            this.error = t(
              codeOf(error) === "special_date.keeps_week"
                ? "opening.keeps_week"
                : invalid
                  ? "opening.closed_invalid"
                  : "menu.save_error",
            );
            const field = (error as { params?: { field?: unknown } })?.params?.field;
            if (
              invalid &&
              typeof field === "string" &&
              (special?.ownHours
                ? /^(?:ranges(?:\.|$)|specialDateId$)/.test(field)
                : new RegExp(`^days\\.${weekday}(?:\\.|$)`).test(field))
            )
              this.errorZone = zone.id;
            return;
          }
          if (generation !== this.generation || !this.isConnected) return;
          // Each route commits one zone; a later refusal must not resend successful writes.
          this.baseline = { ...this.baseline, zones: { ...this.baseline.zones, [zone.id]: days } };
          this.scope?.commit(this.baseline);
        }
      this.api.rereadWatches();
    } finally {
      this.saving = false;
    }
  }
  private async savePeriod(
    event: CustomEvent<{ input: MenuPeriodInput }>,
    child: { range: Opening },
  ) {
    event.stopPropagation();
    const component = event.currentTarget as PeriodEditor;
    if (
      !this.editable() ||
      this.periodOpening !== child ||
      this.opening !== child.range ||
      component !== this.shadowRoot?.querySelector("period-editor")
    )
      return;
    const generation = this.generation,
      { input } = event.detail,
      department = child.range.department;
    this.creating = true;
    component.refusal = undefined;
    try {
      const { id } = await this.api.createPeriod(department.id, input);
      if (
        generation !== this.generation ||
        !this.isConnected ||
        this.periodOpening !== child ||
        this.opening !== child.range
      )
        return;
      this.created = {
        ...this.created,
        [department.id]: [
          ...(this.created[department.id] ?? []),
          {
            id,
            name: input.name,
            colour: input.colour ?? "blue",
            menuId: input.menuId,
            staffMenuIds: [...input.staffMenuIds],
            endOffsetMinutes: input.endOffsetMinutes ?? 0,
            weekdays: [],
          },
        ],
      };
      if (component.commitSubmitted(input)) this.periodOpening = undefined;
      await this.updateComplete;
      const range = this.shadowRoot?.querySelector<RangeDialog>("range-dialog");
      await range?.updateComplete;
      if (this.opening === child.range) range?.choosePeriod(id);
      this.api.rereadWatches();
    } catch (error) {
      if (generation === this.generation && this.isConnected && this.periodOpening === child)
        component.refusal = {
          code: codeOf(error),
          params: (error as { params?: Record<string, unknown> })?.params,
        };
    } finally {
      this.creating = false;
    }
  }
  override render() {
    if (!this.date) return html`<p>${t("opening.clock_unreadable")}</p>`;
    const opening = this.opening,
      child = this.periodOpening,
      special = this.special(),
      state = saveActionState(this.scope),
      closed = special?.closeWholeVenue,
      zoneOpening = this.zoneOpening,
      blocked = this.readOnly || this.saving || !!opening || !!zoneOpening;
    return html`<div class="date-nav">
        <wt-button
          variant="secondary"
          data-test="previous-day"
          aria-label=${t("opening.previous_day")}
          ?disabled=${this.saving || !!opening || !!zoneOpening || this.date <= businessDateToday(this.model)}
          @click=${() => this.stepDate(-1)}
          >‹</wt-button
        >
        <p data-test="day-date">
          ${formatDate(this.date)}${special ? ` · ${special.name}` : nothing}
        </p>
        <wt-button
          variant="secondary"
          data-test="next-day"
          aria-label=${t("opening.next_day")}
          ?disabled=${this.saving || !!opening || !!zoneOpening}
          @click=${() => this.stepDate(1)}
          >›</wt-button
        >
      </div>
      ${
        closed
          ? html`<p>${t("hours.closed")}</p>`
          : !special?.ownHours && !this.readOnly
            ? html`<wt-button
                data-test="own-date"
                variant="secondary"
                ?disabled=${blocked || !this.calendar || this.calendarError}
                @click=${(event: Event) => {
                  if (
                    !this.editable() ||
                    this.opening ||
                    this.zoneOpening ||
                    !this.calendar ||
                    this.calendarError
                  )
                    return;
                  const button = event.currentTarget as HTMLElement;
                  this.dispatchEvent(
                    new CustomEvent<NamedCalendarAction>("named-calendar-action", {
                      detail: {
                        kind: "own",
                        date: this.date,
                        day: special,
                        holidays:
                          this.calendar.days?.find((day) => day.date === this.date)?.holidays ?? [],
                        returnTo: () => (button.isConnected ? button : null),
                      },
                      bubbles: true,
                      composed: true,
                    }),
                  );
                }}
                >${t("named.give_own")}</wt-button
              >`
            : nothing
      }
      ${this.calendarError ? html`<p class="refusal">${t("opening.load_error")}</p>` : nothing}
      ${closed || special?.ownHours ? nothing : html`<p class="note">${format("opening.changes_weekday", { weekday: t(`hours.day_in_sentence.${weekdayOf(this.date)}` as Parameters<typeof t>[0]) })}</p>`}
      ${
        this.departments().length
          ? html`<service-grid
              .dayCutover=${this.model.dayCutover}
              .columns=${this.departments().flatMap((department) => [{ key: department.id, label: department.name, slots: closed ? [] : this.slots(department.id), periods: this.periods(department), editable: !closed && !blocked }, ...(department.zones ?? []).map((zone) => ({ key: `zone:${zone.id}`, label: zone.name, slots: closed ? [] : this.slots(department.id), periods: this.periods(department), layer: "closed" as const, narrow: true, closed: closed ? [] : this.closedRanges(zone.id), editable: !closed && !blocked }))])}
              @grid-range-select=${this.selectRange}
              @grid-block-open=${this.openBlock}
              @grid-block-change=${this.changeBlock}
            >
              ${this.errorZone ? html`<p slot=${`header-zone:${this.errorZone}`} class="refusal" data-zone-error=${this.errorZone}>${this.error}</p>` : nothing}
              ${this.errorDepartment ? html`<p slot=${`header-${this.errorDepartment}`} class="refusal" data-department-error=${this.errorDepartment}>${t(this.skippedTime ? "menu.time_skipped" : this.offsetClash ? "menu.offset_timetable" : "opening.check_day")}</p>` : nothing}
            </service-grid>`
          : html`<p>${t("menu.no_departments")}</p>`
      }
      ${closed || this.readOnly || !this.departments().length ? nothing : html`<wt-form-actions .error=${this.errorDepartment || this.errorZone ? t("menu.fix_fields") : this.error}><wt-button data-test="save-day" variant=${state.variant} ?disabled=${state.unchanged || this.saving || !!opening || !!zoneOpening} @click=${() => this.save()}>${t("menu.save")}</wt-button></wt-form-actions>`}
      ${
        zoneOpening
          ? keyed(
              zoneOpening,
              html`<range-dialog
                .open=${true}
                .closedTimes=${true}
                .range=${zoneOpening.input}
                .businessDate=${special?.ownHours ? this.date : undefined}
                .dayCutover=${this.model.dayCutover}
                .occupied=${this.closedRanges(zoneOpening.zone.id).filter((_, index) => index !== zoneOpening.index)}
                .deletable=${true}
                @range-save=${(event: CustomEvent<{ input: ClosedRange }>) => {
                  event.stopPropagation();
                  if (!this.currentZone(zoneOpening, event.currentTarget)) return;
                  this.stageZone(
                    zoneOpening.zone.id,
                    this.closedRanges(zoneOpening.zone.id).map((range, index) =>
                      index === zoneOpening.index ? event.detail.input : range,
                    ),
                  );
                  this.zoneOpening = undefined;
                }}
                @range-delete=${(event: Event) => {
                  event.stopPropagation();
                  if (!this.currentZone(zoneOpening, event.currentTarget)) return;
                  this.stageZone(
                    zoneOpening.zone.id,
                    this.closedRanges(zoneOpening.zone.id).filter(
                      (_, index) => index !== zoneOpening.index,
                    ),
                  );
                  this.zoneOpening = undefined;
                }}
                @range-close=${(event: Event) => {
                  event.stopPropagation();
                  if (this.currentZone(zoneOpening, event.currentTarget))
                    this.zoneOpening = undefined;
                }}
              ></range-dialog>`,
            )
          : nothing
      }
      ${
        opening
          ? keyed(
              opening,
              html`<range-dialog
                .open=${true}
                .range=${opening.input}
                .periods=${this.periods(opening.department)}
                .dayCutover=${this.model.dayCutover}
                .businessDate=${special?.ownHours ? this.date : undefined}
                .timeZone=${this.model.clockReadable ? this.model.timeZone : undefined}
                .occupied=${this.slots(opening.department.id).filter((_, index) => index !== opening.index)}
                .deletable=${opening.index !== undefined}
                .busy=${!!child || this.creating}
                @range-save=${(event: CustomEvent<{ input: ServiceRange }>) => this.applyRange(event, opening)}
                @range-delete=${(event: Event) => this.deleteRange(event, opening)}
                @range-close=${(event: Event) => {
                  event.stopPropagation();
                  if (this.currentRange(opening, event.currentTarget)) this.opening = undefined;
                }}
                @range-new-period=${(event: Event) => {
                  event.stopPropagation();
                  if (this.currentRange(opening, event.currentTarget))
                    this.periodOpening = { range: opening };
                }}
              ></range-dialog>`,
            )
          : nothing
      }
      ${
        child
          ? keyed(
              child,
              html`<period-editor
                .open=${true}
                .departmentName=${child.range.department.name}
                .menus=${this.model.menus}
                .usedColours=${this.periods(child.range.department).map((period) => period.colour)}
                .busy=${this.creating}
                @period-save=${(event: CustomEvent<{ input: MenuPeriodInput }>) => this.savePeriod(event, child)}
                @period-close=${(event: Event) => {
                  event.stopPropagation();
                  if (this.isConnected && !this.creating && this.periodOpening === child)
                    this.periodOpening = undefined;
                }}
              ></period-editor>`,
            )
          : nothing
      }`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "opening-hours-day": OpeningHoursDay;
  }
}
