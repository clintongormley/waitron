import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { codeOf, currentLocale } from "@waitron/dashboard-kit";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  saveActionState,
  type DraftScope,
  type LeaveCoordinator,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import { layerPaint, stepSpan } from "../day-paint.js";
import { holidayDateName } from "../holiday-naming.js";
import type { HolidayFact, LocalDate } from "../hours-types.js";
import { addDays, isLocalDate, rangeDates } from "../hours-rules.js";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import type { SeasonDays } from "../opening-hours-calendar.js";
import type { Paint } from "../paint-model.js";
import { rebaseDays, refill, samePaint, savedBlocks, withoutPeriods } from "../paint-model.js";
import type { SpecialDayDetail, SpecialDayInput, SpecialDaySummary } from "../special-days.js";
import { closuresInHours } from "../zone-own-hours.js";
import type { AddDates, RemoveDates } from "./add-dates-calendar.js";
import type { OpeningHoursApi } from "./opening-hours-client.js";
import type { PaintChange, PaintColumn, PaintPeriod } from "./paint-grid.js";
import { paintRow, paintRowStyles } from "./paint-row.js";
import { PeriodEditing, periodsLink } from "./period-editing.js";
import { periodColourStyles } from "./period-colour-styles.js";
import { segmentedStyles } from "./segmented-styles.js";
import {
  departmentOf,
  droppedNotice,
  ownerName,
  refusalReason,
  removedPeriods,
} from "./painter-labels.js";
import {
  browserToday,
  format,
  formatDate,
  formatLongDate,
  formatMonthDay,
  formatShortDate,
  formatWeekday,
} from "./hours-view.js";
import { t } from "./strings.js";
import "./add-dates-calendar.js";
import "./painter-frame.js";
import "./paint-grid.js";

type Model = OpeningHoursModel;
type Department = Model["departments"][number];
type SeasonDay = SeasonDays["days"][number];
type DateFacts = { date: LocalDate; closedAllDay: boolean };
/** The paint of one department (`d:<id>`) or zone (`z:<id>`), per date; a zone's Open paints as
 *  {@link ZONE_OPEN} and its Closed as `null`. */
type OwnerPaint = Map<string, Map<LocalDate, Paint[]>>;
interface Draft {
  name: string;
  repeatsYearly: boolean;
  /** Sorted by date. */
  dates: DateFacts[];
  paint: OwnerPaint;
}
interface Refused {
  /** Beside Save. */
  message: string;
  field?: "name" | "dates";
  column?: LocalDate;
  /** The department (`d:<id>`) or zone (`z:<id>`) whose column is marked; any, when absent. */
  owner?: string;
  /** What the marked field or column heading says, when not the message. */
  mark?: string;
}
type PaintEntries = Pick<SpecialDayInput, "paint" | "zonePaint">;

/** A zone's Open, which no period id can equal: period ids are uuids. */
const ZONE_OPEN = "open";
const NOTHING_BY_KEY: ReadonlyMap<string, never> = new Map<string, never>();
const ZONE_PAINTABLE: readonly (string | null)[] = [null, ZONE_OPEN];
const departmentKey = (id: string) => `d:${id}`;
const zoneKey = (id: string) => `z:${id}`;
/** A month read that fails leaves the calendar unmarked; the server still refuses a taken date. */
const ignore = () => {};

const byDate = (a: DateFacts, b: DateFacts) => a.date.localeCompare(b.date);
const copyDays = (days: ReadonlyMap<LocalDate, Paint[]>) =>
  new Map([...days].map(([date, day]) => [date, day.map((entry) => ({ ...entry }))]));
const copyPaint = (paint: OwnerPaint): OwnerPaint =>
  new Map([...paint].map(([owner, days]) => [owner, copyDays(days)]));
const copyDraft = (draft: Draft): Draft => ({
  ...draft,
  dates: draft.dates.map((entry) => ({ ...entry })),
  paint: copyPaint(draft.paint),
});
function sameDays(
  a: ReadonlyMap<LocalDate, Paint[]> = new Map(),
  b: ReadonlyMap<LocalDate, Paint[]> = new Map(),
): boolean {
  const dates = new Set([...a.keys(), ...b.keys()]);
  return [...dates].every((date) => samePaint(a.get(date) ?? [], b.get(date) ?? []));
}
const samePaintMap = (a: OwnerPaint, b: OwnerPaint) =>
  [...new Set([...a.keys(), ...b.keys()])].every((owner) => sameDays(a.get(owner), b.get(owner)));
const sameDates = (a: readonly DateFacts[], b: readonly DateFacts[]) =>
  a.length === b.length &&
  a.every(
    (entry, index) =>
      entry.date === b[index]!.date && entry.closedAllDay === b[index]!.closedAllDay,
  );
const sameDraft = (a: Draft, b: Draft) =>
  a.name === b.name &&
  a.repeatsYearly === b.repeatsYearly &&
  sameDates(a.dates, b.dates) &&
  samePaintMap(a.paint, b.paint);

/** `stored`'s dates, with `current`'s own changes from `sent` laid over them: see `merge`. */
function rebaseDates(stored: Draft, sent: Draft, current: Draft): DateFacts[] {
  const was = new Map(sent.dates.map((entry) => [entry.date, entry]));
  const now = new Map(current.dates.map((entry) => [entry.date, entry]));
  const owners = [...new Set([...sent.paint.keys(), ...current.paint.keys()])];
  /** True too for a date `current` added. */
  const ticked = ({ date, closedAllDay }: DateFacts) =>
    was.get(date)?.closedAllDay !== closedAllDay;
  const repainted = (date: LocalDate) =>
    owners.some(
      (owner) =>
        !samePaint(
          current.paint.get(owner)?.get(date) ?? [],
          sent.paint.get(owner)?.get(date) ?? [],
        ),
    );
  const held = new Set(stored.dates.map(({ date }) => date));
  return [
    ...stored.dates
      .filter(({ date }) => now.has(date) || !was.has(date))
      .map((entry) => {
        const own = now.get(entry.date);
        return { ...(own && ticked(own) ? own : entry) };
      }),
    ...current.dates.filter(
      (entry) => !held.has(entry.date) && (ticked(entry) || repainted(entry.date)),
    ),
  ].sort(byDate);
}

function blank(dates: readonly LocalDate[], name = ""): Draft {
  return {
    name,
    repeatsYearly: false,
    dates: dates.map((date) => ({ date, closedAllDay: false })),
    paint: new Map(),
  };
}
/** The draft a stored special day opens on: its stored facts and stored paint, never the season's. */
function fromDetail(detail: SpecialDayDetail): Draft {
  const paint: OwnerPaint = new Map();
  const put = (owner: string, date: LocalDate, day: Paint[]) => {
    if (!paint.has(owner)) paint.set(owner, new Map());
    paint.get(owner)!.set(date, day);
  };
  for (const { departmentId, date, ranges } of detail.paint)
    put(
      `d:${departmentId}`,
      date,
      ranges.map(({ periodId, startsAt, endsAt }) => ({ periodId, startsAt, endsAt })),
    );
  for (const { zoneId, date, ranges } of detail.zonePaint)
    put(
      `z:${zoneId}`,
      date,
      ranges.map(({ kind, startsAt, endsAt }) => ({
        periodId: kind === "open" ? ZONE_OPEN : null,
        startsAt,
        endsAt,
      })),
    );
  return {
    name: detail.name,
    repeatsYearly: detail.repeatsYearly,
    dates: detail.dates.map(({ date, closedAllDay }) => ({ date, closedAllDay })).sort(byDate),
    paint,
  };
}
/** The same-named special day with the latest date; on a tie, the lowest id. */
function offerMatch(days: readonly SpecialDaySummary[], name: string): string | undefined {
  const latest = (day: SpecialDaySummary) =>
    day.dates.reduce((last, { date }) => (date > last ? date : last), "");
  return days
    .filter((day) => day.name === name)
    .sort((a, b) =>
      latest(a) !== latest(b) ? (latest(a) < latest(b) ? 1 : -1) : a.id < b.id ? -1 : 1,
    )[0]?.id;
}
/** What a season days read depends on in the model: a change re-reads, a bare refresh does not. */
function seasonSignature(model: Model): string {
  return JSON.stringify([
    model.businessDayClock,
    model.seasons,
    model.departments.map(({ id, active, seasonWeeks, zones }) => [
      id,
      active,
      seasonWeeks,
      zones.map((zone) => [zone.id, zone.seasonWeeks]),
    ]),
  ]);
}
const byStart = (cutover: string) => (a: Paint, b: Paint) =>
  stepSpan(a, cutover)[0] - stepSpan(b, cutover)[0];
