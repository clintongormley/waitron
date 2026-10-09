import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { codeOf } from "@waitron/dashboard-kit";
import { baseStyles, draftScopeFor, saveActionState, type DraftScope } from "@waitron/ui";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import type { ClosedRange } from "../service-day.js";
import type { OpeningHoursApi } from "./opening-hours-client.js";
import type { GridBlockChange, GridBlockOpen, GridRangeSelection } from "./service-grid.js";
import { t } from "./strings.js";
import { format } from "./hours-view.js";
import "./service-grid.js";
import "./range-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-row-actions.js";

type Department = OpeningHoursModel["departments"][number];
type Zone = Department["zones"][number];
type Day = { weekday: number; ranges: ClosedRange[] };
type Opening = { weekday: number; index: number; input: ClosedRange };
const copy = (days: readonly Day[]): Day[] =>
  days.map((day) => ({ weekday: day.weekday, ranges: day.ranges.map((range) => ({ ...range })) }));
const equal = (a: readonly Day[], b: readonly Day[]) =>
  a.length === b.length &&
  a.every((day) => {
    const other = b.find((value) => value.weekday === day.weekday);
    return (
      other !== undefined &&
      day.ranges.length === other.ranges.length &&
      day.ranges.every((range) =>
        other.ranges.some(
          (value) => value.startsAt === range.startsAt && value.endsAt === range.endsAt,
        ),
      )
    );
  });
const order = [1, 2, 3, 4, 5, 6, 0];
const dayName = (day: number) => t(`hours.day.${day}` as Parameters<typeof t>[0]);

