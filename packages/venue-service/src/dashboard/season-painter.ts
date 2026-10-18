import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
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
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import { WEEK_DISPLAY_ORDER } from "../hours-types.js";
import {
  rebaseDays,
  refill,
  samePaint,
  savedBlocks,
  withoutPeriods,
  type Paint,
} from "../paint-model.js";
import { seasonLastDay } from "../season-rules.js";
import { closuresInHours } from "../zone-own-hours.js";
import type { OpeningHoursApi } from "./opening-hours-client.js";
import type { PaintChange, PaintColumn } from "./paint-grid.js";
import { format, formatMonthDay } from "./hours-view.js";
import { chosenSeasonId, seasonWeek } from "./season-choice.js";
import { seasonTints, seasonTintStyles } from "./season-tint.js";
import { weekdayLabel } from "./season-week-view.js";
import { t } from "./strings.js";
import { periodColourStyles } from "./period-colour-styles.js";
import { paintRow, paintRowStyles } from "./paint-row.js";
import {
  departmentOf,
  droppedNotice,
  ownerName,
  refusalReason,
  removedPeriods,
} from "./painter-labels.js";
import "./painter-frame.js";
import "./paint-grid.js";
import { PeriodEditing, periodsLink } from "./period-editing.js";

type Model = OpeningHoursModel;
type Department = Model["departments"][number];
/** Paint per weekday key ("1" Monday … "0" Sunday). */
type Week = Map<string, Paint[]>;
/** One week per department (`d:<id>`) and per zone (`z:<id>`) of the season being painted. */
type Draft = Map<string, Week>;
/** A refused save: its message beside Save, and the department or zone and day it named. */
interface Refused {
  message: string;
  owner?: string;
  column?: string;
  reason?: string;
}
export interface PainterNavigation {
  seasonId: string;
  departmentId: string;
  zoneId: string | null;
}

/** Unchanging values, so the grid sees the same ones from one render to the next. */
const NOTHING_BY_KEY: ReadonlyMap<string, never> = new Map<string, never>();
const CLOSED_ONLY: readonly null[] = [null];
const departmentKey = (id: string) => `d:${id}`;
const zoneKey = (id: string) => `z:${id}`;

const copyWeek = (week: ReadonlyMap<string, readonly Paint[]>): Week =>
  new Map([...week].map(([key, day]) => [key, day.map((paint) => ({ ...paint }))]));
const copyDraft = (draft: Draft): Draft =>
  new Map([...draft].map(([key, week]) => [key, copyWeek(week)]));
const sameWeek = (a: Week | undefined, b: Week | undefined) =>
  a !== undefined &&
  b !== undefined &&
  WEEK_DISPLAY_ORDER.every((weekday) =>
    samePaint(a.get(String(weekday)) ?? [], b.get(String(weekday)) ?? []),
  );
const sameDraft = (a: Draft, b: Draft) =>
  a.size === b.size && [...a].every(([key, week]) => sameWeek(week, b.get(key)));

function weekFrom<Day extends { weekday: number }>(
  days: readonly Day[],
  paint: (day: Day) => Paint[],
): Week {
  return new Map(
    WEEK_DISPLAY_ORDER.map((weekday) => {
      const day = days.find((entry) => entry.weekday === weekday);
      return [String(weekday), day ? paint(day) : []];
    }),
  );
}
function shownIn(model: Model, departmentId: string, zoneId: string) {
  const active = model.departments.filter(({ active }) => active);
  const department = active.find(({ id }) => id === departmentId) ?? active[0];
  return {
    departmentId: department?.id ?? "",
    zoneId: department?.zones.find(({ id }) => id === zoneId)?.id ?? "",
  };
}
/** Department columns erase on Closed, so a Closed paint is never a department slot. */
const isPeriodPaint = (paint: Paint): paint is Paint & { periodId: string } =>
  paint.periodId !== null;
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
 * One season's week, per department and per zone, painted in a full-screen frame. One
 * draft holds every department and zone of the season, so the picker keeps edits; stepping to
 * another season asks first, then starts again from what is saved.
 */