const columnLabel = (date: LocalDate) =>
  `${formatWeekday(date, "short")} ${formatMonthDay(date.slice(5))}`;
/** Sorted dates as runs of consecutive dates, each its first and last date. */
function runsOf(dates: readonly LocalDate[]): [LocalDate, LocalDate][] {
  const runs: [LocalDate, LocalDate][] = [];
  for (const date of dates) {
    const last = runs.at(-1);
    if (last && addDays(last[1], 1) === date) last[1] = date;
    else runs.push([date, date]);
  }
  return runs;
}

/**
 * One special day in a full-screen painter: its name, dates and Every year in a side panel, and a
 * column per date with that date's Closed tick under its heading. A stored day opens on what is
 * stored; Save sends the facts and takes the answer as the new saved state.
 */
@customElement("special-day-painter")
export class SpecialDayPainter extends LitElement {
  static override styles = [
    baseStyles,
    periodColourStyles,
    paintRowStyles,
    segmentedStyles,
    css`
      :host {
        display: contents;
      }
      .body {
        display: flex;
        gap: var(--wt-space-4);
        min-height: 0;
      }
      .panel {
        flex: none;
        inline-size: calc(var(--wt-space-6) * 9);
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
        overflow-y: auto;
        padding: var(--wt-field-line-width-active);
      }
      .dates {
        flex: 1 1 0;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
      }
      paint-grid {
        flex: 1 1 0;
        min-width: 0;
        min-height: 0;
        container-type: size;
        --paint-grid-fill: calc(100cqb - var(--wt-tap-min) * 2 - 3px);
      }
      @media (width < 720px) {
        .body {
          flex-direction: column;
          overflow-y: auto;
        }
        .panel {
          inline-size: auto;
          overflow-y: visible;
        }
        .dates {
          flex: none;
          block-size: calc(var(--wt-space-6) * 16);
        }
      }
      p {
        margin: 0;
      }
      p.label,
      legend {
        margin-block-end: var(--wt-space-1);
        padding: 0;
        font-weight: var(--wt-font-weight-medium);
      }
      fieldset {
        margin: 0;
        padding: 0;
        border: 0;
        min-width: 0;
      }
      ul {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
        margin: 0 0 var(--wt-space-2);
        padding: 0;
        list-style: none;
      }
      .chip {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-1);
        border: 1px solid var(--wt-color-palette-purple);
        border-radius: var(--wt-radius-full);
        padding-inline-start: var(--wt-space-3);
      }
      .chip button {
        min-inline-size: var(--wt-tap-min);
        min-block-size: var(--wt-tap-min);
        border: 0;
        border-radius: var(--wt-radius-full);
        background: none;
        color: var(--wt-color-text);
        font: inherit;
        cursor: pointer;
      }
      .chip button:focus-visible,
      .tick input:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      add-dates-calendar {
        margin-block-start: var(--wt-space-2);
      }
      .segmented input:disabled + span {
        color: var(--wt-color-text-muted);
      }
      .segmented input:checked:disabled + span {
        background: var(--wt-color-border);
        color: var(--wt-color-text);
      }
      .note,
      .notice,
      .explain {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .note {
        margin-block-start: var(--wt-space-2);
      }
      .empty {
        padding: var(--wt-space-4);
        color: var(--wt-color-text-muted);
      }
      .error,
      .required {
        color: var(--wt-color-danger);
      }
      .required {
        margin-inline-start: var(--wt-space-1);
      }
      .tick {
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-1);
        cursor: pointer;
      }
      .tick input {
        margin: 0;
        accent-color: var(--wt-color-primary);
      }
    `,
  ];

  @property({ attribute: false }) api!: OpeningHoursApi;
  /** The host's live model; while nothing is edited, a save sends its clock revision. */
  @property({ attribute: false }) model!: OpeningHoursModel;
  @property({ type: Boolean }) open = false;
  /** The stored special day to paint, or `null` for a new one; a change starts again from it. */
  @property({ attribute: false }) specialDayId: string | null = null;
  /** A new special day's first date. */
  @property({ attribute: false }) date: LocalDate | null = null;
  /** A new special day's last date, when it opens on a run from {@link date}. */
  @property({ attribute: false }) lastDate: LocalDate | null = null;
  /** A date added to the stored day's draft, as an unsaved change; a change starts again from it. */
  @property({ attribute: false }) addDate: LocalDate | null = null;
  /** The public holidays the host knows of on the dates in view, for the Every year note. */
  @property({ attribute: false }) holidays: readonly HolidayFact[] = [];
  @property({ type: Boolean }) readOnly = false;
  /** The department or zone shown; the first active department when none or an unknown one. */
  @property() departmentId = "";
  @property() zoneId = "";

  /** A period id, {@link ZONE_OPEN}, `null` for Closed, or `undefined` for the first period. */
  @state() private chosen: string | null | undefined = undefined;
  private periods = new PeriodEditing(this, {
    api: () => this.api,
    model: () => this.model,
    readOnly: () => this.readOnly,
    chose: (id) => {
      this.chosen = id;
    },
  });
  /** Each date's season hours, without any special day; drawn faded under the paint. */
  @state() private seasonDays: ReadonlyMap<LocalDate, SeasonDay> = new Map();
  @state() private seasonFailed = false;
  /** The dates and model signature the season days were last asked for. */
  private seasonAsked?: string;
  private seasonToken = {};
  private signatures = new WeakMap<Model, string>();
  @state() private draft: Draft = blank([]);
  @state() private loading = false;
  @state() private loadFailed = false;
  @state() private attempted = false;
  @state() private refused?: Refused;
  /** Edits a refresh dropped because what they belonged to is gone or inactive; shown beside Save. */
  @state() private notice = "";
  @state() private saving = false;
  @state() private adding = false;
  @state() private month = "";
  @state() private taken: ReadonlyMap<LocalDate, string> = new Map();
  @state() private deleting?: { busy: boolean; message: string };
  /** The same-named special day offered before a new day on a public holiday, until answered. */
  @state() private offered?: { id: string };
  /** Replaced by an edit and by Save: the offer is about the new day only as it opened. */
  private offerToken = {};
  /** A new day pre-filled from a public holiday can be saved as it opened. */
  private savableAtOpen = false;
  private baseline: Draft = blank([]);
  /** What the draft was seeded from, as {@link seedKey} names it. */
  private seeded?: string;
  /** The stored dates, each with the public holiday it was saved on, if any. */
  private stored = new Map<LocalDate, string | undefined>();
  /** The stretches where `dropDeletedPeriods` took out a deleted period's paint over a block of it
   *  that was saved, which the next {@link merge} fills from the stored day. A save waits for that
   *  fill: sent before it, the save would send a changed date without the replacement the server
   *  moved there. */
  private vacated?: { draft: OwnerPaint; baseline: OwnerPaint };
  /** A pressed Save is waiting for {@link merge} to fill {@link vacated}; re-reads still run. */
  private filling?: object;
  /** The newest re-read of the stored day, until it answers. */
  private rereading?: Promise<boolean | undefined>;
  /** The clock revision the draft was seeded with; followed only while nothing is edited. */
  private revision = 0;
  /** Replaced whenever a read's or a write's answer would land on a draft it no longer belongs to. */
  private generation = {};
  /** Replaced as {@link generation} is, except by a disconnect: a save's answer still lands then. */
  private seedToken = {};
  /** Replaced by each re-read of the stored day and by each save, so only the newest re-read that
   *  no save has overtaken lands. */
  private followToken = {};
  /** A fresh model arrived while the stored day was first being read. */
  private followAfterRead = false;
  /** Asks again for the read of the stored day still unanswered, which a disconnect drops. */
  private unanswered?: () => void;
  private stopMonth?: () => void;
  private scope?: DraftScope<Draft>;
  private coordinator?: LeaveCoordinator;

