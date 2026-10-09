import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { codeOf } from "@waitron/dashboard-kit";
import { baseStyles, draftScopeFor, saveActionState, type DraftScope } from "@waitron/ui";
import type { MenuPeriodInput, MenuWeekDay, OpeningHoursModel } from "../menu-timetable-types.js";
import type { ServiceRange } from "../service-day.js";
import type { OpeningHoursApi } from "./opening-hours-client.js";
import type { GridBlockChange, GridBlockOpen, GridRangeSelection } from "./service-grid.js";
import type { RangeDialog } from "./range-dialog.js";
import type { PeriodEditor } from "./period-editor.js";
import { t } from "./strings.js";
import { format } from "./hours-view.js";
import { dateInWeek, namedOn, realDayLabel, giveOwnHours } from "./real-week.js";
import "./service-grid.js";
import "./range-dialog.js";
import "./period-editor.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-row-actions.js";

type Department = OpeningHoursModel["departments"][number];
type RangeOpening = { weekday: number; index?: number; input: ServiceRange };
type PeriodOpening = { range: RangeOpening };
type Draft = { days: MenuWeekDay[]; following: boolean };
const copyDraft = (draft: Draft): Draft => ({
  days: copyWeek(draft.days),
  following: draft.following,
});
const copyWeek = (week: readonly MenuWeekDay[]): MenuWeekDay[] =>
  week.map((day) => ({ weekday: day.weekday, slots: day.slots.map((slot) => ({ ...slot })) }));
const sameWeek = (a: readonly MenuWeekDay[], b: readonly MenuWeekDay[]) =>
  a.length === b.length &&
  a.every((day) => {
    const other = b.find((value) => value.weekday === day.weekday);
    return (
      other !== undefined &&
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
const weekOf = (department: Department): MenuWeekDay[] =>
  Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    slots: (department.week.find((day) => day.weekday === weekday)?.slots ?? []).map((slot) => ({
      ...slot,
    })),
  }));
const displayOrder = [1, 2, 3, 4, 5, 6, 0];
const dayName = (weekday: number) => t(`hours.day.${weekday}` as Parameters<typeof t>[0]);

