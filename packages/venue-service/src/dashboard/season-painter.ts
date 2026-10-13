import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { codeOf, currentLocale } from "@waitron/dashboard-kit";
import {
  baseStyles,
  draftScopeFor,
  saveActionState,
  type DraftScope,
  type LeaveCoordinator,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import type { MenuPeriodInput, OpeningHoursModel } from "../menu-timetable-types.js";
import type { Paint } from "../paint-model.js";
import { seasonLastDay } from "../season-rules.js";
import type { OpeningHoursApi } from "./opening-hours-client.js";
import type { PaintChange, PaintColumn } from "./paint-grid.js";
import type { PeriodEditor } from "./period-editor.js";
import { format, formatMonthDay } from "./hours-view.js";
import { chosenSeasonId, seasonWeek } from "./season-choice.js";
import { seasonTints, seasonTintStyles } from "./season-tint.js";
import { weekdayLabel } from "./season-week-view.js";
import { t } from "./strings.js";
import "./painter-frame.js";
import "./paint-grid.js";
import "./period-editor.js";

type Model = OpeningHoursModel;
type Department = Model["departments"][number];
type Period = Department["periods"][number];
/** Paint per weekday key ("1" Monday … "0" Sunday). */
type Week = Map<string, Paint[]>;
/** One week per department (`d:<id>`) and per zone (`z:<id>`) of the season being painted. */
type Draft = Map<string, Week>;
export interface PainterNavigation {
  seasonId: string;
  departmentId: string;
  zoneId: string | null;
}

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];
const departmentKey = (id: string) => `d:${id}`;
const zoneKey = (id: string) => `z:${id}`;

const copyWeek = (week: ReadonlyMap<string, readonly Paint[]>): Week =>
  new Map([...week].map(([key, day]) => [key, day.map((paint) => ({ ...paint }))]));
const copyDraft = (draft: Draft): Draft =>
  new Map([...draft].map(([key, week]) => [key, copyWeek(week)]));
const sameDay = (a: readonly Paint[], b: readonly Paint[]) =>
  a.length === b.length &&
  a.every(
    (paint, i) =>
      paint.periodId === b[i]!.periodId &&
      paint.startsAt === b[i]!.startsAt &&
      paint.endsAt === b[i]!.endsAt,
  );
const sameWeek = (a: Week | undefined, b: Week | undefined) =>
  a !== undefined &&
  b !== undefined &&
  WEEKDAYS.every((weekday) => sameDay(a.get(String(weekday)) ?? [], b.get(String(weekday)) ?? []));
const sameDraft = (a: Draft, b: Draft) =>
  a.size === b.size && [...a].every(([key, week]) => sameWeek(week, b.get(key)));

function weekFrom<Day extends { weekday: number }>(
  days: readonly Day[],
  paint: (day: Day) => Paint[],
): Week {
  return new Map(
    WEEKDAYS.map((weekday) => {
      const day = days.find((entry) => entry.weekday === weekday);
      return [String(weekday), day ? paint(day) : []];
    }),
  );
}
function seed(model: Model, seasonId: string): Draft {
  const draft: Draft = new Map();
  for (const department of model.departments.filter(({ active }) => active)) {
    draft.set(
      departmentKey(department.id),
      weekFrom(seasonWeek(department.seasonWeeks, seasonId), (day) =>
        day.slots.map(({ periodId, startsAt, endsAt }) => ({ periodId, startsAt, endsAt })),
      ),
    );
    for (const zone of department.zones)
      draft.set(
        zoneKey(zone.id),
        weekFrom(seasonWeek(zone.seasonWeeks, seasonId), (day) =>
          day.ranges.map(({ startsAt, endsAt }) => ({ periodId: null, startsAt, endsAt })),
        ),
      );
  }
  return draft;
}

/**
 * Mockup 3: one season's week, per department and per zone, painted in a full-screen frame. One
 * draft holds every department and zone of the season, so the picker keeps edits; stepping to
 * another season asks first, then starts again from what is saved.
 */