  override connectedCallback() {
    super.connectedCallback();
    const unanswered = this.unanswered;
    this.unanswered = undefined;
    unanswered?.();
    if (this.adding) this.showMonth(this.month);
    this.requestUpdate();
  }
  override disconnectedCallback() {
    this.scope?.dispose();
    this.scope = undefined;
    this.coordinator = undefined;
    this.closeMonth();
    this.generation = {};
    if (this.deleting?.busy) this.deleting = undefined;
    this.forgetSeason();
    super.disconnectedCallback();
  }

  protected override willUpdate(changes: PropertyValues<this>) {
    if (!this.model) return;
    const key = this.seedKey();
    if (this.open && this.seeded !== key) this.reseed(key);
    else if (changes.has("model")) {
      this.dropDeletedPeriods((changes.get("model") as Model | undefined) ?? this.model);
      if (sameDraft(this.draft, this.baseline)) this.revision = this.model.clockRevision;
      if (!this.saving)
        this.dropUnpaintable((changes.get("model") as Model | undefined) ?? this.model);
      if (this.open) void this.follow();
    }
    if (this.isConnected && !this.scope) {
      const { scope, coordinator } = draftScopeFor(this, {
        id: {},
        current: () => this.draft,
        snapshot: copyDraft,
        equal: sameDraft,
        restore: (value) => {
          this.draft = copyDraft(value);
          this.attempted = false;
          this.refused = undefined;
          this.notice = "";
        },
      });
      this.scope = scope;
      this.coordinator = coordinator;
      scope.commit(copyDraft(this.baseline));
    }
    if (this.open) this.readSeason();
  }

  /** A stored day's id with its date to add, or `new:<date>..<lastDate>`; a change starts the
   *  draft again. */
  private seedKey(): string {
    return this.specialDayId === null
      ? `new:${this.date ?? ""}..${this.lastDate ?? ""}`
      : `${this.specialDayId}+${this.addDate ?? ""}`;
  }
  /** Reads the season of the draft's dates when they, or the model's seasons, change. */
  private readSeason() {
    const dates = this.draft.dates.map(({ date }) => date);
    let signature = this.signatures.get(this.model);
    if (signature === undefined) {
      signature = seasonSignature(this.model);
      this.signatures.set(this.model, signature);
    }
    const asked = `${dates.join(",")}|${signature}`;
    if (asked === this.seasonAsked) return;
    this.seasonAsked = asked;
    const token = (this.seasonToken = {});
    if (!dates.length) return;
    this.api.readSeasonDays(dates).then(
      (read) => {
        if (token !== this.seasonToken) return;
        this.seasonFailed = false;
        this.seasonDays = new Map(read.days.map((day) => [day.date, day]));
      },
      () => {
        if (token !== this.seasonToken) return;
        this.seasonFailed = true;
        this.seasonDays = new Map();
      },
    );
  }
  private forgetSeason() {
    this.seasonAsked = undefined;
    this.seasonToken = {};
    this.seasonDays = new Map();
    this.seasonFailed = false;
  }