@customElement("season-painter")
export class SeasonPainter extends LitElement {
  static override styles = [
    baseStyles,
    seasonTintStyles,
    periodColourStyles,
    paintRowStyles,
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
      /* The day fills the grid's slot: less the heading row and its line, and the grid's two borders. */
      paint-grid {
        container-type: size;
        --paint-grid-fill: calc(100cqb - var(--wt-tap-min) - 3px);
      }
      .covers {
        margin: 0;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
    `,
  ];

  @property({ attribute: false }) api!: OpeningHoursApi;
  /** Refreshed by the host from its live watch; `refresh` says what an edited week keeps. */
  @property({ attribute: false }) model!: Model;
  @property({ type: Boolean }) open = false;
  @property() seasonId = "";
  @property() departmentId = "";
  @property() zoneId = "";
  /** For a person who may only look: no paint row, no Save, and a grid that cannot change. */
  @property({ type: Boolean }) readOnly = false;
  /** A period id, or `null` for Closed; a zone always paints Closed. */
  @state() private chosen: string | null | undefined = undefined;
  @state() private draft: Draft = new Map();
  private periods = new PeriodEditing(this, {
    api: () => this.api,
    model: () => this.model,
    readOnly: () => this.readOnly,
    chose: (id) => {
      this.chosen = id;
    },
  });
  private baseline: Draft = new Map();
  private seededSeason?: string;
  private followed?: Model;
  /** The weeks a save sent, taken in only from a model read after `barrier` (`ModelWatches.reread`)
   *  and while no save is in flight. */
  private confirming?: { sent: Draft; barrier: number };
  /** Edits a refresh dropped because what they belonged to is gone; shown beside Save. */
  @state() private notice = "";
  @state() private refused?: Refused;
  @state() private saving = false;
  /** The clock revision the draft was seeded with; followed only while nothing is edited. */
  private revision = 0;
  /** Replaced whenever a save's answer would land on a draft it no longer belongs to. */
  private generation = {};
  private scope?: DraftScope<Draft>;
  private coordinator?: LeaveCoordinator;

  override disconnectedCallback() {
    this.scope?.dispose();
    this.scope = undefined;
    this.coordinator = undefined;
    this.forget();
    super.disconnectedCallback();
  }

  protected override willUpdate(changes: PropertyValues<this>) {
    if (!this.model) return;
    const previous = (changes.get("model") as Model | undefined) ?? this.model;
    if (!this.model.seasons.some(({ id }) => id === this.seasonId)) {
      const gone = previous.seasons.find(({ id }) => id === this.seasonId);
      const lost = this.seededSeason === this.seasonId && this.anyEdited();
      this.seasonId = chosenSeasonId(this.model.seasons, this.model.currentSeasonId, "");
      if (this.seededSeason !== undefined) {
        if (lost && gone) this.notice = droppedNotice([gone.name], new Set());
        this.reseed();
        this.navigate();
      }
    }
    if (this.seededSeason !== this.seasonId) this.reseed();
    else if (
      changes.has("model") ||
      ((this.followed !== this.model || this.revision !== this.model.clockRevision) &&
        !this.anyEdited()) ||
      (this.followed !== this.model && this.mayFollow()) ||
      this.confirmable()
    ) {
      const before = shownIn(previous, this.departmentId, this.zoneId);
      const confirmed = this.confirmable() ? this.confirming!.sent : undefined;
      if (confirmed) this.confirming = undefined;
      this.refresh(previous, confirmed);
      const after = shownIn(this.model, this.departmentId, this.zoneId);
      if (before.departmentId !== after.departmentId || before.zoneId !== after.zoneId) {
        this.departmentId = after.departmentId;
        this.zoneId = after.zoneId;
        this.navigate();
      }
    }
    if (this.isConnected && !this.scope) {
      const { scope, coordinator } = draftScopeFor(this, {
        id: {},
        current: () => this.draft,
        snapshot: copyDraft,
        equal: sameDraft,
        restore: (value) => {
          this.draft = copyDraft(value);
          this.notice = "";
          this.refused = undefined;
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

  private anyEdited(): boolean {
    const { departments, zones } = this.edited();
    return departments.length + zones.length > 0;
  }
  private commitBaseline(baseline: Draft) {
    this.baseline = baseline;
    this.scope?.commit(copyDraft(baseline));
  }
  private forget() {
    this.generation = {};
    this.saving = false;
    this.confirming = undefined;
  }
  /** A save in flight already holds the draft's copy of every day of the weeks it sends, and after
   *  a successful save those weeks keep what was sent as their baseline until a read that started
   *  after the latest successful save answered arrives while no save is in flight; until then no
   *  edited week may take in another day. */
  private mayFollow(): boolean {
    return !this.saving && this.confirming === undefined;
  }
  private confirmable(): boolean {
    return !this.saving && this.readAfterSave();
  }
  private readAfterSave(): boolean {
    const read = this.api.readNumberOf(this.model);
    return read !== undefined && this.confirming !== undefined && read > this.confirming.barrier;
  }
  private reseed() {
    this.forget();
    this.refused = undefined;
    this.revision = this.model.clockRevision;
    this.seededSeason = this.seasonId;
    this.followed = this.model;
    const fresh = seed(this.model, this.seasonId);
    this.draft = copyDraft(fresh);
    this.commitBaseline(fresh);
  }
  /** Weeks not edited follow the fresh model; an edited week takes it on every day the draft did
   *  not change, unless the painter may not follow yet, when the week and its baseline stay. A
   *  week whose department or zone is gone or inactive has its edits dropped with a notice. */
  private refresh(previous: Model, confirmed?: Draft) {
    const fresh = seed(this.model, this.seasonId);
    // A save naming a deleted period is refused, so its paint leaves every week held here. A
    // deletion naming a replacement moves the saved blocks to it, so the stretch of a deleted-period
    // block the week still holds where it was saved takes what the stored week now holds there.
    const removed = removedPeriods(previous, this.model);
    if (removed.size) {
      const none: Week = new Map();
      const strip = (weeks: Draft, saved: Draft): Draft =>
        new Map(
          [...weeks].map(([key, week]) => [
            key,
            refill(
              withoutPeriods(week, removed),
              savedBlocks(week, removed, saved.get(key) ?? none, this.model.dayCutover),
              fresh.get(key) ?? none,
              this.model.dayCutover,
            ),
          ]),
        );
      this.draft = strip(this.draft, this.baseline);
      if (confirmed) confirmed = strip(confirmed, confirmed);
      this.baseline = strip(this.baseline, this.baseline);
    }
    if (confirmed) {
      this.draft = new Map(this.draft);
      this.baseline = new Map(this.baseline);
    }
    for (const [key, sent] of confirmed ?? []) {
      const stored = fresh.get(key);
      const current = this.draft.get(key);
      if (!stored || !current) continue;
      this.draft.set(key, rebaseDays(stored, sent, current));
      this.baseline.set(key, stored);
    }
    const draft: Draft = new Map();
    const baseline: Draft = new Map();
    const gone: string[] = [];
    const inactive = new Set<string>();
    const follow = this.mayFollow();
    for (const [key, week] of this.draft) {
      if (sameWeek(week, this.baseline.get(key))) continue;
      if (!fresh.has(key)) {
        const owner = departmentOf(this.model, key);
        if (owner && !owner.active) inactive.add(owner.name);
        else gone.push(ownerName(previous, key));
        continue;
      }
      if (follow) {
        draft.set(key, rebaseDays(fresh.get(key)!, this.baseline.get(key)!, week));
        baseline.set(key, fresh.get(key)!);
      } else {
        draft.set(key, week);
        baseline.set(key, this.baseline.get(key)!);
      }
    }
    const readAfterSave = this.readAfterSave();
    for (const [key, week] of fresh) {
      if (draft.has(key)) continue;
      draft.set(key, copyWeek(week));
      baseline.set(key, week);
      // Read after the pending save answered, so this week needs nothing more from it.
      if (readAfterSave) this.confirming!.sent.delete(key);
    }
    if ([...baseline].every(([key, week]) => week === fresh.get(key))) this.followed = this.model;
    this.draft = draft;
    this.commitBaseline(baseline);
    if (!this.anyEdited()) this.revision = this.model.clockRevision;
    const notice = droppedNotice(gone, inactive);
    if (notice) this.notice = notice;
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
    if (this.chosen !== undefined && this.periods.paints(department, this.chosen))
      return this.chosen;
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
      this.notice = "";
      this.seasonId = next.id;
      this.reseed();
      this.navigate();
    };
    if (this.scope && this.coordinator)
      await this.coordinator.request({ scopes: [this.scope.id], reason: "navigation", proceed });
    else proceed();
  }
  private pick(value: string) {
    this.notice = "";
    if (value.startsWith("zone:")) {
      const id = value.slice(5);
      const owner = this.model.departments.find(
        ({ active, zones }) => active && zones.some((zone) => zone.id === id),
      );
      if (!owner) return;
      if (owner.id !== this.department()?.id) this.chosen = undefined;
      this.departmentId = owner.id;
      this.zoneId = id;
    } else {
      if (!this.model.departments.some(({ id, active }) => active && id === value)) return;
      if (value !== this.department()?.id) this.chosen = undefined;
      this.departmentId = value;
      this.zoneId = "";
    }
    this.navigate();
  }
  private paint(key: string, event: CustomEvent<PaintChange>) {
    event.stopPropagation();
    const week = copyWeek(this.draft.get(key) ?? new Map());
    week.set(event.detail.key, event.detail.day);
    this.notice = "";
    if (this.refused?.owner === key && this.refused.column === event.detail.key)
      this.refused = undefined;
    const draft = new Map(this.draft).set(key, week);
    const department = this.model.departments.find(({ id }) => departmentKey(id) === key);
    for (const zone of department?.zones ?? []) {
      const zoneWeek = draft.get(zoneKey(zone.id));
      const day = zoneWeek?.get(event.detail.key) ?? [];
      const cut = closuresInHours(event.detail.day.filter(isPeriodPaint), day, {
        dayCutover: this.model.dayCutover,
        endMinute: 1440,
      }).map(({ startsAt, endsAt }) => ({ periodId: null, startsAt, endsAt }));
      if (zoneWeek && !samePaint(cut, day))
        draft.set(zoneKey(zone.id), copyWeek(zoneWeek).set(event.detail.key, cut));
    }
    this.draft = draft;
    this.scope?.changed();
  }
  private async save() {
    if (this.saving || saveActionState(this.scope).unchanged) return;
    const { departments, zones } = this.edited();
    const sent: Draft = new Map(
      [...departments.map(departmentKey), ...zones.map(zoneKey)].map((key) => [
        key,
        copyWeek(this.draft.get(key)!),
      ]),
    );
    const days = (key: string) =>
      WEEK_DISPLAY_ORDER.map((weekday) => ({
        weekday,
        paint: sent.get(key)!.get(String(weekday))!,
      }));
    const generation = this.generation;
    this.saving = true;
    this.notice = "";
    this.refused = undefined;
    try {
      await this.api.saveSeasonWeeks(
        this.seasonId,
        {
          departments: departments.map((departmentId) => ({
            departmentId,
            days: days(departmentKey(departmentId)).map(({ weekday, paint }) => ({
              weekday,
              slots: paint
                .filter(isPeriodPaint)
                .map(({ periodId, startsAt, endsAt }) => ({ periodId, startsAt, endsAt })),
            })),
          })),
          zones: zones.map((zoneId) => ({
            zoneId,
            days: days(zoneKey(zoneId)).map(({ weekday, paint }) => ({
              weekday,
              ranges: paint.map(({ startsAt, endsAt }) => ({ startsAt, endsAt })),
            })),
          })),
        },
        this.revision,
      );
    } catch (error) {
      if (generation === this.generation) this.refuse(error, departments, zones);
      return;
    } finally {
      if (generation === this.generation) this.saving = false;
    }
    if (generation !== this.generation) return;
    const baseline = copyDraft(this.baseline);
    for (const [key, week] of sent) if (baseline.has(key)) baseline.set(key, week);
    this.commitBaseline(baseline);
    this.followed = this.model;
    this.confirming = {
      sent: new Map([...(this.confirming?.sent ?? []), ...sent]),
      barrier: this.api.rereadWatches(),
    };
    this.dispatchEvent(
      new CustomEvent<{ clean: boolean }>("season-week-saved", {
        detail: { clean: !this.scope?.isDirty() },
        bubbles: true,
        composed: true,
      }),
    );
  }
  /** A refusal naming `departments.<i>` or `zones.<i>` shows that week, marking the day it names. */
  private refuse(error: unknown, departments: string[], zones: string[]) {
    const code = codeOf(error);
    const params = (
      error as { params?: { field?: unknown; reason?: unknown; periodId?: unknown } } | null
    )?.params;
    if (code === "hours.clock_changed" || code === "hours.clock_change_pending") {
      this.refused = { message: t(code) };
      return;
    }
    const match = /^(departments|zones)\.(\d+)(?=\.|$)(?:\.days\.(\d+)(?=\.|$))?/.exec(
      typeof params?.field === "string" ? params.field : "",
    );
    const zoned = match?.[1] === "zones";
    const id = match ? (zoned ? zones : departments)[Number(match[2])] : undefined;
    if (!match || id === undefined) {
      this.refused = { message: t("menu.save_error") };
      return;
    }
    const owner = zoned ? zoneKey(id) : departmentKey(id);
    const weekday = match[3] === undefined ? undefined : WEEK_DISPLAY_ORDER[Number(match[3])];
    const name = ownerName(this.model, owner);
    const period = departmentOf(this.model, owner)?.periods.find(
      ({ id }) => id === params?.periodId,
    );
    const reason = refusalReason(code, params?.reason, period);
    this.refused = {
      message:
        weekday === undefined
          ? format("painter.refused_in", { name, message: reason })
          : format("painter.refused_on", { name, day: weekdayLabel(weekday), message: reason }),
      owner,
      column: weekday === undefined ? undefined : String(weekday),
      reason,
    };
    this.pick(zoned ? `zone:${id}` : id);
  }

  private seasonChip() {
    const seasons = this.model.seasons;
    const season = seasons.find(({ id }) => id === this.seasonId);
    if (!season) return nothing;
    const single = seasons.length < 2;
    return html`<span slot="picker" class="season">
      <wt-button
        data-test="previous-season"
        variant="ghost"
        aria-label=${t("painter.previous_season")}
        ?disabled=${single || this.saving}
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
        ?disabled=${single || this.saving}
        @click=${() => void this.step(1)}
        >›</wt-button
      >
    </span>`;
  }
  private picker(department: Department) {
    const zone = this.zone(department);
    return html`<wt-combobox
      slot="picker"
      name="department"
      label=${t("painter.department")}
      hide-label
      search="never"
      ?disabled=${this.saving}
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
    ></wt-combobox>`;
  }
  private behind?: {
    week: ReadonlyMap<string, readonly Paint[]>;
    label: string;
    map: ReadonlyMap<string, string>;
  };
  private closedBehind(
    department: Department,
    week: ReadonlyMap<string, readonly Paint[]>,
  ): ReadonlyMap<string, string> {
    const label = format("painter.department_closed", { department: department.name });
    if (this.behind?.week !== week || this.behind.label !== label)
      this.behind = {
        week,
        label,
        map: new Map(
          WEEK_DISPLAY_ORDER.filter((weekday) => !(week.get(String(weekday)) ?? []).length).map(
            (weekday) => [String(weekday), label],
          ),
        ),
      };
    return this.behind.map;
  }
  private paintRow(department: Department, chosen: string | null, zoned: boolean) {
    return paintRow({
      slot: "row",
      pots: [
        ...(zoned ? [] : this.periods.pots(department)),
        { id: null, name: t("hours.closed") },
      ],
      chosen,
      choose: (id) => {
        this.chosen = id;
      },
      newPeriod: zoned ? undefined : () => this.periods.open(department),
    });
  }
  /** Kept per locale, so the grid sees the same columns from one render to the next. */
  private weekColumns?: { locale: string; columns: readonly PaintColumn[] };
  private columns(): readonly PaintColumn[] {
    const locale = currentLocale();
    if (this.weekColumns?.locale !== locale)
      this.weekColumns = {
        locale,
        columns: WEEK_DISPLAY_ORDER.map((weekday) => ({
          key: String(weekday),
          label: weekdayLabel(weekday),
        })),
      };
    return this.weekColumns.columns;
  }

  override render() {
    const department = this.model && this.department();
    const season = this.model?.seasons.find(({ id }) => id === this.seasonId);
    if (!department || !season) return nothing;
    const zone = this.zone(department);
    const key = zone ? zoneKey(zone.id) : departmentKey(department.id);
    const chosen = this.effectiveChosen(department, zone !== undefined);
    const underlay = zone
      ? (this.draft.get(departmentKey(department.id)) ?? NOTHING_BY_KEY)
      : NOTHING_BY_KEY;
    return html`<painter-frame
        .open=${this.open}
        .heading=${format("painter.week", { season: season.name })}
        .scope=${this.scope}
        .coordinator=${this.coordinator}
        .dirty=${this.scope?.isDirty() ?? false}
        .busy=${this.saving}
        .refusal=${this.refused?.message ?? this.notice}
        .readOnly=${this.readOnly}
        @painter-save=${() => void this.save()}
        @painter-close=${() => {
          this.open = false;
          this.notice = "";
          this.refused = undefined;
          this.forget();
        }}
      >
        ${this.seasonChip()}${this.picker(department)} ${periodsLink()}
        <p slot="row" class="covers" data-test="covers">
          ${format("painter.week_covers", {
            from: formatMonthDay(season.startsOn),
            to: formatMonthDay(seasonLastDay(this.model.seasons, season.startsOn)),
          })}
        </p>
        ${this.readOnly ? nothing : this.paintRow(department, chosen, zone !== undefined)}
        <paint-grid
          .target=${`${this.seasonId}/${key}`}
          .columns=${this.columns()}
          .days=${this.draft.get(key) ?? NOTHING_BY_KEY}
          .underlay=${underlay}
          .closedWithin=${zone ? underlay : undefined}
          .closedBehind=${zone ? this.closedBehind(department, underlay) : NOTHING_BY_KEY}
          .periods=${department.periods}
          .chosen=${chosen}
          .cutover=${this.model.dayCutover}
          .closedErases=${zone === undefined}
          .readOnly=${this.readOnly}
          .paintable=${zone ? CLOSED_ONLY : undefined}
          .columnErrors=${
            this.refused?.owner === key && this.refused.column !== undefined
              ? new Map([[this.refused.column, this.refused.reason!]])
              : NOTHING_BY_KEY
          }
          @paint-change=${(event: CustomEvent<PaintChange>) => this.paint(key, event)}
          @paint-outside=${(event: Event) => {
            event.stopPropagation();
            this.refused = undefined;
            this.notice = t("opening.closed_outside");
          }}
        ></paint-grid>
      </painter-frame>
      ${this.periods.render()}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "season-painter": SeasonPainter;
  }
}
