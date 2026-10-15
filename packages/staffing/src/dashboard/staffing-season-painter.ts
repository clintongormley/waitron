import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { QueryController, codeMessage, codeOf, currentLocale } from "@waitron/dashboard-kit";
import {
  baseStyles,
  draftScopeFor,
  saveActionState,
  type DraftScope,
  type LeaveCoordinator,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import { seasonTints, seasonTintStyles } from "@waitron/venue-service/dashboard/season-tint";
import { paintRowStyles, periodColourStyles, seasonLastDay } from "@waitron/venue-service/painter";
import { copyBlocks, sameBlocks } from "../block-model.js";
import { areaKey, type StaffingBlock } from "../slots.js";
import type { SeasonStaffing, SeasonStaffingEdit, StaffRole } from "../staffing-types.js";
import type { StaffingApi } from "./client.js";
import { dateFormat, monthDay, weekdayDate } from "./format.js";
import {
  NOTHING_BY_KEY,
  areaPicker,
  droppedNotice,
  guidesKeeper,
  paintRow,
  painterStyles,
  refusedEdit,
  staffRoleDialog,
} from "./painter-parts.js";
import type { StaffingChange, StaffingColumn } from "./staffing-grid.js";
import { t, tf } from "./strings.js";
import "./staffing-grid.js";

/** Blocks per weekday key ("1" Monday … "0" Sunday). */
type Week = Map<string, StaffingBlock[]>;
/** One week per area key. */
type Draft = Map<string, Week>;
interface Refused {
  message: string;
  area?: string;
  column?: string;
  reason?: string;
}

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const;

const copyWeek = (week: ReadonlyMap<string, readonly StaffingBlock[]>): Week =>
  new Map([...week].map(([key, day]) => [key, copyBlocks(day)]));
const copyDraft = (draft: Draft): Draft =>
  new Map([...draft].map(([key, week]) => [key, copyWeek(week)]));
const sameWeek = (a: Week, b?: Week) =>
  WEEKDAYS.every((weekday) => sameBlocks(a.get(String(weekday)), b?.get(String(weekday))));
const sameDraft = (a: Draft, b: Draft) =>
  a.size === b.size && [...a].every(([key, week]) => sameWeek(week, b.get(key)));

function seed(read: SeasonStaffing): Draft {
  return new Map(
    read.areas.map(({ area, weekdays }) => [
      areaKey(area),
      new Map(WEEKDAYS.map((weekday) => [String(weekday), copyBlocks(weekdays[weekday] ?? [])])),
    ]),
  );
}

/**
 * One season's staffing week, per department and prep station, painted in venue-service's frame.
 * The draft holds every area, so the picker keeps edits. The season's staffing is read when the
 * painter opens or steps and after each save, never on a live change; the staff roles follow live
 * changes.
 */
@customElement("staffing-season-painter")
export class StaffingSeasonPainter extends LitElement {
  static override styles = [
    baseStyles,
    seasonTintStyles,
    periodColourStyles,
    paintRowStyles,
    painterStyles,
    css`
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
    `,
  ];

  @property({ attribute: false }) api!: StaffingApi;
  @property() seasonId = "";
  /** The address's area key; the picker starts there and never writes it back. */
  @property() area = "";
  /** The Calendar's month, YYYY-MM, kept when stepping and closing. */
  @property() month = "";
  @property({ type: Boolean }) readOnly = false;
  /** Moves the Calendar's address. */
  @property({ attribute: false }) open!: (view: string, params: Record<string, string>) => void;

  @state() private read?: SeasonStaffing;
  @state() private loadError?: string;
  @state() private draft: Draft = new Map();
  @state() private shown = "";
  @state() private chosen?: string;
  @state() private headcount = 1;
  @state() private staffRoles: StaffRole[] = [];
  @state() private rolesError?: string;
  @state() private saving = false;
  @state() private refused?: Refused;
  /** Edits a re-read dropped because their area is gone. */
  @state() private notice = "";
  /** Why the read after a successful save failed; cleared only by a read that succeeds. */
  @state() private refreshError = "";
  @state() private dialogOpen = false;
  private baseline: Draft = new Map();
  private readFor?: string;
  /** Replaced whenever a save's answer would land on a season it no longer belongs to. */
  private generation = {};
  /** Replaced by every read, so only the latest one's answer is taken. */
  private latestRead = {};
  private scope?: DraftScope<Draft>;
  private coordinator?: LeaveCoordinator;
  private watchingRoles = false;
  private weekColumns?: { locale: string; columns: readonly StaffingColumn[] };
  private readonly guides = guidesKeeper();

  readonly #roles = new QueryController(
    this,
    () => this.api.liveData,
    (error) => {
      this.rolesError = tf("staffing.role.load_error", { reason: codeMessage(codeOf(error)) });
    },
  );

  override connectedCallback(): void {
    super.connectedCallback();
    this.watchingRoles = false;
    this.requestUpdate();
  }

  override disconnectedCallback(): void {
    this.scope?.dispose();
    this.scope = undefined;
    this.coordinator = undefined;
    super.disconnectedCallback();
  }

  protected override willUpdate(): void {
    if (this.seasonId && this.seasonId !== this.readFor) this.load();
    if (this.api && !this.watchingRoles) {
      this.watchingRoles = true;
      this.api
        .watchStaffRoles(this.#roles, (staffRoles) => {
          this.staffRoles = staffRoles;
          this.rolesError = undefined;
        })
        .catch(() => {
          // The controller's error callback has already said why.
        });
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
      scope.commit(copyDraft(this.baseline));
      if (!sameDraft(this.draft, this.baseline)) scope.changed();
    }
  }

  /** `afterSave` keeps the draft and takes the answer in with `take`. */
  private load(afterSave = false): void {
    const seasonId = this.seasonId;
    const token = (this.latestRead = {});
    if (!afterSave) {
      this.generation = {};
      this.readFor = seasonId;
      this.read = undefined;
      this.loadError = undefined;
      this.refused = undefined;
      this.notice = "";
      this.refreshError = "";
      this.saving = false;
      this.draft = new Map();
      this.commitBaseline(new Map());
    }
    this.api.readSeason(seasonId).then(
      (read) => {
        if (token !== this.latestRead) return;
        const previous = this.read;
        this.read = read;
        this.refreshError = "";
        this.take(seed(read), previous);
      },
      (error: unknown) => {
        if (token !== this.latestRead) return;
        const reason = codeMessage(codeOf(error));
        if (afterSave) this.refreshError = tf("staffing.painter.refresh_error", { reason });
        else this.loadError = tf("staffing.painter.load_error", { reason });
      },
    );
  }

  /** Each day not edited takes the fresh read; an edited day stays, now against the fresh one.
   *  An area the fresh read no longer has loses its edits, named in the notice. Every area in the
   *  draft came from `previous`. */
  private take(fresh: Draft, previous: SeasonStaffing | undefined): void {
    const gone = [...this.draft]
      .filter(([key, week]) => !fresh.has(key) && !sameWeek(week, this.baseline.get(key)))
      .map(([key]) => previous!.areas.find(({ area }) => areaKey(area) === key)!.name);
    if (gone.length) this.notice = droppedNotice(gone);
    const draft: Draft = new Map();
    for (const [key, week] of fresh) {
      const current = this.draft.get(key);
      const before = this.baseline.get(key);
      draft.set(
        key,
        new Map(
          [...week].map(([weekday, day]) => {
            const edited = current && !sameBlocks(current.get(weekday), before?.get(weekday));
            return [weekday, edited ? current.get(weekday)! : copyBlocks(day)];
          }),
        ),
      );
    }
    this.draft = draft;
    this.commitBaseline(fresh);
  }

  private commitBaseline(baseline: Draft): void {
    this.baseline = baseline;
    this.scope?.commit(copyDraft(baseline));
    if (!sameDraft(this.draft, baseline)) this.scope?.changed();
  }

  private areaShown(read: SeasonStaffing): string {
    const keys = read.areas.map(({ area }) => areaKey(area));
    return [this.shown, this.area].find((key) => keys.includes(key)) ?? keys[0] ?? "";
  }

  private addressParams(): Record<string, string> {
    return this.area ? { month: this.month, area: this.area } : { month: this.month };
  }

  private step(by: number): void {
    const seasons = this.read!.seasons;
    const at = seasons.findIndex(({ id }) => id === this.seasonId);
    const next = seasons[(at + by + seasons.length) % seasons.length]!;
    this.open("staffing", { ...this.addressParams(), painter: "season", season: next.id });
  }

  private pick(value: string): void {
    if (!this.read!.areas.some(({ area }) => areaKey(area) === value)) return;
    this.notice = "";
    this.shown = value;
  }

  private paint(key: string, event: CustomEvent<StaffingChange>): void {
    event.stopPropagation();
    const week = copyWeek(this.draft.get(key)!);
    week.set(event.detail.key, event.detail.blocks ?? []);
    this.notice = "";
    if (this.refused?.area === key && this.refused.column === event.detail.key)
      this.refused = undefined;
    this.draft = new Map(this.draft).set(key, week);
    this.scope?.changed();
  }

  private edits(read: SeasonStaffing): SeasonStaffingEdit[] {
    return read.areas.flatMap(({ area }) => {
      const key = areaKey(area);
      const week = this.draft.get(key)!;
      return WEEKDAYS.filter(
        (weekday) =>
          !sameBlocks(week.get(String(weekday)), this.baseline.get(key)?.get(String(weekday))),
      ).map((weekday) => ({
        area: { ...area },
        weekday,
        blocks: copyBlocks(week.get(String(weekday))!),
      }));
    });
  }

  private async save(): Promise<void> {
    if (this.saving || saveActionState(this.scope).unchanged) return;
    const read = this.read!;
    const edits = this.edits(read);
    const generation = this.generation;
    this.saving = true;
    this.notice = "";
    this.refused = undefined;
    try {
      await this.api.saveSeason(this.seasonId, edits);
    } catch (error) {
      if (generation === this.generation) {
        this.saving = false;
        this.refuse(error, edits, read);
      }
      return;
    }
    if (generation !== this.generation) return;
    this.saving = false;
    const baseline = copyDraft(this.baseline);
    for (const { area, weekday, blocks } of edits)
      baseline.get(areaKey(area))!.set(String(weekday), copyBlocks(blocks));
    this.commitBaseline(baseline);
    this.load(true);
  }

  /** `staffing.invalid` naming `edits.<i>` shows the i-th sent edit's area and marks its day. */
  private refuse(error: unknown, edits: SeasonStaffingEdit[], read: SeasonStaffing): void {
    const { message, edit } = refusedEdit(error, edits);
    if (!edit) {
      this.refused = { message };
      return;
    }
    const key = areaKey(edit.area);
    this.shown = key;
    this.refused = {
      message: tf("staffing.painter.refused_on", {
        area: read.areas.find(({ area }) => areaKey(area) === key)!.name,
        day: dateFormat({ weekday: "long" }).format(weekdayDate(edit.weekday)),
        message,
      }),
      area: key,
      column: String(edit.weekday),
      reason: message,
    };
  }

  private columns(): readonly StaffingColumn[] {
    const locale = currentLocale();
    if (this.weekColumns?.locale !== locale) {
      const format = dateFormat({ weekday: "long" });
      this.weekColumns = {
        locale,
        columns: WEEKDAYS.map((weekday) => ({
          key: String(weekday),
          label: format.format(weekdayDate(weekday)),
        })),
      };
    }
    return this.weekColumns.columns;
  }

  private chosenRole(): string | undefined {
    return this.staffRoles.some(({ id }) => id === this.chosen)
      ? this.chosen
      : this.staffRoles[0]?.id;
  }

  private seasonChip(read: SeasonStaffing) {
    // The read refuses a season that is gone, so it always lists this one.
    const season = read.seasons.find(({ id }) => id === this.seasonId)!;
    const single = read.seasons.length < 2;
    return html`<span slot="picker" class="season">
      <wt-button
        data-test="previous-season"
        variant="ghost"
        aria-label=${t("staffing.painter.previous_season")}
        ?disabled=${single || this.saving}
        @click=${() => {
          if (!single) this.step(-1);
        }}
        >‹</wt-button
      >
      <span class="chip" data-test="season" data-tint=${seasonTints(read.seasons).get(season.id)!}
        >${tf("staffing.month.season", {
          name: season.name,
          from: monthDay(season.startsOn),
          to: monthDay(seasonLastDay(read.seasons, season.startsOn)),
        })}</span
      >
      <wt-button
        data-test="next-season"
        variant="ghost"
        aria-label=${t("staffing.painter.next_season")}
        ?disabled=${single || this.saving}
        @click=${() => {
          if (!single) this.step(1);
        }}
        >›</wt-button
      >
    </span>`;
  }

  private content(read: SeasonStaffing | undefined, shown: string, chosen: string | undefined) {
    if (!read)
      return this.loadError
        ? html`<p class="message" role="alert" data-test="load-error">${this.loadError}</p>`
        : html`<p class="message" data-test="loading">${t("staffing.painter.loading")}</p>`;
    if (!read.areas.length)
      return html`<p class="message" data-test="no-areas">${t("staffing.painter.no_areas")}</p>`;
    const columns = this.columns();
    return html`<staffing-grid
      .target=${`${this.seasonId}/${shown}`}
      .columns=${columns}
      .days=${this.draft.get(shown) ?? NOTHING_BY_KEY}
      .guides=${this.guides(read.guides[shown], columns)}
      .staffRoles=${this.staffRoles}
      .chosen=${chosen}
      .headcount=${this.headcount}
      .cutover=${read.cutover}
      .readOnly=${this.readOnly || this.saving}
      .columnErrors=${
        this.refused?.area === shown && this.refused.column !== undefined
          ? new Map([[this.refused.column, this.refused.reason!]])
          : NOTHING_BY_KEY
      }
      @staffing-change=${(event: CustomEvent<StaffingChange>) => this.paint(shown, event)}
    ></staffing-grid>`;
  }

  override render() {
    const read = this.read;
    const shown = read ? this.areaShown(read) : "";
    const chosen = this.chosenRole();
    return html`<painter-frame
        .open=${true}
        .heading=${
          read
            ? tf("staffing.painter.week", {
                season: read.seasons.find(({ id }) => id === this.seasonId)!.name,
              })
            : t("staffing.painter.heading")
        }
        .scope=${this.scope}
        .coordinator=${this.coordinator}
        .dirty=${this.scope?.isDirty() ?? false}
        .busy=${this.saving}
        .refusal=${this.refused?.message ?? [this.refreshError, this.notice].filter(Boolean).join(" ")}
        .readOnly=${this.readOnly}
        @painter-save=${() => void this.save()}
        @painter-close=${() => this.open("staffing", this.addressParams())}
      >
        ${read ? this.seasonChip(read) : nothing}
        ${read?.areas.length ? areaPicker(read.areas, shown, this.saving, (value) => this.pick(value)) : nothing}
        ${
          read?.areas.length && !this.readOnly
            ? paintRow({
                staffRoles: this.staffRoles,
                chosen,
                headcount: () => this.headcount,
                rolesError: this.rolesError,
                choose: (staffRoleId) => {
                  this.chosen = staffRoleId;
                },
                setHeadcount: (headcount) => {
                  this.headcount = headcount;
                },
                newStaffRole: () => {
                  this.dialogOpen = true;
                },
              })
            : nothing
        }
        ${this.content(read, shown, chosen)}
      </painter-frame>
      ${
        this.readOnly
          ? nothing
          : staffRoleDialog(
              this.api,
              this.dialogOpen,
              (saved) => {
                if (!this.staffRoles.some(({ id }) => id === saved.id))
                  this.staffRoles = [...this.staffRoles, saved];
                this.chosen = saved.id;
              },
              () => {
                this.dialogOpen = false;
              },
            )
      }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "staffing-season-painter": StaffingSeasonPainter;
  }
}