  private reseed(key: string) {
    this.generation = {};
    this.seedToken = {};
    this.followAfterRead = false;
    this.unanswered = undefined;
    this.rereading = undefined;
    this.filling = undefined;
    this.seeded = key;
    this.saving = false;
    this.attempted = false;
    this.refused = undefined;
    this.notice = "";
    this.deleting = undefined;
    this.adding = false;
    this.offered = undefined;
    this.closeMonth();
    this.loadFailed = false;
    this.revision = this.model.clockRevision;
    const id = this.specialDayId;
    if (id === null) {
      this.loading = false;
      const date = this.date && isLocalDate(this.date) ? this.date : undefined;
      const name = date ? holidayDateName(this.holidays, date, "") : "";
      this.adopt(undefined, this.newDates(), name);
      if (name) this.offerExisting(name);
      return;
    }
    this.read(id, this.addDate && isLocalDate(this.addDate) ? [this.addDate] : []);
  }
  /** A new day's dates: {@link date} through {@link lastDate}, or `date` alone. */
  private newDates(): LocalDate[] {
    const date = this.date && isLocalDate(this.date) ? this.date : undefined;
    if (!date) return [];
    const last = this.lastDate && isLocalDate(this.lastDate) ? this.lastDate : undefined;
    return last ? rangeDates(date, last) : [date];
  }
  private read(id: string, addDates: readonly LocalDate[], announce = false) {
    this.loading = true;
    this.adopt(undefined, []);
    const generation = this.generation;
    this.unanswered = () => this.read(id, addDates, announce);
    this.api.specialDays.readSpecialDay(id).then(
      (detail) => {
        if (generation !== this.generation) return;
        this.unanswered = undefined;
        this.loading = false;
        this.adopt(detail, []);
        const held = new Set(this.draft.dates.map(({ date }) => date));
        const added = addDates.filter((date) => !held.has(date));
        if (added.length)
          this.change({
            ...this.draft,
            dates: [
              ...this.draft.dates,
              ...added.map((date) => ({ date, closedAllDay: false })),
            ].sort(byDate),
          });
        if (this.followAfterRead) void this.follow();
        if (!addDates.length) return;
        if (announce)
          this.dispatchEvent(
            new CustomEvent("special-day-navigate", {
              detail: { specialDayId: id },
              bubbles: true,
              composed: true,
            }),
          );
      },
      () => {
        if (generation !== this.generation) return;
        this.unanswered = undefined;
        this.loading = false;
        this.loadFailed = true;
      },
    );
  }
  /** Re-reads the stored day the painter shows, passively, for {@link merge}: true once merged,
   *  false when it reads nothing or fails, undefined when a newer re-read, a save or a new seed
   *  drops it. While a save's write is in flight it reads nothing, and the write drops a re-read
   *  already asked for: the save's answer becomes the saved state. */
  private follow(): Promise<boolean | undefined> {
    const id = this.specialDayId;
    this.followAfterRead = this.loading;
    if (id === null || this.loading || this.loadFailed || (this.saving && !this.filling))
      return Promise.resolve(false);
    const generation = this.generation;
    const token = (this.followToken = {});
    const current = () => generation === this.generation && token === this.followToken;
    this.unanswered = () => void this.follow();
    const reading: Promise<boolean | undefined> = this.api.specialDays
      .readSpecialDay(id, { passive: true })
      .then(
        (detail) => {
          if (this.rereading === reading) this.rereading = undefined;
          if (!current()) return undefined;
          this.unanswered = undefined;
          this.merge(detail);
          return true;
        },
        () => {
          if (this.rereading === reading) this.rereading = undefined;
          if (!current()) return undefined;
          this.unanswered = undefined;
          return false;
        },
      );
    this.rereading = reading;
    return reading;
  }
  /** Waits for re-reads of the stored day until {@link merge} has filled {@link vacated}: false
   *  when one fails, or is dropped with no newer one asked for. */
  private async fillVacated(): Promise<boolean> {
    const mine = (this.filling = {});
    try {
      while (this.vacated) {
        const outcome = await (this.rereading ?? this.follow());
        if (outcome === false || (outcome === undefined && !this.rereading)) return false;
      }
      return true;
    } finally {
      if (this.filling === mine) this.filling = undefined;
    }
  }
  /** Name and Every year each follow `detail`, in the draft and the saved state alike, where the
   *  draft has not changed them; a changed one keeps both. The saved dates follow `detail`, and so
   *  do the draft's, except that it keeps the dates it added and the Closed ticks it changed,
   *  leaves out the dates it removed, and keeps a date `detail` no longer holds when it changed
   *  that date's tick or paint. Each owner's saved paint follows `detail`, and its draft too on
   *  every date the draft has not changed. */
  private merge(detail: SpecialDayDetail) {
    const fresh = fromDetail(detail);
    const draft = copyDraft(this.draft);
    const baseline = copyDraft(this.baseline);
    if (this.vacated) {
      const cutover = this.cutover();
      const fill = (paint: OwnerPaint, holes: OwnerPaint) => {
        for (const [owner, days] of holes)
          paint.set(
            owner,
            refill(
              paint.get(owner) ?? new Map(),
              days,
              fresh.paint.get(owner) ?? new Map(),
              cutover,
            ),
          );
      };
      fill(draft.paint, this.vacated.draft);
      fill(baseline.paint, this.vacated.baseline);
      this.vacated = undefined;
    }
    if (draft.name === baseline.name) draft.name = baseline.name = fresh.name;
    if (draft.repeatsYearly === baseline.repeatsYearly)
      draft.repeatsYearly = baseline.repeatsYearly = fresh.repeatsYearly;
    draft.dates = rebaseDates(fresh, baseline, draft);
    baseline.dates = fresh.dates;
    const owners = [...draft.paint.keys(), ...baseline.paint.keys(), ...fresh.paint.keys()];
    const none = new Map<LocalDate, Paint[]>();
    for (const owner of new Set(owners)) {
      const days = fresh.paint.get(owner) ?? none;
      draft.paint.set(
        owner,
        rebaseDays(days, baseline.paint.get(owner) ?? none, draft.paint.get(owner) ?? none),
      );
      baseline.paint.set(owner, copyDays(days));
    }
    this.stored = new Map(detail.dates.map(({ date, holidayName }) => [date, holidayName]));
    this.draft = draft;
    this.baseline = baseline;
    this.scope?.commit(copyDraft(baseline));
  }
  /** A list that fails or lands late offers nothing: the pre-filled new day stands. */
  private offerExisting(name: string) {
    const generation = this.generation;
    const token = (this.offerToken = {});
    this.api.specialDays.listSpecialDays().then((days) => {
      if (generation !== this.generation || token !== this.offerToken) return;
      const id = offerMatch(days, name);
      this.offered = id === undefined ? undefined : { id };
    }, ignore);
  }
  private addTo({ id }: { id: string }) {
    const dates = this.newDates();
    this.generation = {};
    this.seedToken = {};
    this.offered = undefined;
    this.specialDayId = id;
    this.seeded = this.seedKey();
    this.read(id, dates, true);
  }
  /** `kept` is paint made since the save that answered `detail` was sent; it stays unsaved. */
  private adopt(
    detail: SpecialDayDetail | undefined,
    dates: readonly LocalDate[],
    name = "",
    kept: OwnerPaint = new Map(),
  ) {
    this.stored = new Map(detail?.dates.map(({ date, holidayName }) => [date, holidayName]));
    this.vacated = undefined;
    this.savableAtOpen = !detail && name !== "";
    const fresh = detail ? fromDetail(detail) : blank(dates, name);
    const draft = copyDraft(fresh);
    for (const [owner, days] of copyPaint(kept))
      draft.paint.set(owner, new Map([...(draft.paint.get(owner) ?? []), ...days]));
    this.draft = draft;
    this.baseline = fresh;
    this.scope?.commit(copyDraft(fresh));
  }
  /** The (owner, date) days painted since `sent` was taken. */
  private paintedSince(sent: OwnerPaint): OwnerPaint {
    const since: OwnerPaint = new Map();
    for (const [owner, days] of this.draft.paint)
      for (const [date, day] of days)
        if (!samePaint(day, sent.get(owner)?.get(date) ?? []))
          since.set(owner, new Map(since.get(owner)).set(date, day));
    return since;
  }
  /** A save naming a deleted period is refused, so its paint leaves the draft and the saved state.
   *  A deletion naming a replacement moves the saved blocks to it, so each stretch where a
   *  deleted-period block overlapped a saved block of that period is kept in {@link vacated}. */
  private dropDeletedPeriods(previous: Model) {
    const removed = removedPeriods(previous, this.model);
    if (!removed.size) return;
    const cutover = this.cutover();
    const holes = (paint: OwnerPaint, into: OwnerPaint = new Map()): OwnerPaint => {
      for (const [owner, days] of paint)
        for (const [date, blocks] of savedBlocks(
          days,
          removed,
          this.baseline.paint.get(owner) ?? new Map(),
          cutover,
        )) {
          const held = new Map(into.get(owner));
          into.set(owner, held.set(date, [...(held.get(date) ?? []), ...blocks]));
        }
      return into;
    };
    const draft = holes(this.draft.paint, this.vacated?.draft);
    const baseline = holes(this.baseline.paint, this.vacated?.baseline);
    this.vacated = draft.size || baseline.size ? { draft, baseline } : undefined;
    const strip = (paint: OwnerPaint): OwnerPaint =>
      new Map([...paint].map(([owner, days]) => [owner, withoutPeriods(days, removed)]));
    this.draft = { ...this.draft, paint: strip(this.draft.paint) };
    this.baseline = { ...this.baseline, paint: strip(this.baseline.paint) };
    this.scope?.commit(copyDraft(this.baseline));
  }
  /** An edited owner's paint goes back to its saved state when the owner is gone from `this.model`
   *  or no longer active, and the notice beside Save names it. True when it dropped any. */
  private dropUnpaintable(previous: Model): boolean {
    const paintable = new Set(
      this.model.departments
        .filter(({ active }) => active)
        .flatMap(({ id, zones }) => [departmentKey(id), ...zones.map((zone) => zoneKey(zone.id))]),
    );
    const gone: string[] = [];
    const inactive = new Set<string>();
    let paint: OwnerPaint | undefined;
    for (const [owner, days] of this.draft.paint) {
      const saved = this.baseline.paint.get(owner);
      if (paintable.has(owner) || sameDays(days, saved)) continue;
      const department = departmentOf(this.model, owner);
      if (department) inactive.add(department.name);
      else gone.push(ownerName(previous, owner));
      paint ??= copyPaint(this.draft.paint);
      if (saved) paint.set(owner, copyDays(saved));
      else paint.delete(owner);
    }
    if (!paint) return false;
    this.draft = { ...this.draft, paint };
    this.notice = droppedNotice(gone, inactive);
    this.scope?.changed();
    return true;
  }
  /** One entry per (owner, date) whose paint differs from the saved state, for owners the model
   *  still has; a removed date sends none, as the server drops its paint with it. */
  private changedPaint(): PaintEntries {
    const known = new Set(
      this.model.departments.flatMap(({ id, zones }) => [
        departmentKey(id),
        ...zones.map((zone) => zoneKey(zone.id)),
      ]),
    );
    const owners = [...new Set([...this.baseline.paint.keys(), ...this.draft.paint.keys()])]
      .filter((owner) => known.has(owner))
      .sort();
    const paint: NonNullable<SpecialDayInput["paint"]>[number][] = [];
    const zonePaint: NonNullable<SpecialDayInput["zonePaint"]>[number][] = [];
    for (const owner of owners)
      for (const { date } of this.draft.dates) {
        const day = this.draft.paint.get(owner)?.get(date) ?? [];
        if (samePaint(day, this.baseline.paint.get(owner)?.get(date) ?? [])) continue;
        const id = owner.slice(2);
        if (owner.startsWith("d:"))
          paint.push({
            departmentId: id,
            date,
            ranges: day.map(({ periodId, startsAt, endsAt }) => ({ periodId, startsAt, endsAt })),
          });
        else
          zonePaint.push({
            zoneId: id,
            date,
            ranges: day.map(({ periodId, startsAt, endsAt }) => ({
              kind: periodId === ZONE_OPEN ? "open" : "closed",
              startsAt,
              endsAt,
            })),
          });
      }
    return { ...(paint.length ? { paint } : {}), ...(zonePaint.length ? { zonePaint } : {}) };
  }
  private change(next: Draft) {
    this.offerToken = {};
    this.draft = next;
    this.refused = undefined;
    this.notice = "";
    this.scope?.changed();
  }