@customElement("season-painter")
export class SeasonPainter extends LitElement {
  static override styles = [
    baseStyles,
    seasonTintStyles,
    css`
      :host {
        display: contents;
      }
      .season {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-1);
      }
      .chip {
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-full);
        padding: var(--wt-space-1) var(--wt-space-3);
        white-space: nowrap;
      }
      .chip[data-tint] {
        background: var(--season-tint);
        color: var(--season-on-tint);
        border-color: var(--season-tint-line);
      }
      .follows {
        color: var(--wt-color-text-muted);
      }
      a {
        color: var(--wt-color-primary-text);
      }
      .paint {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
        border-block-start: 1px solid var(--wt-color-border);
        border-block-end: 1px solid var(--wt-color-border);
        padding-block: var(--wt-space-2);
      }
      .label {
        color: var(--wt-color-text-muted);
      }
      .pot {
        display: inline-flex;
        align-items: stretch;
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
      }
      .pot:has(button[aria-pressed="true"]) {
        outline: var(--wt-field-line-width-active) solid var(--wt-color-text);
      }
      .pot button,
      .new {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
        border: 0;
        background: none;
        color: var(--wt-color-text);
        padding: 0 var(--wt-space-3);
        font: inherit;
        cursor: pointer;
      }
      .pot button[aria-pressed="true"] {
        font-weight: var(--wt-font-weight-bold);
      }
      .pot button:focus-visible,
      .new:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      .pot .edit {
        padding-inline: var(--wt-space-2);
        color: var(--wt-color-text-muted);
      }
      .new {
        border: 1px dashed var(--wt-color-border);
        border-radius: var(--wt-radius-md);
      }
      .swatch {
        inline-size: var(--wt-space-3);
        block-size: var(--wt-space-3);
        border-radius: var(--wt-radius-sm);
        background: var(--period-fill);
      }
      .swatch.closed {
        background: repeating-linear-gradient(
          135deg,
          var(--wt-color-border) 0 var(--wt-space-1),
          transparent 0 calc(var(--wt-space-1) * 2)
        );
      }
      .swatch[data-colour="red"] {
        --period-fill: var(--wt-color-palette-red);
      }
      .swatch[data-colour="amber"] {
        --period-fill: var(--wt-color-palette-amber);
      }
      .swatch[data-colour="grey"] {
        --period-fill: var(--wt-color-palette-grey);
      }
      .swatch[data-colour="blue"] {
        --period-fill: var(--wt-color-palette-blue);
      }
      .swatch[data-colour="green"] {
        --period-fill: var(--wt-color-palette-green);
      }
      .swatch[data-colour="purple"] {
        --period-fill: var(--wt-color-palette-purple);
      }
      .hint {
        margin-inline-start: auto;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
    `,
  ];

  @property({ attribute: false }) api!: OpeningHoursApi;
  /** Refreshed by the host from its live watch; a refresh keeps every edited week. */
  @property({ attribute: false }) model!: Model;
  @property({ type: Boolean }) open = false;
  @property() seasonId = "";
  @property() departmentId = "";
  @property() zoneId = "";
  /** A period id, or `null` for Closed; a zone always paints Closed. */
  @state() private chosen: string | null | undefined = undefined;
  @state() private draft: Draft = new Map();
  @state() private editor?: { period?: Period; departmentId: string; clockRevision: number };
  @state() private periodBusy = false;
  private baseline: Draft = new Map();
  private seededSeason?: string;
  private created?: string;
  private scope?: DraftScope<Draft>;
  private coordinator?: LeaveCoordinator;

  override disconnectedCallback() {
    this.scope?.dispose();
    this.scope = undefined;
    this.coordinator = undefined;
    super.disconnectedCallback();
  }