@customElement("opening-hours-week")
export class OpeningHoursWeek extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      .day-errors {
        color: var(--wt-color-danger);
        margin-block: var(--wt-space-3);
      }
      wt-form-actions {
        margin-block-start: var(--wt-space-4);
      }
      .date-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
        margin-block: var(--wt-space-3);
      }
      .copy-days {
        display: grid;
        gap: var(--wt-space-3);
        padding-block: var(--wt-space-3);
      }
      .copy-days label {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
      }
      input[type="checkbox"] {
        accent-color: var(--wt-color-primary);
      }
    `,
  ];
  @property({ attribute: false }) api!: OpeningHoursApi;
  @property({ attribute: false }) department!: Department;
  @property({ attribute: false }) menus: OpeningHoursModel["menus"] = [];
  @property({ attribute: false }) timeZone?: string;
  @property() dayCutover = "06:00";
  @property() weekStart = "";
  @property({ attribute: false }) namedDays: OpeningHoursModel["namedDays"] = [];
  @property({ type: Boolean }) dateActionsReady = true;
  private sourceNamedDays?: OpeningHoursModel["namedDays"];
  private contextDays: OpeningHoursModel["namedDays"] = [];
  private dateFollowing = new Set<number>();
  private dateBaselineFollowing = new Set<number>();
  private dateScopes = new Map<number, DraftScope<Draft>>();
  @property({ type: Boolean }) readOnly = false;
  @state() private draft: MenuWeekDay[] = [];
  @state() private opening?: RangeOpening;
  @state() private periodOpening?: PeriodOpening;
  @state() private created: Department["periods"][number][] = [];
  @state() private copying?: { weekday: number; days: number[] };
  @state() private saving = false;
  @state() private creating = false;
  @state() private error = "";
  @state() private errorDay?: number;
  @state() private skippedTime = false;
  @state() private offsetClash = false;
  private scope?: DraftScope<Draft>;
  private baseline: Draft = { days: [], following: false };
  private source?: Department;
  private generation = {};
  override connectedCallback() {
    super.connectedCallback();
    this.requestUpdate();
  }
  override disconnectedCallback() {
    this.scope?.dispose();
    for (const scope of this.dateScopes.values()) scope.dispose();
    this.dateScopes.clear();
    this.scope = undefined;
    this.generation = {};
    super.disconnectedCallback();
  }
  protected override willUpdate() {
    if (!this.source) {
      this.seedDraft();
      this.baseline = copyDraft(this.snapshot());
      this.source = this.department;
      this.sourceNamedDays = this.namedDays;
    }
    this.registerScopes();
    if (this.source !== this.department || this.sourceNamedDays !== this.namedDays) {
      if (this.dirty()) {
        this.source = this.department;
        this.sourceNamedDays = this.namedDays;
      } else if (!this.saving) {
        this.seedDraft();
        this.baseline = copyDraft(this.snapshot());
        this.scope?.commit(this.baseline);
        for (const [weekday, scope] of this.dateScopes)
          scope.commit({
            days: copyWeek([this.baseline.days[weekday]!]),
            following: this.dateBaselineFollowing.has(weekday),
          });
        this.source = this.department;
        this.sourceNamedDays = this.namedDays;
      }
    }
    this.registerScopes();
  }
  private registerScopes() {
    if (this.isConnected && this.weekStart) {
      for (const weekday of displayOrder) {
        if (!this.namedDay(weekday)?.ownHours || this.namedDay(weekday)?.closeWholeVenue) {
          this.dateScopes.get(weekday)?.dispose();
          this.dateScopes.delete(weekday);
          continue;
        }
        if (this.dateScopes.has(weekday)) continue;
        const scope = draftScopeFor(this, {
          id: { host: this, weekday },
          current: () => ({
            days: copyWeek([this.draft[weekday]!]),
            following: this.dateFollowing.has(weekday),
          }),
          snapshot: copyDraft,
          equal: (a, b) => a.following === b.following && sameWeek(a.days, b.days),
          restore: (value) => {
            if (value.following) this.dateFollowing.add(weekday);
            else this.dateFollowing.delete(weekday);
            this.draft = this.draft.map((day) =>
              day.weekday === weekday ? copyWeek(value.days)[0]! : day,
            );
          },
        }).scope;
        scope.commit({
          days: copyWeek([this.baseline.days[weekday]!]),
          following: this.dateBaselineFollowing.has(weekday),
        });
        this.dateScopes.set(weekday, scope);
      }
    }
    if (this.isConnected && !this.weekStart && !this.scope) {
      const { scope } = draftScopeFor(this, {
        id: this,
        current: () => this.snapshot(),
        snapshot: copyDraft,
        equal: (a, b) => a.following === b.following && sameWeek(a.days, b.days),
        restore: (value) => {
          this.draft = copyWeek(value.days);
        },
      });
      this.scope = scope;
      scope.commit(this.baseline);
    }
  }
  private dirty() {
    return this.weekStart
      ? [...this.dateScopes.values()].some((scope) => !saveActionState(scope).unchanged)
      : !saveActionState(this.scope).unchanged;
  }
  private namedDay(weekday: number) {
    return namedOn(this.contextDays, this.weekStart, weekday);
  }
  private canEditDay(weekday: number) {
    return (
      !this.weekStart ||
      (!!this.namedDay(weekday)?.ownHours && !this.namedDay(weekday)?.closeWholeVenue)
    );
  }
  private snapshot(): Draft {
    return { days: this.draft, following: false };
  }
  private seedDraft() {
    this.draft = weekOf(this.department);
    this.contextDays = this.namedDays.map((day) => ({ ...day }));
    if (this.weekStart) {
      this.dateFollowing.clear();
      for (const day of this.draft) {
        const named = this.namedDay(day.weekday);
        const own =
          named?.ownHours && this.department.dates.find((row) => row.specialDateId === named.id);
        if (named?.closeWholeVenue) day.slots = [];
        else if (own) day.slots = own.slots.map((slot) => ({ ...slot }));
        else if (named?.ownHours) this.dateFollowing.add(day.weekday);
      }
      this.dateBaselineFollowing = new Set(this.dateFollowing);
    }
  }
  private displayedDays() {
    return displayOrder;
  }
  private dayLabel(weekday: number) {
    return realDayLabel(this.weekStart, weekday, this.namedDay(weekday));
  }
  private periods() {
    return [
      ...this.department.periods,
      ...this.created.filter((p) => !this.department.periods.some((saved) => saved.id === p.id)),
    ];
  }
  private editable() {
    return this.isConnected && !this.readOnly && !this.saving && !this.creating;
  }
  private stage(weekday: number, slots: readonly ServiceRange[]) {
    if (!this.canEditDay(weekday)) return;
    this.dateFollowing.delete(weekday);
    this.draft = this.draft.map((day) =>
      day.weekday === weekday ? { weekday, slots: slots.map((slot) => ({ ...slot })) } : day,
    );
    this.error = "";
    this.errorDay = undefined;
    this.scope?.changed();
    this.dateScopes.get(weekday)?.changed();
  }
  private openRange(event: CustomEvent<GridRangeSelection | GridBlockOpen>) {
    event.stopPropagation();
    if (!this.editable() || this.opening || this.copying) return;
    const weekday = Number(event.detail.columnKey);
    if (!this.displayedDays().includes(weekday) || !this.canEditDay(weekday)) return;
    const day = this.draft.find((day) => day.weekday === weekday);
    if (!day) return;
    if ("index" in event.detail) {
      const slot = day.slots[event.detail.index];
      if (!slot) return;
      this.opening = { weekday, index: event.detail.index, input: { ...slot } };
    } else
      this.opening = {
        weekday,
        input: { periodId: "", startsAt: event.detail.startsAt, endsAt: event.detail.endsAt },
      };
  }
  private resize(event: CustomEvent<GridBlockChange>) {
    event.stopPropagation();
    if (!this.editable() || this.opening || this.copying) return;
    const { columnKey, index, startsAt, endsAt } = event.detail;
    if (!this.displayedDays().includes(Number(columnKey)) || !this.canEditDay(Number(columnKey)))
      return;
    const day = this.draft.find((day) => day.weekday === Number(columnKey));
    if (!day?.slots[index]) return;
    this.stage(
      day.weekday,
      day.slots.map((slot, i) => (i === index ? { ...slot, startsAt, endsAt } : slot)),
    );
  }
  private currentRange(opening: RangeOpening, target: EventTarget | null) {
    return (
      this.editable() &&
      this.opening === opening &&
      target === this.shadowRoot?.querySelector("range-dialog") &&
      !this.periodOpening
    );
  }
  private applyRange(event: CustomEvent<{ input: ServiceRange }>, opening: RangeOpening) {
    event.stopPropagation();
    if (!this.currentRange(opening, event.currentTarget)) return;
    const slots = this.draft[opening.weekday]!.slots.map((slot) => ({ ...slot }));
    if (opening.index === undefined) slots.push({ ...event.detail.input });
    else slots[opening.index] = { ...event.detail.input };
    const minute = (time: string) =>
      (Number(time.slice(0, 2)) * 60 +
        Number(time.slice(3)) -
        Number(this.dayCutover.slice(0, 2)) * 60 -
        Number(this.dayCutover.slice(3)) +
        1440) %
      1440;
    slots.sort((a, b) => minute(a.startsAt) - minute(b.startsAt));
    this.stage(opening.weekday, slots);
    this.opening = undefined;
  }
  private deleteRange(event: Event, opening: RangeOpening) {
    event.stopPropagation();
    if (!this.currentRange(opening, event.currentTarget) || opening.index === undefined) return;
    this.stage(
      opening.weekday,
      this.draft[opening.weekday]!.slots.filter((_, i) => i !== opening.index),
    );
    this.opening = undefined;
  }
  private async save(weekday?: number) {
    const scope =
      this.weekStart && weekday !== undefined ? this.dateScopes.get(weekday) : this.scope;
    if (!this.editable() || this.opening || this.copying || saveActionState(scope).unchanged)
      return;
    const submitted = copyDraft(this.snapshot()),
      input = submitted.days,
      generation = this.generation;
    this.saving = true;
    this.error = "";
    this.errorDay = undefined;
    this.skippedTime = false;
    this.offsetClash = false;
    try {
      if (this.weekStart && weekday !== undefined) {
        const named = this.namedDay(weekday);
        if (!named?.ownHours || named.closeWholeVenue) return;
        await this.api.saveDateMenus(named.id, this.department.id, input[weekday]!.slots);
      } else await this.api.saveWeek(this.department.id, input);
    } catch (error) {
      if (generation !== this.generation || !this.isConnected) return;
      this.error =
        codeOf(error) === "special_date.keeps_week"
          ? t("opening.keeps_week")
          : t("menu.save_error");
      const field = (error as { params?: { field?: unknown } })?.params?.field;
      if (codeOf(error) === "menu_timetable.invalid" && typeof field === "string") {
        const match = /^days\.(\d+)(?:\.|$)/.exec(field);
        if (this.weekStart && weekday !== undefined && /^(?:slots(?:\.|$)|date$)/.test(field))
          this.errorDay = weekday;
        else if (match) this.errorDay = input[Number(match[1])]?.weekday;
        this.offsetClash =
          this.errorDay !== undefined &&
          (error as { params?: { reason?: unknown } }).params?.reason === "end_offset";
        this.skippedTime =
          this.errorDay !== undefined &&
          (error as { params?: { reason?: unknown } }).params?.reason === "clock_skips";
      }
      return;
    } finally {
      this.saving = false;
    }
    if (generation === this.generation && this.isConnected) {
      if (this.weekStart && weekday !== undefined) {
        this.baseline.days[weekday] = copyWeek([submitted.days[weekday]!])[0]!;
        this.dateBaselineFollowing.delete(weekday);
        scope?.commit({ days: copyWeek([submitted.days[weekday]!]), following: false });
      } else {
        this.baseline = copyDraft(submitted);
        this.scope?.commit(submitted);
      }
      this.api.rereadWatches();
    }
  }
  private async savePeriod(
    event: CustomEvent<{ periodId: string | null; input: MenuPeriodInput }>,
    opening: PeriodOpening,
  ) {
    event.stopPropagation();
    const component = event.currentTarget as PeriodEditor;
    if (
      !this.editable() ||
      this.periodOpening !== opening ||
      this.opening !== opening.range ||
      component !== this.shadowRoot?.querySelector("period-editor")
    )
      return;
    const generation = this.generation,
      { input } = event.detail;
    this.creating = true;
    component.refusal = undefined;
    try {
      const { id } = await this.api.createPeriod(this.department.id, input);
      if (
        generation !== this.generation ||
        !this.isConnected ||
        this.periodOpening !== opening ||
        this.opening !== opening.range
      )
        return;
      this.created = [
        ...this.created,
        {
          id,
          name: input.name,
          colour: input.colour ?? "blue",
          menuId: input.menuId,
          staffMenuIds: [...input.staffMenuIds],
          endOffsetMinutes: input.endOffsetMinutes ?? 0,
          weekdays: [],
        },
      ];
      if (component.commitSubmitted(input)) this.periodOpening = undefined;
      await this.updateComplete;
      const range = this.shadowRoot?.querySelector<RangeDialog>("range-dialog");
      await range?.updateComplete;
      if (this.opening === opening.range) range?.choosePeriod(id);
      this.api.rereadWatches();
    } catch (error) {
      if (generation === this.generation && this.isConnected && this.periodOpening === opening)
        component.refusal = {
          code: codeOf(error),
          params: (error as { params?: Record<string, unknown> })?.params,
        };
    } finally {
      this.creating = false;
    }
  }
  override render() {
    const opening = this.opening,
      period = this.periodOpening,
      copying = this.copying,
      state = saveActionState(this.scope);
    return html`<service-grid
        .dayCutover=${this.dayCutover}
        .columns=${this.displayedDays().map((weekday) => ({ key: String(weekday), label: this.dayLabel(weekday), slots: this.draft[weekday]?.slots ?? [], periods: this.periods(), editable: this.canEditDay(weekday) && !this.readOnly && !this.saving && !this.opening && !this.copying }))}
        @grid-range-select=${this.openRange}
        @grid-block-open=${this.openRange}
        @grid-block-change=${this.resize}
      >
        ${
          this.readOnly
            ? nothing
            : this.displayedDays().map(
                (weekday) =>
                  html`<div slot=${`header-${weekday}`}>
                    ${
                      this.weekStart
                        ? this.namedDay(weekday)?.closeWholeVenue
                          ? nothing
                          : this.namedDay(weekday)?.ownHours
                            ? html`<wt-button
                                  variant="secondary"
                                  data-test="close-date"
                                  data-day=${weekday}
                                  ?disabled=${this.saving || !!opening}
                                  @click=${() => {
                                    if (this.editable() && !this.opening) this.stage(weekday, []);
                                  }}
                                  >${t("opening.close_date")}</wt-button
                                >
                                <wt-form-actions
                                  .error=${this.errorDay === undefined || this.errorDay === weekday ? (this.errorDay === undefined ? this.error : t("menu.fix_fields")) : ""}
                                >
                                  <wt-button
                                    data-test="save-date"
                                    data-day=${weekday}
                                    variant=${saveActionState(this.dateScopes.get(weekday)).variant}
                                    ?disabled=${saveActionState(this.dateScopes.get(weekday)).unchanged || this.saving || !!opening}
                                    @click=${() => this.save(weekday)}
                                    >${t("menu.save")}</wt-button
                                  ></wt-form-actions
                                >`
                            : html`<wt-button
                                variant="secondary"
                                data-test="own-date"
                                data-day=${weekday}
                                ?disabled=${!this.dateActionsReady || this.saving || !!opening}
                                @click=${(event: Event) => {
                                  if (this.dateActionsReady && this.editable() && !this.opening)
                                    giveOwnHours(
                                      this,
                                      this.weekStart,
                                      weekday,
                                      this.namedDay(weekday),
                                      event.currentTarget as HTMLElement,
                                    );
                                }}
                                >${t("named.give_own")}</wt-button
                              >`
                        : html`<wt-row-actions
                            label=${format("menu.row_actions", { name: dayName(weekday) })}
                          >
                            <wt-button
                              variant="secondary"
                              data-test="copy-day"
                              data-day=${weekday}
                              ?disabled=${this.saving || !!this.opening || !!copying}
                              @click=${() => {
                                if (this.editable() && !this.opening && !this.copying)
                                  this.copying = { weekday, days: [] };
                              }}
                              >${t("opening.copy_day")}</wt-button
                            >
                            <wt-button
                              variant="secondary"
                              data-test="clear-day"
                              data-day=${weekday}
                              ?disabled=${this.saving || !!this.opening || !!copying}
                              @click=${() => {
                                if (this.editable() && !this.opening && !this.copying)
                                  this.stage(weekday, []);
                              }}
                              >${t("opening.clear_day")}</wt-button
                            >
                          </wt-row-actions>`
                    }${this.errorDay === weekday ? html`<p class="day-errors" data-day-error=${weekday}>${this.dayLabel(weekday)}: ${t(this.skippedTime ? "menu.time_skipped" : this.offsetClash ? "menu.offset_timetable" : "opening.check_day")}</p>` : nothing}
                  </div>`,
              )
        }</service-grid
      >
      ${this.readOnly || this.weekStart ? nothing : html`<wt-form-actions .error=${this.errorDay === undefined ? this.error : t("menu.fix_fields")}><span data-test="week-error" ?hidden=${!this.error}></span><wt-button data-test="save-week" variant=${state.variant} ?disabled=${state.unchanged || this.saving || !!this.opening || !!copying} @click=${() => this.save()}>${t("menu.save")}</wt-button></wt-form-actions>`}
      ${
        opening
          ? keyed(
              opening,
              html`<range-dialog
                .open=${true}
                .range=${opening.input}
                .periods=${this.periods()}
                .dayCutover=${this.dayCutover}
                .businessDate=${this.weekStart ? dateInWeek(this.weekStart, opening.weekday) : undefined}
                .timeZone=${this.timeZone}
                .occupied=${this.draft[opening.weekday]!.slots.filter((_, index) => index !== opening.index)}
                .deletable=${opening.index !== undefined}
                .busy=${!!this.periodOpening || this.creating}
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
        copying
          ? keyed(
              copying,
              html`<wt-modal
                open
                size="compact"
                heading=${t("opening.copy_day")}
                @wt-close=${(event: Event) => {
                  event.stopPropagation();
                  if (this.isConnected && this.copying === copying) this.copying = undefined;
                }}
              >
                <div class="copy-days">
                  ${displayOrder
                    .filter((day) => day !== copying.weekday)
                    .map(
                      (day) =>
                        html`<label
                          ><input
                            type="checkbox"
                            name=${`copyDay${day}`}
                            .checked=${copying.days.includes(day)}
                            @change=${(event: Event) => {
                              if (this.isConnected && this.copying === copying) {
                                copying.days = (event.target as HTMLInputElement).checked
                                  ? [...copying.days, day]
                                  : copying.days.filter((value) => value !== day);
                                this.requestUpdate();
                              }
                            }}
                          />${dayName(day)}</label
                        >`,
                    )}
                </div>
                <wt-form-actions slot="footer"
                  ><wt-button
                    slot="cancel"
                    variant="secondary"
                    @click=${() => {
                      if (this.isConnected && this.copying === copying) this.copying = undefined;
                    }}
                    >${t("menu.cancel")}</wt-button
                  ><wt-button
                    data-test="confirm-copy"
                    variant=${copying.days.length ? "primary" : "secondary"}
                    ?disabled=${!copying.days.length}
                    @click=${() => {
                      if (this.editable() && this.copying === copying && copying.days.length) {
                        const slots = this.draft[copying.weekday]!.slots;
                        for (const day of copying.days) this.stage(day, slots);
                        this.copying = undefined;
                      }
                    }}
                    >${t("opening.copy")}</wt-button
                  ></wt-form-actions
                ></wt-modal
              >`,
            )
          : nothing
      }
      ${
        period
          ? keyed(
              period,
              html`<period-editor
                .open=${true}
                .departmentName=${this.department.name}
                .menus=${this.menus}
                .usedColours=${this.periods().map((p) => p.colour)}
                .busy=${this.creating}
                @period-save=${(event: CustomEvent<{ periodId: string | null; input: MenuPeriodInput }>) => this.savePeriod(event, period)}
                @period-close=${(event: Event) => {
                  event.stopPropagation();
                  if (this.isConnected && !this.creating && this.periodOpening === period)
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
    "opening-hours-week": OpeningHoursWeek;
  }
}