  private ownErrors(): { name?: string; dates?: string } {
    const errors: { name?: string; dates?: string } = {};
    if (!this.draft.name.trim()) errors.name = t("prep.name_required");
    if (!this.draft.dates.length) errors.dates = t("special.dates_required");
    return errors;
  }
  private blocked(): boolean {
    return this.attempted && Object.keys(this.ownErrors()).length > 0;
  }

  private async save() {
    if (
      this.saving ||
      this.loading ||
      this.offered ||
      saveActionState(this.scope, { savableAtOpen: this.savableAtOpen }).unchanged
    )
      return;
    this.attempted = true;
    if (this.blocked()) {
      await this.updateComplete;
      focusFirstInvalid(this.shadowRoot!);
      return;
    }
    const seed = this.seedToken;
    const model = this.model;
    this.offerToken = {};
    this.saving = true;
    this.refused = undefined;
    this.notice = "";
    if (this.vacated && !(await this.fillVacated())) {
      if (seed !== this.seedToken) return;
      this.saving = false;
      this.refused = { message: t("menu.save_error") };
      this.dropUnpaintable(model);
      return;
    }
    if (seed !== this.seedToken) return;
    const input: SpecialDayInput = {
      name: this.draft.name.trim(),
      repeatsYearly: this.draft.repeatsYearly,
      dates: this.draft.dates.map(({ date, closedAllDay }) => ({ date, closedAllDay })),
      ...this.changedPaint(),
    };
    const sent = copyPaint(this.draft.paint);
    this.followToken = {};
    this.unanswered = undefined;
    let detail: SpecialDayDetail;
    try {
      detail = await this.api.specialDays.writeSpecialDay(this.specialDayId, input, this.revision);
    } catch (error) {
      if (seed === this.seedToken) {
        this.saving = false;
        this.refuse(error, input);
        this.dropUnpaintable(model);
        if (this.vacated) void this.follow();
      }
      return;
    } finally {
      if (seed === this.seedToken) this.saving = false;
    }
    if (seed !== this.seedToken) return;
    this.specialDayId = detail.id;
    this.seeded = this.seedKey();
    this.attempted = false;
    this.adopt(detail, [], "", this.paintedSince(sent));
    // A drop leaves the draft clean, but its notice must stay on screen.
    const dropped = this.dropUnpaintable(model);
    this.dispatchEvent(
      new CustomEvent<{ detail: SpecialDayDetail; clean: boolean }>("special-day-saved", {
        detail: { detail, clean: !dropped && !this.scope?.isDirty() },
        bubbles: true,
        composed: true,
      }),
    );
    this.api.rereadWithSpecialDays();
  }
  private refuse(error: unknown, input: SpecialDayInput) {
    const code = codeOf(error);
    const params =
      (
        error as {
          params?: {
            field?: unknown;
            reason?: unknown;
            date?: unknown;
            name?: unknown;
            departmentId?: unknown;
            zoneId?: unknown;
            periodId?: unknown;
          };
        }
      ).params ?? {};
    const column = (date: LocalDate | undefined) =>
      date !== undefined && this.draft.dates.some((entry) => entry.date === date)
        ? date
        : undefined;
    if (code === "hours.clock_changed" || code === "hours.clock_change_pending") {
      this.refused = { message: t(code) };
    } else if (code === "special_day.date_taken" && isLocalDate(params.date)) {
      this.refused = {
        message: format("special.date_taken", {
          name: String(params.name ?? ""),
          date: formatDate(params.date),
        }),
        field: "dates",
        column: column(params.date),
      };
    } else if (code === "department.not_found") {
      this.refused = { message: t("menu.department_gone") };
    } else if (code === "service_zone.not_found") {
      this.refused = { message: t("special.zone_gone") };
    } else if (code === "special_day.invalid" && this.refusePaint(params, input)) {
      return;
    } else if (code === "special_day.invalid" && params.field === "name") {
      this.refused = {
        message: t("prep.fix_fields"),
        field: "name",
        mark: t("special.field_refused"),
      };
    } else if (code === "special_day.invalid" && typeof params.field === "string") {
      const index = /^dates\.(\d+)(?=\.|$)/.exec(params.field)?.[1];
      const date = index === undefined ? undefined : input.dates[Number(index)]?.date;
      const marked = column(date);
      this.refused =
        date !== undefined && params.reason === "overlap"
          ? {
              message: format("special.date_meets", { date: formatDate(date) }),
              field: "dates",
              column: marked,
            }
          : marked !== undefined
            ? {
                message: t("prep.fix_fields"),
                field: "dates",
                column: marked,
                mark: t("special.field_refused"),
              }
            : { message: t("menu.save_error") };
    } else {
      this.refused = { message: t("menu.save_error") };
    }
  }

  /** A refusal naming a paint entry, by its place in the request or, for a kept entry, by its
   *  owner and date: shows that owner, marking the date's column. False when it names none. */
  private refusePaint(
    params: {
      field?: unknown;
      reason?: unknown;
      date?: unknown;
      departmentId?: unknown;
      zoneId?: unknown;
      periodId?: unknown;
    },
    input: SpecialDayInput,
  ): boolean {
    const match = /^(paint|zonePaint)(?:\.(\d+))?(?=\.|$)/.exec(
      typeof params.field === "string" ? params.field : "",
    );
    if (!match) return false;
    const zoned = match[1] === "zonePaint";
    const named = (value: unknown) => (typeof value === "string" ? value : undefined);
    let id: string | undefined;
    let date: LocalDate | undefined;
    if (match[2] === undefined) {
      id = named(zoned ? params.zoneId : params.departmentId);
      date = isLocalDate(params.date) ? params.date : undefined;
    } else {
      const index = Number(match[2]);
      const entry = zoned ? input.zonePaint?.[index] : input.paint?.[index];
      id = entry && ("zoneId" in entry ? entry.zoneId : entry.departmentId);
      date = entry?.date;
    }
    if (id === undefined) return false;
    const owner = zoned ? zoneKey(id) : departmentKey(id);
    const period = this.model.departments
      .find((department) => department.id === id)
      ?.periods.find((entry) => entry.id === params.periodId);
    const reason =
      params.reason === "end_offset" ||
      params.reason === "clock_skips" ||
      params.reason === "outside_hours"
        ? refusalReason("special_day.invalid", params.reason, period)
        : t("opening.check_day");
    const name = ownerName(this.model, owner);
    const column = date !== undefined && this.draft.dates.some((entry) => entry.date === date);
    this.refused = {
      message:
        date === undefined
          ? format("painter.refused_in", { name, message: reason })
          : format("painter.refused_on", { name, day: formatDate(date), message: reason }),
      owner,
      column: column ? date : undefined,
      mark: reason,
    };
    this.pick(zoned ? `zone:${id}` : id);
    return true;
  }