  protected override willUpdate(changes: PropertyValues<this>) {
    if (!this.model) return;
    if (!this.model.seasons.some(({ id }) => id === this.seasonId))
      this.seasonId = chosenSeasonId(this.model.seasons, this.model.currentSeasonId, "");
    if (this.seededSeason !== this.seasonId) this.reseed();
    else if (changes.has("model")) this.refresh();
    if (this.isConnected && !this.scope) {
      const { scope, coordinator } = draftScopeFor(this, {
        id: {},
        current: () => this.draft,
        snapshot: copyDraft,
        equal: sameDraft,
        restore: (value) => {
          this.draft = copyDraft(value);
        },
      });
      this.scope = scope;
      this.coordinator = coordinator;
      scope.commit(this.baseline);
    }
  }

  /** The departments and zones whose week differs from what is saved. */
  edited(): { departments: string[]; zones: string[] } {
    const changed = [...this.draft.keys()].filter(
      (key) => !sameWeek(this.draft.get(key), this.baseline.get(key)),
    );
    return {
      departments: changed.filter((key) => key.startsWith("d:")).map((key) => key.slice(2)),
      zones: changed.filter((key) => key.startsWith("z:")).map((key) => key.slice(2)),
    };
  }

  private commitBaseline(baseline: Draft) {
    this.baseline = baseline;
    this.scope?.commit(copyDraft(baseline));
  }
  private reseed() {
    this.seededSeason = this.seasonId;
    const fresh = seed(this.model, this.seasonId);
    this.draft = copyDraft(fresh);
    this.commitBaseline(fresh);
  }
  /** Weeks not edited follow the fresh model; an edited week, and its baseline, stay. */
  private refresh() {
    const fresh = seed(this.model, this.seasonId);
    const draft: Draft = new Map();
    const baseline: Draft = new Map();
    for (const [key, week] of this.draft) {
      if (sameWeek(week, this.baseline.get(key))) continue;
      draft.set(key, week);
      baseline.set(key, this.baseline.get(key)!);
    }
    for (const [key, week] of fresh) {
      if (draft.has(key)) continue;
      draft.set(key, copyWeek(week));
      baseline.set(key, week);
    }
    this.draft = draft;
    this.commitBaseline(baseline);
  }

