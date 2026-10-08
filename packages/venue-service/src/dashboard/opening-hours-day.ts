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
import type { ServiceRange } from "../service-day.js";
import { addDays, weekdayOf } from "../hours-rules.js";
import type { OpeningHoursApi } from "./opening-hours-client.js";
import type { GridBlockChange, GridBlockOpen, GridRangeSelection } from "./service-grid.js";
import type { RangeDialog } from "./range-dialog.js";
import type { PeriodEditor } from "./period-editor.js";
import { format, formatDate } from "./hours-view.js";
import { t } from "./strings.js";
import "./service-grid.js";
import "./range-dialog.js";
import "./period-editor.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-button.js";

type Department = OpeningHoursModel["departments"][number];
type Draft = Record<string, MenuWeekDay[]>;
type Opening = { department: Department; index?: number; input: ServiceRange };
const minuteOfServiceDay = (time: string, cutover: string) =>
  (Number(time.slice(0, 2)) * 60 +
    Number(time.slice(3)) -
    Number(cutover.slice(0, 2)) * 60 -
    Number(cutover.slice(3)) +
    1440) %
  1440;
function today(model: OpeningHoursModel): string {
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
const equal = (a: Draft, b: Draft) =>
  Object.keys(a).length === Object.keys(b).length &&
  Object.keys(a).every((id) => b[id] !== undefined && same(a[id]!, b[id]!));

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
  @state() private draft: Draft = {};
  @state() private opening?: Opening;
  @state() private periodOpening?: { range: Opening };
  @state() private created: Record<string, Department["periods"][number][]> = {};
  @state() private saving = false;
  @state() private creating = false;
  @state() private error = "";
  @state() private errorDepartment = "";
  @state() private skippedTime = false;
  @state() private offsetClash = false;
  private scope?: DraftScope<Draft>;
  private baseline: Draft = {};
  private source?: OpeningHoursModel;
  private contextDepartments: readonly Department[] = [];
  private contextSpecial?: OpeningHoursModel["specialDates"][number];
  private generation = {};
  override connectedCallback() {
    super.connectedCallback();
    this.requestUpdate();
  }
  override disconnectedCallback() {
    this.scope?.dispose();
    this.scope = undefined;
    this.generation = {};
    super.disconnectedCallback();
  }
  protected override willUpdate() {
    if (!this.date && this.model.clockReadable) this.date = today(this.model);
    if (!this.source) {
      this.draft = this.seed();
      this.baseline = clone(this.draft);
      this.source = this.model;
    } else if (this.source !== this.model) {
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
    this.contextDepartments = this.model.departments.filter((department) => department.active);
    this.contextSpecial = this.model.specialDates.find((special) => special.date === this.date);
    if (!this.date) return {};
    const special = this.special(),
      weekday = weekdayOf(this.date);
    return Object.fromEntries(
      this.departments().map((department) => {
        const days: MenuWeekDay[] = Array.from({ length: 7 }, (_, day) => ({
          weekday: day,
          slots: (department.week.find((row) => row.weekday === day)?.slots ?? []).map((slot) => ({
            ...slot,
          })),
        }));
        const own = special && department.dates.find((row) => row.specialDateId === special.id);
        if (own) days[weekday]!.slots = own.slots.map((slot) => ({ ...slot }));
        return [department.id, days];
      }),
    );
  }
  private editable() {
    return this.isConnected && !this.readOnly && !this.saving && !this.creating;
  }
  private slots(id: string) {
    return this.draft[id]?.[weekdayOf(this.date)]?.slots ?? [];
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
      [id]: this.draft[id]!.map((day) =>
        day.weekday === weekdayOf(this.date)
          ? { weekday: day.weekday, slots: slots.map((slot) => ({ ...slot })) }
          : day,
      ),
    };
    this.error = "";
    this.errorDepartment = "";
    this.scope?.changed();
  }
  private async stepDate(delta: number) {
    if (!this.isConnected || this.saving || this.opening || !this.date) return;
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
    };
    const coordinator = leaveCoordinatorFor(this);
    if (coordinator) await coordinator.request({ scopes: "all", reason: "navigation", proceed });
    else proceed();
  }
  private openRange(event: CustomEvent<GridRangeSelection | GridBlockOpen>) {
    event.stopPropagation();
    if (!this.editable() || this.opening) return;
    const department = this.departments().find((row) => row.id === event.detail.columnKey);
    if (!department || !this.draft[department.id]) return;
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
    if (!this.editable() || this.opening) return;
    const { columnKey, index, startsAt, endsAt } = event.detail;
    if (!this.departments().some((row) => row.id === columnKey) || !this.slots(columnKey)[index])
      return;
    this.stage(
      columnKey,
      this.slots(columnKey).map((slot, i) => (i === index ? { ...slot, startsAt, endsAt } : slot)),
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
    if (!this.editable() || this.opening || saveActionState(this.scope).unchanged) return;
    const submitted = clone(this.draft),
      generation = this.generation,
      special = this.special(),
      weekday = weekdayOf(this.date);
    this.saving = true;
    this.error = "";
    this.errorDepartment = "";
    this.skippedTime = false;
    this.offsetClash = false;
    try {
      for (const department of this.departments()) {
        const days = submitted[department.id];
        if (!days || same(days, this.baseline[department.id] ?? [])) continue;
        try {
          if (special)
            await this.api.saveDateMenus(special.id, department.id, days[weekday]!.slots);
          else await this.api.saveWeek(department.id, days);
        } catch (error) {
          if (generation !== this.generation || !this.isConnected) return;
          this.error = t("menu.save_error");
          const field = (error as { params?: { field?: unknown } })?.params?.field;
          if (
            codeOf(error) === "menu_timetable.invalid" &&
            typeof field === "string" &&
            (special
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
        this.baseline = { ...this.baseline, [department.id]: days };
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
      state = saveActionState(this.scope);
    return html`<div class="date-nav">
        <wt-button
          variant="secondary"
          data-test="previous-day"
          aria-label=${t("opening.previous_day")}
          ?disabled=${this.saving || !!opening}
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
          ?disabled=${this.saving || !!opening}
          @click=${() => this.stepDate(1)}
          >›</wt-button
        >
      </div>
      ${special ? nothing : html`<p class="note">${format("opening.changes_weekday", { weekday: t(`hours.day_in_sentence.${weekdayOf(this.date)}` as Parameters<typeof t>[0]) })}</p>`}
      ${
        this.departments().length
          ? html`<service-grid
              .dayCutover=${this.model.dayCutover}
              .columns=${this.departments().map((department) => ({ key: department.id, label: department.name, slots: this.slots(department.id), periods: this.periods(department), editable: !this.readOnly && !this.saving && !opening }))}
              @grid-range-select=${this.openRange}
              @grid-block-open=${this.openRange}
              @grid-block-change=${this.resize}
            >
              ${this.errorDepartment ? html`<p slot=${`header-${this.errorDepartment}`} class="refusal" data-department-error=${this.errorDepartment}>${t(this.skippedTime ? "menu.time_skipped" : this.offsetClash ? "menu.offset_timetable" : "opening.check_day")}</p>` : nothing}
            </service-grid>`
          : html`<p>${t("menu.no_departments")}</p>`
      }
      ${this.readOnly || !this.departments().length ? nothing : html`<wt-form-actions .error=${this.errorDepartment ? t("menu.fix_fields") : this.error}><wt-button data-test="save-day" variant=${state.variant} ?disabled=${state.unchanged || this.saving || !!opening} @click=${() => this.save()}>${t("menu.save")}</wt-button></wt-form-actions>`}
      ${
        opening
          ? keyed(
              opening,
              html`<range-dialog
                .open=${true}
                .range=${opening.input}
                .periods=${this.periods(opening.department)}
                .dayCutover=${this.model.dayCutover}
                .businessDate=${special?.date}
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