  private async confirmDelete() {
    const id = this.specialDayId;
    if (id === null || !this.deleting || this.deleting.busy) return;
    const generation = this.generation;
    this.deleting = { busy: true, message: "" };
    try {
      await this.api.specialDays.deleteSpecialDay(id, this.revision);
    } catch (error) {
      if (generation !== this.generation) return;
      const code = codeOf(error);
      this.deleting = {
        busy: false,
        message:
          code === "hours.clock_changed" || code === "hours.clock_change_pending"
            ? t(code)
            : t("hours.save_error"),
      };
      return;
    }
    if (generation !== this.generation) return;
    this.deleting = undefined;
    this.scope?.commit(copyDraft(this.draft));
    this.dispatchEvent(
      new CustomEvent("special-day-deleted", { detail: { id }, bubbles: true, composed: true }),
    );
    this.api.rereadWithSpecialDays();
    this.open = false;
  }

  private showMonth(month: string) {
    this.closeMonth();
    this.month = month;
    this.taken = new Map();
    this.stopMonth = this.api.watchMonth(
      month,
      (read) => {
        this.taken = new Map(
          read.days.flatMap(({ date, inMonth, specialDay }) =>
            inMonth && specialDay && specialDay.id !== this.specialDayId
              ? [[date, specialDay.name] as const]
              : [],
          ),
        );
      },
      ignore,
      ignore,
    );
  }
  private closeMonth() {
    this.stopMonth?.();
    this.stopMonth = undefined;
  }
  private toggleAdding() {
    if (this.adding) {
      this.adding = false;
      this.closeMonth();
      return;
    }
    this.adding = true;
    const first = this.draft.dates[0]?.date ?? this.model.currentBusinessDay ?? browserToday();
    this.showMonth(first.slice(0, 7));
  }
  private addDates(event: CustomEvent<AddDates>) {
    event.stopPropagation();
    const held = new Set(this.draft.dates.map(({ date }) => date));
    const fresh = [...new Set(event.detail.dates)].filter((date) => !held.has(date));
    if (!fresh.length) return;
    this.change({
      ...this.draft,
      dates: [...this.draft.dates, ...fresh.map((date) => ({ date, closedAllDay: false }))].sort(
        byDate,
      ),
    });
  }
  private removeChosen(event: CustomEvent<RemoveDates>) {
    event.stopPropagation();
    for (const date of event.detail.dates) this.removeDates(date, date);
  }
  /** Removes the dates from `first` to `last`, with their paint. */
  private removeDates(first: LocalDate, last: LocalDate) {
    const gone = (date: LocalDate) => date >= first && date <= last;
    const paint = copyPaint(this.draft.paint);
    for (const days of paint.values())
      for (const date of days.keys()) if (gone(date)) days.delete(date);
    this.change({
      ...this.draft,
      dates: this.draft.dates.filter((entry) => !gone(entry.date)),
      paint,
    });
  }
  private setClosed(date: LocalDate, closedAllDay: boolean) {
    this.change({
      ...this.draft,
      dates: this.draft.dates.map((entry) =>
        entry.date === date ? { ...entry, closedAllDay } : entry,
      ),
    });
  }

  private department(): Department | undefined {
    const active = this.model.departments.filter(({ active }) => active);
    return active.find(({ id }) => id === this.departmentId) ?? active[0];
  }
  private zone(department: Department) {
    return department.zones.find(({ id }) => id === this.zoneId);
  }
  private effectiveChosen(department: Department, zoned: boolean): string | null {
    if (zoned) return this.chosen === ZONE_OPEN ? ZONE_OPEN : null;
    if (this.chosen === null) return null;
    if (this.chosen !== undefined && this.periods.paints(department, this.chosen))
      return this.chosen;
    return department.periods[0]?.id ?? null;
  }
  private pick(value: string) {
    const active = this.model.departments.filter(({ active }) => active);
    const zoneId = value.startsWith("zone:") ? value.slice(5) : "";
    const owner = zoneId
      ? active.find(({ zones }) => zones.some(({ id }) => id === zoneId))
      : active.find(({ id }) => id === value);
    if (!owner) return;
    if (owner.id !== this.department()?.id) this.chosen = undefined;
    this.departmentId = owner.id;
    this.zoneId = zoneId;
  }
  private paint(owner: string, event: CustomEvent<PaintChange>) {
    event.stopPropagation();
    const { key: date, day } = event.detail;
    const paint = new Map(this.draft.paint);
    paint.set(owner, new Map(paint.get(owner)).set(date, day));
    const department = this.model.departments.find(({ id }) => departmentKey(id) === owner);
    const season = this.seasonDays
      .get(date)
      ?.departments.find(({ departmentId }) => departmentId === department?.id);
    if (department && season && !this.closedDates().has(date)) {
      const cutover = this.cutover();
      const open = layerPaint(season.ranges, day, cutover);
      for (const zone of department.zones) {
        const zoneDay = paint.get(zoneKey(zone.id))?.get(date);
        if (!zoneDay) continue;
        const kept = zoneDay.filter(({ periodId }) => periodId === ZONE_OPEN);
        const closed = zoneDay.filter(({ periodId }) => periodId === null);
        const cut = closuresInHours(open, closed, { dayCutover: cutover, endMinute: 1440 }).map(
          ({ startsAt, endsAt }) => ({ periodId: null, startsAt, endsAt }),
        );
        // The stored day comes back in clock-text order, which `samePaint` would read as a change.
        if (samePaint(cut, closed.sort(byStart(cutover)))) continue;
        paint.set(
          zoneKey(zone.id),
          new Map(paint.get(zoneKey(zone.id))).set(date, [...kept, ...cut].sort(byStart(cutover))),
        );
      }
    }
    this.change({ ...this.draft, paint });
  }