  private department(): Department | undefined {
    const active = this.model.departments.filter(({ active }) => active);
    return active.find(({ id }) => id === this.departmentId) ?? active[0];
  }
  private zone(department = this.department()) {
    return department?.zones.find(({ id }) => id === this.zoneId);
  }
  private effectiveChosen(department: Department, zoned: boolean): string | null {
    if (zoned || this.chosen === null) return null;
    if (this.chosen === this.created || department.periods.some(({ id }) => id === this.chosen))
      return this.chosen!;
    return department.periods[0]?.id ?? null;
  }
  private navigate() {
    const department = this.department();
    this.dispatchEvent(
      new CustomEvent<PainterNavigation>("painter-navigate", {
        detail: {
          seasonId: this.seasonId,
          departmentId: department?.id ?? "",
          zoneId: this.zone(department)?.id ?? null,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }
  private async step(by: number) {
    const seasons = this.model.seasons;
    const at = seasons.findIndex(({ id }) => id === this.seasonId);
    const next = seasons[(at + by + seasons.length) % seasons.length];
    if (!next || next.id === this.seasonId) return;
    const proceed = () => {
      this.seasonId = next.id;
      this.reseed();
      this.navigate();
    };
    if (this.scope && this.coordinator)
      await this.coordinator.request({ scopes: [this.scope.id], reason: "navigation", proceed });
    else proceed();
  }
  private pick(value: string) {
    if (value.startsWith("zone:")) {
      const id = value.slice(5);
      const owner = this.model.departments.find(
        ({ active, zones }) => active && zones.some((zone) => zone.id === id),
      );
      if (!owner) return;
      this.departmentId = owner.id;
      this.zoneId = id;
    } else {
      if (!this.model.departments.some(({ id, active }) => active && id === value)) return;
      this.departmentId = value;
      this.zoneId = "";
    }
    this.navigate();
  }
  private paint(key: string, event: CustomEvent<PaintChange>) {
    event.stopPropagation();
    const week = copyWeek(this.draft.get(key) ?? new Map());
    week.set(event.detail.key, event.detail.day);
    this.draft = new Map(this.draft).set(key, week);
    this.scope?.changed();
  }
  private save() {
    if (saveActionState(this.scope).unchanged) return;
  }

  private openPeriod(department: Department, period?: Period) {
    if (this.editor || this.periodBusy) return;
    this.editor = { period, departmentId: department.id, clockRevision: this.model.clockRevision };
  }
  private async savePeriod(
    event: CustomEvent<{ periodId: string | null; input: MenuPeriodInput }>,
  ) {
    event.stopPropagation();
    const editor = this.editor;
    const component = event.currentTarget as PeriodEditor;
    if (!editor || this.periodBusy || !this.isConnected) return;
    const { periodId, input } = event.detail;
    this.periodBusy = true;
    component.refusal = undefined;
    let created: string | undefined;
    try {
      if (periodId === null)
        created = (await this.api.createPeriod(editor.departmentId, input, editor.clockRevision))
          .id;
      else await this.api.updatePeriod(periodId, input, editor.clockRevision);
    } catch (error) {
      if (this.editor === editor && this.isConnected)
        component.refusal = {
          code: codeOf(error),
          params:
            typeof error === "object" && error !== null
              ? (error as { params?: Record<string, unknown> }).params
              : undefined,
        };
      return;
    } finally {
      if (this.editor === editor) this.periodBusy = false;
    }
    if (created !== undefined) {
      this.created = created;
      this.chosen = created;
    }
    if (this.editor === editor && component.commitSubmitted(input)) this.editor = undefined;
    this.api.rereadWatches();
  }

  private seasonChip() {
    const seasons = this.model.seasons;
    const season = seasons.find(({ id }) => id === this.seasonId);
    if (!season) return nothing;
    const single = seasons.length < 2;
    return html`<span class="season">
      <wt-button
        data-test="previous-season"
        variant="ghost"
        aria-label=${t("painter.previous_season")}
        ?disabled=${single}
        @click=${() => void this.step(-1)}
        >‹</wt-button
      >
      <span class="chip" data-test="season" data-tint=${seasonTints(seasons).get(season.id) ?? ""}
        >${format("season.chip", {
          name: season.name,
          from: formatMonthDay(season.startsOn),
          to: formatMonthDay(seasonLastDay(seasons, season.startsOn)),
        })}</span
      >
      <wt-button
        data-test="next-season"
        variant="ghost"
        aria-label=${t("painter.next_season")}
        ?disabled=${single}
        @click=${() => void this.step(1)}
        >›</wt-button
      >
    </span>`;
  }
  private picker(department: Department) {
    const zone = this.zone(department);
    const zones = department.zones.map(({ name }) => name);
    const list = new Intl.ListFormat(currentLocale().startsWith("es") ? "es-ES" : "en-GB", {
      type: "conjunction",
    }).format(zones);
    return html`<wt-combobox
        name="department"
        label=${t("painter.department")}
        hide-label
        search="never"
        .value=${zone ? `zone:${zone.id}` : department.id}
        .options=${this.model.departments
          .filter(({ active }) => active)
          .flatMap((entry) => [
            { value: entry.id, label: entry.name },
            ...entry.zones.map(({ id, name }) => ({ value: `zone:${id}`, label: name, depth: 1 })),
          ])}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          this.pick(event.detail.value);
        }}
      ></wt-combobox>
      ${
        zones.length
          ? html`<span class="follows" data-test="follows"
              >${format(zones.length === 1 ? "painter.zone_follows" : "painter.zones_follow", {
                zones: list,
                department: department.name,
              })}</span
            >`
          : nothing
      }`;
  }
  private paintRow(department: Department, chosen: string | null, zoned: boolean) {
    const choose = (id: string | null) => {
      this.chosen = id;
    };
    return html`<div slot="row" class="paint">
      <span class="label">${t("painter.paint")}</span>
      ${
        zoned
          ? nothing
          : department.periods.map(
              (period) =>
                html`<span class="pot">
                  <button
                    type="button"
                    data-test=${`paint-${period.id}`}
                    aria-pressed=${chosen === period.id ? "true" : "false"}
                    @click=${() => choose(period.id)}
                  >
                    <span class="swatch" data-colour=${period.colour}></span>${period.name}
                  </button>
                  <button
                    type="button"
                    class="edit"
                    data-test=${`edit-${period.id}`}
                    aria-label=${format("painter.edit_period", { name: period.name })}
                    @click=${() => this.openPeriod(department, period)}
                  >
                    ✎
                  </button>
                </span>`,
            )
      }
      <span class="pot">
        <button
          type="button"
          data-test="paint-closed"
          aria-pressed=${chosen === null ? "true" : "false"}
          @click=${() => choose(null)}
        >
          <span class="swatch closed"></span>${t("hours.closed")}
        </button>
      </span>
      ${
        zoned
          ? nothing
          : html`<button
              type="button"
              class="new"
              data-test="new-period"
              @click=${() => this.openPeriod(department)}
            >
              ${t("painter.new_period")}
            </button>`
      }
      <span class="hint" data-test="hint">${t("painter.hint")}</span>
    </div>`;
  }
  private periodEditor() {
    const editor = this.editor;
    const department = this.model.departments.find(({ id }) => id === editor?.departmentId);
    if (!editor || !department) return nothing;
    return keyed(
      editor,
      html`<period-editor
        .open=${true}
        .period=${editor.period}
        .departmentName=${department.name}
        .usedColours=${department.periods.map(({ colour }) => colour)}
        .menus=${this.model.menus}
        .busy=${this.periodBusy}
        .submitLabel=${editor.period ? "" : t("painter.add_and_paint")}
        @period-save=${this.savePeriod}
        @period-close=${(event: Event) => {
          event.stopPropagation();
          if (this.editor === editor && !this.periodBusy) this.editor = undefined;
        }}
      ></period-editor>`,
    );
  }

  override render() {
    const department = this.model && this.department();
    const season = this.model?.seasons.find(({ id }) => id === this.seasonId);
    if (!department || !season) return nothing;
    const zone = this.zone(department);
    const key = zone ? zoneKey(zone.id) : departmentKey(department.id);
    const chosen = this.effectiveChosen(department, zone !== undefined);
    const columns: PaintColumn[] = WEEKDAYS.map((weekday) => ({
      key: String(weekday),
      label: weekdayLabel(weekday),
    }));
    return html`<painter-frame
        .open=${this.open}
        .heading=${format("painter.week", { season: season.name })}
        .scope=${this.scope}
        .coordinator=${this.coordinator}
        .dirty=${this.scope?.isDirty() ?? false}
        @painter-save=${() => this.save()}
        @painter-close=${() => {
          this.open = false;
        }}
      >
        <span slot="picker" class="season">${this.seasonChip()}${this.picker(department)}</span>
        <a
          slot="link"
          data-test="periods-link"
          href=${`/manage/opening-hours/view/periods/department/${encodeURIComponent(department.id)}`}
          >${t("opening.tab.periods")}</a
        >
        ${this.paintRow(department, chosen, zone !== undefined)}
        <paint-grid
          .columns=${columns}
          .days=${this.draft.get(key) ?? new Map()}
          .underlay=${zone ? (this.draft.get(departmentKey(department.id)) ?? new Map()) : new Map()}
          .periods=${department.periods}
          .chosen=${chosen}
          .cutover=${this.model.dayCutover}
          .closedErases=${zone === undefined}
          .paintable=${zone ? [null] : undefined}
          @paint-change=${(event: CustomEvent<PaintChange>) => this.paint(key, event)}
        ></paint-grid>
      </painter-frame>
      ${this.periodEditor()}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "season-painter": SeasonPainter;
  }
}