@customElement("opening-hours-zone-week")
export class OpeningHoursZoneWeek extends LitElement {
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
  @property({ attribute: false }) zone!: Zone;
  @property() dayCutover = "06:00";
  @property({ type: Boolean }) readOnly = false;
  @state() private draft: Day[] = [];
  @state() private opening?: Opening;
  @state() private copying?: { weekday: number; days: number[] };
  @state() private saving = false;
  @state() private error = "";
  @state() private errorDay?: number;
  private baseline: Day[] = [];
  private source?: Zone;
  private scope?: DraftScope<Day[]>;
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
    if (
      !this.source ||
      (this.source !== this.zone && !this.saving && saveActionState(this.scope).unchanged)
    ) {
      this.draft = Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        ranges: (this.zone.week.find((day) => day.weekday === weekday)?.ranges ?? []).map(
          (range) => ({ ...range }),
        ),
      }));
      this.baseline = copy(this.draft);
      this.scope?.commit(this.baseline);
    }
    this.source = this.zone;
    if (this.isConnected && !this.scope) {
      const { scope } = draftScopeFor(this, {
        id: this,
        current: () => this.draft,
        snapshot: copy,
        equal,
        restore: (value) => {
          this.draft = copy(value);
        },
      });
      this.scope = scope;
      scope.commit(this.baseline);
    }
  }
  private editable() {
    return this.isConnected && !this.readOnly && !this.saving;
  }
  private stage(weekday: number, ranges: readonly ClosedRange[]) {
    const minute = (time: string) =>
      (Number(time.slice(0, 2)) * 60 +
        Number(time.slice(3)) -
        Number(this.dayCutover.slice(0, 2)) * 60 -
        Number(this.dayCutover.slice(3)) +
        1440) %
      1440;
    this.draft = this.draft.map((day) =>
      day.weekday === weekday
        ? {
            weekday,
            ranges: ranges
              .map((range) => ({ startsAt: range.startsAt, endsAt: range.endsAt }))
              .sort((a, b) => minute(a.startsAt) - minute(b.startsAt)),
          }
        : day,
    );
    this.error = "";
    this.errorDay = undefined;
    this.scope?.changed();
  }
  private select(event: CustomEvent<GridRangeSelection>) {
    event.stopPropagation();
    if (!this.editable() || this.opening || this.copying) return;
    const weekday = Number(event.detail.columnKey);
    const day = this.draft.find((day) => day.weekday === weekday);
    if (!day) return;
    this.stage(weekday, [
      ...day.ranges,
      { startsAt: event.detail.startsAt, endsAt: event.detail.endsAt },
    ]);
  }
  private openRange(event: CustomEvent<GridBlockOpen>) {
    event.stopPropagation();
    if (!this.editable() || this.opening || this.copying) return;
    const weekday = Number(event.detail.columnKey);
    const input = this.draft.find((day) => day.weekday === weekday)?.ranges[event.detail.index];
    if (!input) return;
    this.opening = { weekday, index: event.detail.index, input: { ...input } };
  }
  private resize(event: CustomEvent<GridBlockChange>) {
    event.stopPropagation();
    if (!this.editable() || this.opening || this.copying) return;
    const { columnKey, index, startsAt, endsAt } = event.detail;
    const day = this.draft.find((day) => String(day.weekday) === columnKey);
    if (!day?.ranges[index]) return;
    this.stage(
      day.weekday,
      day.ranges.map((range, i) => (i === index ? { startsAt, endsAt } : range)),
    );
  }
  private current(opening: Opening, target: EventTarget | null) {
    return (
      this.editable() &&
      this.opening === opening &&
      target === this.shadowRoot?.querySelector("range-dialog")
    );
  }
  private async save() {
    if (!this.editable() || this.opening || this.copying || saveActionState(this.scope).unchanged)
      return;
    const submitted = copy(this.draft),
      generation = this.generation;
    this.saving = true;
    this.error = "";
    this.errorDay = undefined;
    try {
      await this.api.saveZoneWeek(this.zone.id, submitted);
    } catch (error) {
      if (generation !== this.generation || !this.isConnected) return;
      const invalid = codeOf(error) === "zone_closed_time.invalid";
      this.error = t(invalid ? "opening.closed_invalid" : "menu.save_error");
      const field = (error as { params?: { field?: unknown } })?.params?.field;
      const match =
        invalid && typeof field === "string" ? /^days\.(\d+)(?:\.|$)/.exec(field) : null;
      if (match) this.errorDay = submitted[Number(match[1])]?.weekday;
      return;
    } finally {
      this.saving = false;
    }
    if (generation === this.generation && this.isConnected) {
      this.baseline = copy(submitted);
      this.scope?.commit(submitted);
      this.api.rereadWatches();
    }
  }
  override render() {
    const opening = this.opening,
      copying = this.copying,
      state = saveActionState(this.scope);
    return html`<service-grid
        .dayCutover=${this.dayCutover}
        .columns=${order.map((weekday) => ({ key: String(weekday), label: dayName(weekday), slots: this.department.week.find((day) => day.weekday === weekday)?.slots ?? [], periods: this.department.periods, layer: "closed" as const, closed: this.draft[weekday]?.ranges ?? [], editable: !this.readOnly && !this.saving && !opening && !copying }))}
        @grid-range-select=${this.select}
        @grid-block-open=${this.openRange}
        @grid-block-change=${this.resize}
      >
        ${order.map(
          (weekday) =>
            html`<div slot=${`header-${weekday}`}>
              ${
                this.readOnly
                  ? nothing
                  : html`<wt-row-actions
                      label=${format("menu.row_actions", { name: dayName(weekday) })}
                    >
                      <wt-button
                        variant="secondary"
                        data-test="copy-day"
                        data-day=${weekday}
                        ?disabled=${this.saving || !!opening || !!copying}
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
                        ?disabled=${this.saving || !!opening || !!copying}
                        @click=${() => {
                          if (this.editable() && !this.opening && !this.copying)
                            this.stage(weekday, []);
                        }}
                        >${t("opening.clear_day")}</wt-button
                      >
                    </wt-row-actions>`
              }
              ${this.errorDay === weekday ? html`<p class="day-errors" data-day-error=${weekday}>${dayName(weekday)}: ${this.error}</p>` : nothing}
            </div>`,
        )}
      </service-grid>
      ${this.readOnly ? nothing : html`<wt-form-actions .error=${this.errorDay === undefined ? this.error : t("menu.fix_fields")}><wt-button data-test="save-week" variant=${state.variant} ?disabled=${state.unchanged || this.saving || !!opening || !!copying} @click=${() => this.save()}>${t("menu.save")}</wt-button></wt-form-actions>`}
      ${
        opening
          ? keyed(
              opening,
              html`<range-dialog
                .open=${true}
                .closedTimes=${true}
                .range=${opening.input}
                .dayCutover=${this.dayCutover}
                .occupied=${this.draft[opening.weekday]!.ranges.filter((_, index) => index !== opening.index)}
                .deletable=${true}
                @range-save=${(event: CustomEvent<{ input: ClosedRange }>) => {
                  event.stopPropagation();
                  if (this.current(opening, event.currentTarget)) {
                    this.stage(
                      opening.weekday,
                      this.draft[opening.weekday]!.ranges.map((range, index) =>
                        index === opening.index ? event.detail.input : range,
                      ),
                    );
                    this.opening = undefined;
                  }
                }}
                @range-delete=${(event: Event) => {
                  event.stopPropagation();
                  if (this.current(opening, event.currentTarget)) {
                    this.stage(
                      opening.weekday,
                      this.draft[opening.weekday]!.ranges.filter(
                        (_, index) => index !== opening.index,
                      ),
                    );
                    this.opening = undefined;
                  }
                }}
                @range-close=${(event: Event) => {
                  event.stopPropagation();
                  if (this.current(opening, event.currentTarget)) this.opening = undefined;
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
                  ${order
                    .filter((day) => day !== copying.weekday)
                    .map(
                      (day) =>
                        html`<label
                          ><input
                            type="checkbox"
                            name=${`copyDay${day}`}
                            .checked=${copying.days.includes(day)}
                            @change=${(event: Event) => {
                              if (this.editable() && this.copying === copying) {
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
                  >
                  <wt-button
                    data-test="confirm-copy"
                    variant=${copying.days.length ? "primary" : "secondary"}
                    ?disabled=${!copying.days.length}
                    @click=${() => {
                      if (this.editable() && this.copying === copying && copying.days.length) {
                        const ranges = this.draft[copying.weekday]!.ranges;
                        for (const day of copying.days) this.stage(day, ranges);
                        this.copying = undefined;
                      }
                    }}
                    >${t("opening.copy")}</wt-button
                  ></wt-form-actions
                >
              </wt-modal>`,
            )
          : nothing
      }`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "opening-hours-zone-week": OpeningHoursZoneWeek;
  }
}