  /** The changeover of the first date, which the whole grid is drawn from. */
  private cutover(): string {
    const first = this.draft.dates[0]?.date;
    return (first && this.seasonDays.get(first)?.dayCutover) || this.model.dayCutover;
  }
  private changeoversDiffer(): boolean {
    const changeovers = new Set(
      this.draft.dates.flatMap(({ date }) => this.seasonDays.get(date)?.dayCutover ?? []),
    );
    return changeovers.size > 1;
  }
  /** For a department, its season hours; for a zone, its department's day with the draft's paint
   *  laid over the season, and the zone's season closures over that as Closed. */
  private underlay(department: Department, zoneId: string | undefined, cutover: string) {
    const painted = this.draft.paint.get(departmentKey(department.id));
    const memo = this.underlayMemo;
    if (
      memo?.days === this.seasonDays &&
      memo.painted === painted &&
      memo.owner === `${department.id}/${zoneId ?? ""}` &&
      memo.cutover === cutover
    )
      return memo.underlay;
    const underlay = new Map<string, Paint[]>();
    for (const [date, day] of this.seasonDays) {
      const season = day.departments.find(({ departmentId }) => departmentId === department.id);
      if (!season) continue;
      if (zoneId === undefined) {
        underlay.set(
          date,
          season.ranges.map((range) => ({ ...range })),
        );
        continue;
      }
      const closures: Paint[] = (
        season.zones.find((zone) => zone.zoneId === zoneId)?.closed ?? []
      ).map(({ startsAt, endsAt }) => ({ periodId: null, startsAt, endsAt }));
      const open = layerPaint(
        layerPaint(season.ranges, painted?.get(date) ?? [], cutover),
        closures,
        cutover,
      );
      underlay.set(date, [...open, ...closures].sort(byStart(cutover)));
    }
    this.underlayMemo = {
      days: this.seasonDays,
      painted,
      owner: `${department.id}/${zoneId ?? ""}`,
      cutover,
      underlay,
    };
    return underlay;
  }
  private underlayMemo?: {
    days: ReadonlyMap<LocalDate, SeasonDay>;
    painted: ReadonlyMap<LocalDate, Paint[]> | undefined;
    owner: string;
    cutover: string;
    underlay: ReadonlyMap<string, Paint[]>;
  };
  /** For a zone, each date not closed all day whose season day is known, mapped to its
   *  department's open blocks that date: the season's hours with the draft's paint laid over. */
  private closedWithin(department: Department, cutover: string) {
    const painted = this.draft.paint.get(departmentKey(department.id));
    const shut = this.closedDates();
    const memo = this.withinMemo;
    if (
      memo?.days === this.seasonDays &&
      memo.painted === painted &&
      memo.shut === shut &&
      memo.departmentId === department.id &&
      memo.cutover === cutover
    )
      return memo.within;
    const within = new Map<string, Paint[]>();
    for (const [date, day] of this.seasonDays) {
      if (shut.has(date)) continue;
      const season = day.departments.find(({ departmentId }) => departmentId === department.id);
      if (!season) continue;
      within.set(date, layerPaint(season.ranges, painted?.get(date) ?? [], cutover));
    }
    this.withinMemo = {
      days: this.seasonDays,
      painted,
      shut,
      departmentId: department.id,
      cutover,
      within,
    };
    return within;
  }
  private behind?: {
    within: ReadonlyMap<string, readonly Paint[]>;
    label: string;
    map: ReadonlyMap<string, string>;
  };
  private closedBehind(
    department: Department,
    within: ReadonlyMap<string, readonly Paint[]>,
  ): ReadonlyMap<string, string> {
    const label = format("painter.department_closed", { department: department.name });
    if (this.behind?.within !== within || this.behind.label !== label)
      this.behind = {
        within,
        label,
        map: new Map([...within].filter(([, open]) => !open.length).map(([date]) => [date, label])),
      };
    return this.behind.map;
  }
  private withinMemo?: {
    days: ReadonlyMap<LocalDate, SeasonDay>;
    painted: ReadonlyMap<LocalDate, Paint[]> | undefined;
    shut: ReadonlySet<LocalDate>;
    departmentId: string;
    cutover: string;
    within: ReadonlyMap<string, Paint[]>;
  };

