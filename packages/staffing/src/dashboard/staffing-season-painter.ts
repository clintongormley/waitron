import {
  dateFormat,
  formatMonthDay,
  formatDate,
} from "@waitron/venue-service/dashboard/hours-view";
import { css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { conjunctionList } from "@waitron/shared";
import { currentLocale } from "@waitron/dashboard-kit";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import { seasonTints, seasonTintStyles } from "@waitron/venue-service/dashboard/season-tint";
import { paintRowStyles, periodColourStyles, seasonLastDay } from "@waitron/venue-service/painter";
import { seasonStepper, seasonStepperStyles } from "@waitron/venue-service/dashboard/painter-parts";
import { copyBlocks, sameBlocks } from "../block-model.js";
import { areaKey, blockSpan, type StaffingBlock } from "../slots.js";
import type { SeasonStaffing, SeasonStaffingEdit } from "../staffing-types.js";
import { StaffingPainterBase } from "./staffing-painter-base.js";
import { weekdayDate } from "./format.js";
import {
  NOTHING_BY_KEY,
  areaPicker,
  droppedNotice,
  guideText,
  paintRow,
  painterStyles,
  refusedEdit,
} from "./painter-parts.js";
import type { StaffingChange, StaffingColumn } from "./staffing-grid.js";
import { t, tf } from "./strings.js";
import "./staffing-grid.js";

/** Blocks per weekday key ("1" Monday … "0" Sunday). */
type Week = Map<string, StaffingBlock[]>;
/** One week per area key. */
type Draft = Map<string, Week>;

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
export class StaffingSeasonPainter extends StaffingPainterBase<
  SeasonStaffing,
  Draft,
  SeasonStaffingEdit
> {
  static override styles = [
    baseStyles,
    seasonTintStyles,
    periodColourStyles,
    paintRowStyles,
    seasonStepperStyles,
    painterStyles,
    css`
      staffing-grid::part(column-error) {
        contain: inline-size;
        position: static;
        grid-column: 1 / -1;
        grid-row: 2;
        inline-size: auto;
        block-size: auto;
        overflow: visible;
        clip: auto;
        white-space: normal;
        font-weight: var(--wt-font-weight-normal);
      }
    `,
  ];

  @property() seasonId = "";
  protected get identity(): string {
    return this.seasonId ? `${this.seasonId}/${this.month}` : "";
  }
  protected readData() {
    return this.api.readSeason(this.seasonId, this.month);
  }
  protected saveData(_id: string, edits: SeasonStaffingEdit[]) {
    return this.api.saveSeason(this.seasonId, edits, this.read!.month);
  }
  protected seed = seed;
  protected copyDraft = copyDraft;
  protected sameDraft = sameDraft;
  private weekColumns?: { locale: string; columns: readonly StaffingColumn[] };

  /** Each day not edited takes the fresh read; an edited day stays, now against the fresh one.
   *  An area the fresh read no longer has loses its edits, named in the notice. Every area in the
   *  draft came from `previous`. */
  protected take(fresh: Draft, previous: SeasonStaffing | undefined): void {
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

  private step(by: number): void {
    const seasons = this.read!.seasons;
    const at = seasons.findIndex(({ id }) => id === this.seasonId);
    const next = seasons[(at + by + seasons.length) % seasons.length]!;
    this.open(
      "staffing",
      { ...this.addressParams(), painter: "season", season: next.id },
      { replace: true },
    );
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

  protected edits(read: SeasonStaffing): SeasonStaffingEdit[] {
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

  protected savedBaseline(edits: SeasonStaffingEdit[]): Draft {
    const baseline = copyDraft(this.baseline);
    for (const { area, weekday, blocks } of edits)
      baseline.get(areaKey(area))!.set(String(weekday), copyBlocks(blocks));
    return baseline;
  }

  /** `staffing.invalid` naming `edits.<i>` shows the i-th sent edit's area and marks its day. */
  protected refuse(error: unknown, edits: SeasonStaffingEdit[], read: SeasonStaffing): void {
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

  private seasonChip(read: SeasonStaffing) {
    // The read refuses a season that is gone, so it always lists this one.
    const season = read.seasons.find(({ id }) => id === this.seasonId)!;
    const single = read.seasons.length < 2;
    return seasonStepper({
      label: tf("staffing.month.season", {
        name: season.name,
        from: formatMonthDay(season.startsOn),
        to: formatMonthDay(seasonLastDay(read.seasons, season.startsOn)),
      }),
      tint: seasonTints(read.seasons).get(season.id)!,
      previousLabel: t("staffing.painter.previous_season"),
      nextLabel: t("staffing.painter.next_season"),
      disabled: single || this.saving,
      step: (by) => {
        if (!single) this.step(by);
      },
    });
  }

  private invalidColumns(read: SeasonStaffing, area: string): ReadonlyMap<string, string> {
    if (this.readOnly) return NOTHING_BY_KEY;
    const errors = new Map<string, string>();
    for (const [weekday, blocks] of this.draft.get(area) ?? []) {
      const starts = read.weekdayCutovers[Number(weekday)];
      const crossing = (starts?.length ? starts : [read.cutover]).find((start) =>
        blocks.some((block) => {
          const span = blockSpan(block, start);
          return span.end <= span.start;
        }),
      );
      if (crossing) errors.set(weekday, tf("staffing.painter.crosses_start", { time: crossing }));
    }
    return errors;
  }

  private content(read: SeasonStaffing | undefined, shown: string, chosen: string | undefined) {
    if (!read)
      return this.loadError
        ? html`<p class="message" role="alert" data-test="load-error">${this.loadError}</p>`
        : html`<p class="message" data-test="loading">${t("staffing.painter.loading")}</p>`;
    if (!read.areas.length)
      return html`<p class="message" data-test="no-areas">${t("staffing.painter.no_areas")}</p>`;
    const columns = this.columns();
    const invalid = this.invalidColumns(read, shown);
    return html`<staffing-grid
      .target=${`${this.seasonId}/${shown}`}
      .columns=${columns}
      .days=${this.draft.get(shown) ?? NOTHING_BY_KEY}
      .guides=${this.guides(read.guides[shown], columns)}
      .guideKind=${read.areas.find(({ area }) => areaKey(area) === shown)!.area.kind}
      .guideDepartmentIds=${read.areas.filter(({ area }) => area.kind === "department").map(({ area }) => area.id)}
      .staffRoles=${this.staffRoles}
      .chosen=${chosen}
      .headcount=${this.headcount}
      .cutover=${read.cutover}
      .readOnly=${this.readOnly || this.saving}
      .columnErrors=${invalid.size ? invalid : this.columnErrors(this.refused, shown)}
      @staffing-change=${(event: CustomEvent<StaffingChange>) => this.paint(shown, event)}
    ></staffing-grid>`;
  }

  override render() {
    const read = this.read;
    const invalidAreas =
      read?.areas
        .filter(({ area }) => this.invalidColumns(read, areaKey(area)).size)
        .map(({ name }) => name) ?? [];
    const invalid = invalidAreas.length > 0;
    const invalidMessage = invalid
      ? tf("staffing.painter.fix_blocks", { areas: conjunctionList(invalidAreas, currentLocale()) })
      : "";
    const shown = read ? this.areaShown(read) : "";
    const chosen = this.chosenRole();
    const shownArea = read?.areas.find(({ area }) => areaKey(area) === shown);
    const season = read?.seasons.find(({ id }) => id === this.seasonId);
    return html`<painter-frame
        .open=${true}
        .band=${read ? (seasonTints(read.seasons).get(this.seasonId) ?? "grey") : ""}
        .heading=${
          read
            ? tf("staffing.painter.week", { season: season!.name })
            : t("staffing.painter.heading")
        }
        .scope=${this.scope}
        .coordinator=${this.coordinator}
        .dirty=${!invalid && (this.scope?.isDirty() ?? false)}
        .busy=${this.saving}
        .refusal=${[invalidMessage, this.refused?.message ?? [this.refreshError, this.notice].filter(Boolean).join(" ")].filter(Boolean).join(" ")}
        .readOnly=${this.readOnly}
        @painter-save=${() => {
          if (!invalid) void this.save();
        }}
        @painter-close=${() => this.closePainter()}
      >
        ${this.viewSwitch(() =>
          this.open(
            "season",
            {
              season: this.seasonId,
              ...(shownArea?.area.kind === "department" ? { department: shownArea.area.id } : {}),
            },
            { replace: true },
          ),
        )}
        ${read ? this.seasonChip(read) : nothing}
        ${
          read
            ? html`<p slot="row" class="covers" data-test="covers">
                ${tf("staffing.painter.week_covers", {
                  from: formatMonthDay(season!.startsOn),
                  to: formatMonthDay(seasonLastDay(read.seasons, season!.startsOn)),
                })}
              </p>`
            : nothing
        }
        ${read?.areas.length ? areaPicker(read.areas, shown, this.saving, (value) => this.pick(value)) : nothing}
        ${
          read?.areas.length && !this.readOnly
            ? paintRow({
                guideText: guideText(shownArea!),
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
        ${this.readOnly && shownArea ? html`<div slot="row" class="guide-read-only" data-test="guide-hint">${guideText(shownArea)}</div>` : nothing}
        ${read?.cutoverChanges.length ? html`<p slot="row" class="covers" data-test="cutover-changes">${read.cutoverChanges.map((change) => tf("staffing.painter.start_changes", { date: formatDate(change.effectiveBusinessDay), time: change.dayCutover })).join(" ")}</p>` : nothing}
        ${this.content(read, shown, chosen)}
      </painter-frame>
      ${this.roleDialog()}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "staffing-season-painter": StaffingSeasonPainter;
  }
}