  private picker(department: Department, zone: Department["zones"][number] | undefined) {
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
  private linkFor() {
    const department = this.department();
    return department ? periodsLink() : nothing;
  }
  private pickerFor() {
    const department = this.department();
    return department ? this.picker(department, this.zone(department)) : nothing;
  }
  private paintArea(locked: boolean) {
    const department = this.department();
    const shut = this.closedDates();
    const notices = html`${
      this.seasonFailed
        ? html`<p class="notice error" role="status" data-test="season-error">
            ${t("special.season_error")}
          </p>`
        : nothing
    }${
      this.changeoversDiffer()
        ? html`<p class="notice" data-test="changeover-notice">
            ${format("special.changeover_differs", { time: this.cutover() })}
          </p>`
        : nothing
    }`;
    const ticks = this.draft.dates.map(
      ({ date, closedAllDay }) =>
        html`<label slot=${`column-head-${date}`} class="tick"
          ><input
            type="checkbox"
            name=${`closed.${date}`}
            aria-label=${`${t("special.closed")}, ${formatLongDate(date)}`}
            .checked=${closedAllDay}
            ?disabled=${locked}
            @change=${(event: Event) =>
              this.setClosed(date, (event.target as HTMLInputElement).checked)}
          />${t("hours.closed")}</label
        >`,
    );
    const columnErrors = (shown: string | undefined) =>
      this.refused?.column && (this.refused.owner === undefined || this.refused.owner === shown)
        ? new Map([[this.refused.column, this.refused.mark ?? this.refused.message]])
        : NOTHING_BY_KEY;
    const cutover = this.cutover();
    const empty = !this.draft.dates.length;
    const noDates =
      this.loading || this.loadFailed
        ? nothing
        : html`<p class="empty" data-test="no-dates">${t("special.no_dates")}</p>`;
    if (!department)
      return html`${notices}${
        empty
          ? noDates
          : html`<paint-grid
              .target=${this.seeded ?? ""}
              .columns=${this.columns()}
              .closedErases=${false}
              .closedAllDay=${shut}
              .cutover=${cutover}
              .readOnly=${true}
              .columnErrors=${columnErrors(undefined)}
              >${ticks}</paint-grid
            >`
      }`;
    const zone = this.zone(department);
    const owner = zone ? zoneKey(zone.id) : departmentKey(department.id);
    const chosen = this.effectiveChosen(department, zone !== undefined);
    const periods = zone ? this.zonePeriods(department) : department.periods;
    const stopped = this.loading || this.loadFailed || this.offered !== undefined;
    const within = zone ? this.closedWithin(department, cutover) : undefined;
    return html`${notices}${
      this.readOnly
        ? nothing
        : paintRow({
            pots: [
              ...(zone ? [periods.at(-1)!] : this.periods.pots(department)),
              { id: null, name: t("hours.closed") },
            ],
            chosen,
            choose: (id) => {
              this.chosen = id;
            },
            newPeriod: zone ? undefined : () => this.periods.open(department),
            disabled: stopped,
          })
    }${
      empty
        ? noDates
        : html`<paint-grid
            .target=${`${this.seeded ?? ""}/${owner}`}
            .columns=${this.columns()}
            .days=${this.draft.paint.get(owner) ?? NOTHING_BY_KEY}
            .underlay=${this.underlay(department, zone?.id, cutover)}
            .closedWithin=${within}
            .closedBehind=${within ? this.closedBehind(department, within) : NOTHING_BY_KEY}
            .periods=${periods}
            .chosen=${chosen}
            .closedErases=${false}
            .closedAllDay=${shut}
            .paintable=${zone ? ZONE_PAINTABLE : undefined}
            .cutover=${cutover}
            .readOnly=${this.readOnly || stopped}
            .columnErrors=${columnErrors(owner)}
            @paint-change=${(event: CustomEvent<PaintChange>) => this.paint(owner, event)}
            @paint-outside=${(event: Event) => {
              event.stopPropagation();
              this.refused = undefined;
              this.notice = t("opening.closed_outside");
            }}
            >${ticks}</paint-grid
          >`
    }`;
  }

  /** A zone's grid periods, kept while its department's periods and the label stay. */
  private zonePeriodsMemo?: {
    periods: Department["periods"];
    label: string;
    list: readonly PaintPeriod[];
  };
  private zonePeriods(department: Department): readonly PaintPeriod[] {
    const label = t("special.open");
    const memo = this.zonePeriodsMemo;
    if (memo?.periods === department.periods && memo.label === label) return memo.list;
    const list = [...department.periods, { id: ZONE_OPEN, name: label, colour: "green" as const }];
    this.zonePeriodsMemo = { periods: department.periods, label, list };
    return list;
  }

  /** The dates ticked Closed, kept while they stay so the grid sees the same set. */
  private shutDates?: { key: string; dates: ReadonlySet<LocalDate> };
  private closedDates(): ReadonlySet<LocalDate> {
    const dates = this.draft.dates
      .filter(({ closedAllDay }) => closedAllDay)
      .map(({ date }) => date);
    const key = dates.join(",");
    if (this.shutDates?.key !== key) this.shutDates = { key, dates: new Set(dates) };
    return this.shutDates.dates;
  }

  /** Kept while the dates and the language stay, so the grid sees the same columns. */
  private dateColumns?: { key: string; columns: readonly PaintColumn[] };
  private columns(): readonly PaintColumn[] {
    const key = `${currentLocale()} ${this.draft.dates.map(({ date }) => date).join(",")}`;
    if (this.dateColumns?.key !== key)
      this.dateColumns = {
        key,
        columns: this.draft.dates.map(({ date }) => ({ key: date, label: columnLabel(date) })),
      };
    return this.dateColumns.columns;
  }

  private heading(): string {
    const name = this.draft.name.trim();
    if (name) return name;
    return t(this.specialDayId === null ? "special.new" : "special.edit");
  }
  private message(): string {
    if (this.refused) return this.refused.message;
    if (this.blocked()) return t("prep.fix_fields");
    return this.loadFailed ? t("special.load_error") : this.notice;
  }

  private panel(locked: boolean) {
    const errors = this.attempted ? this.ownErrors() : {};
    const holidayDates = new Set(this.holidays.map(({ date }) => date));
    const onHoliday = this.draft.dates.some(({ date }) =>
      this.stored.has(date) ? this.stored.get(date) !== undefined : holidayDates.has(date),
    );
    const leap =
      this.draft.repeatsYearly && this.draft.dates.some(({ date }) => date.endsWith("-02-29"));
    const dates = this.draft.dates.map(({ date }) => date);
    const years = new Set(dates.map((date) => date.slice(0, 4))).size > 1;
    const nameError =
      errors.name ?? (this.refused?.field === "name" ? (this.refused.mark ?? "") : "");
    const repeat = (value: boolean, label: "special.no" | "special.yes") =>
      html`<label
        ><input
          type="radio"
          name="repeatsYearly"
          value=${value ? "yes" : "no"}
          .checked=${this.draft.repeatsYearly === value}
          ?disabled=${locked}
          @change=${() => this.change({ ...this.draft, repeatsYearly: value })}
        /><span>${t(label)}</span></label
      >`;
    return html`<section class="panel" data-test="panel">
      ${this.loading ? html`<p data-test="loading" role="status">${t("special.loading")}</p>` : nothing}
      <wt-input
        name="name"
        label=${t("prep.name")}
        required
        .value=${this.draft.name}
        .error=${nameError}
        ?disabled=${locked}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          this.change({ ...this.draft, name: event.detail.value });
        }}
      ></wt-input>
      <div>
        <p class="label" id="dates-label">
          ${t("special.dates")}<span class="required" data-required aria-hidden="true">*</span>
        </p>
        <ul aria-labelledby="dates-label">
          ${runsOf(dates).map(([first, last]) => {
            const span = (show: (date: LocalDate) => string) =>
              first === last ? show(first) : `${show(first)} – ${show(last)}`;
            return html`<li
              class="chip"
              data-test="date-chip"
              data-date=${first}
              data-dates=${dates.filter((date) => date >= first && date <= last).join(" ")}
            >
              <span data-test="date-label">${span((date) => formatShortDate(date, years))}</span>${
                locked
                  ? nothing
                  : html`<button
                      type="button"
                      data-test="remove-date"
                      aria-label=${format("special.remove_date", { date: span(formatLongDate) })}
                      @click=${() => this.removeDates(first, last)}
                    >
                      ×
                    </button>`
              }
            </li>`;
          })}
        </ul>
        ${
          errors.dates
            ? html`<p class="error" role="alert" data-test="dates-error" data-error="dates">
                ${errors.dates}
              </p>`
            : nothing
        }
        ${
          locked
            ? nothing
            : html`<wt-button
                data-test="add-dates"
                variant="secondary"
                aria-expanded=${this.adding ? "true" : "false"}
                @click=${() => this.toggleAdding()}
                >${t("special.add_dates")}</wt-button
              >`
        }
        ${
          this.adding && !locked
            ? html`<add-dates-calendar
                .month=${this.month}
                .selected=${this.draft.dates.map(({ date }) => date)}
                .taken=${this.taken}
                @add-dates=${this.addDates}
                @remove-dates=${this.removeChosen}
                @month-change=${(event: CustomEvent<{ month: string }>) => {
                  event.stopPropagation();
                  this.showMonth(event.detail.month);
                }}
              ></add-dates-calendar>`
            : nothing
        }
      </div>
      <fieldset>
        <legend>${t("special.every_year")}</legend>
        <div class="segmented">${repeat(false, "special.no")}${repeat(true, "special.yes")}</div>
        ${onHoliday ? html`<p class="note" data-test="holiday-note">${t("special.holiday_note")}</p>` : nothing}
        ${leap ? html`<p class="note" data-test="leap-note">${t("special.leap")}</p>` : nothing}
      </fieldset>
      <p class="explain" data-test="explain">${t("special.explain")}</p>
    </section>`;
  }
  private offer(offered: { id: string }) {
    const name = this.draft.name;
    return html`<section class="panel" data-test="offer">
      <p>${format("special.offer", { name })}</p>
      <wt-button data-test="add-to" @click=${() => this.addTo(offered)}
        >${format("special.add_to", { name })}</wt-button
      >
      <wt-button
        data-test="new-instead"
        variant="secondary"
        @click=${() => {
          this.offered = undefined;
        }}
        >${t("special.new")}</wt-button
      >
    </section>`;
  }
  private deleteDialog() {
    const deleting = this.deleting;
    if (!deleting) return nothing;
    return html`<wt-dialog
      open
      data-test="delete-special-day"
      heading=${t("hours.delete")}
      .dismissible=${!deleting.busy}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.deleting = undefined;
      }}
    >
      <p>
        ${format(this.baseline.repeatsYearly ? "special.delete_repeat" : "special.delete", { name: this.baseline.name })}
      </p>
      ${deleting.message ? html`<p role="alert" data-test="delete-refusal">${deleting.message}</p>` : nothing}
      <wt-form-actions slot="footer"
        ><wt-button
          slot="cancel"
          data-test="cancel-delete"
          variant="secondary"
          ?disabled=${deleting.busy}
          @click=${() => {
            this.deleting = undefined;
          }}
          >${t("hours.cancel")}</wt-button
        ><wt-button
          data-test="confirm-delete"
          variant="danger"
          ?disabled=${deleting.busy}
          ?loading=${deleting.busy}
          @click=${() => void this.confirmDelete()}
          >${t("hours.delete")}</wt-button
        ></wt-form-actions
      >
    </wt-dialog>`;
  }

  override render() {
    if (!this.model) return nothing;
    const locked = this.readOnly || this.saving || this.loading || this.loadFailed;
    const stored = this.specialDayId !== null && !this.loading && !this.loadFailed;
    return html`<painter-frame
        .open=${this.open}
        .heading=${this.heading()}
        .scope=${this.scope}
        .coordinator=${this.coordinator}
        .dirty=${
          !this.offered &&
          !saveActionState(this.scope, { savableAtOpen: this.savableAtOpen }).unchanged &&
          !this.blocked()
        }
        .busy=${this.saving}
        .refusal=${this.message()}
        .readOnly=${this.readOnly}
        @painter-save=${() => void this.save()}
        @painter-close=${() => {
          this.open = false;
          this.seeded = undefined;
          this.generation = {};
          this.seedToken = {};
          this.unanswered = undefined;
          this.filling = undefined;
          this.saving = false;
          this.adding = false;
          this.deleting = undefined;
          this.offered = undefined;
          this.notice = "";
          this.closeMonth();
          this.forgetSeason();
        }}
      >
        ${
          stored && !this.readOnly
            ? html`<wt-button
                slot="actions"
                data-test="delete"
                variant="secondary"
                ?disabled=${this.saving}
                @click=${() => {
                  this.deleting = { busy: false, message: "" };
                }}
                >${t("hours.delete")}</wt-button
              >`
            : nothing
        }
        ${this.pickerFor()}${this.linkFor()}
        <div class="body">
          ${this.offered ? this.offer(this.offered) : this.panel(locked)}
          <div class="dates">${this.paintArea(locked || this.offered !== undefined)}</div>
        </div>
      </painter-frame>
      ${this.deleteDialog()}${this.periods.render()}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "special-day-painter": SpecialDayPainter;
  }
}
