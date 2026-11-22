import { html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { currentLocale } from "@waitron/dashboard-kit";
import { baseStyles } from "@waitron/ui";
import { formatDateRuns, paintRowStyles, periodColourStyles } from "@waitron/venue-service/painter";
import { copyBlocks, sameBlocks } from "../block-model.js";
import { areaKey, type StaffingBlock } from "../slots.js";
import type { SpecialDayStaffing, SpecialDayStaffingEdit } from "../staffing-types.js";
import { StaffingPainterBase } from "./staffing-painter-base.js";
import { dateLabel } from "./format.js";
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

/** Blocks per date id; null follows the season. */
type Dates = Map<string, StaffingBlock[] | null>;
/** One set of dates per area key. */
type Draft = Map<string, Dates>;

const copyDates = (dates: ReadonlyMap<string, readonly StaffingBlock[] | null>): Dates =>
  new Map([...dates].map(([key, day]) => [key, copyBlocks(day)]));
const copyDraft = (draft: Draft): Draft =>
  new Map([...draft].map(([key, dates]) => [key, copyDates(dates)]));
const sameDates = (a: Dates, b?: Dates) =>
  [...a].every(([key, day]) => sameBlocks(day, b?.get(key)));
const sameDraft = (a: Draft, b: Draft) =>
  a.size === b.size && [...a].every(([key, dates]) => sameDates(dates, b.get(key)));

function seed(read: SpecialDayStaffing): Draft {
  return new Map(
    read.areas.map(({ area, dates }) => [
      areaKey(area),
      new Map(dates.map(({ dateId, blocks }) => [dateId, copyBlocks(blocks)])),
    ]),
  );
}

/**
 * One special day's staffing, a column per date, per department and prep station, painted in
 * venue-service's frame. A date may follow the season, which the server stores as no row. The
 * special day's staffing is read when the painter opens and after each save, never on a live
 * change; the staff roles follow live changes.
 */
@customElement("staffing-special-day-painter")
export class StaffingSpecialDayPainter extends StaffingPainterBase<
  SpecialDayStaffing,
  Draft,
  SpecialDayStaffingEdit
> {
  static override styles = [baseStyles, periodColourStyles, paintRowStyles, painterStyles];

  @property() specialDayId = "";
  protected get identity(): string {
    return this.specialDayId;
  }
  protected readData(id: string) {
    return this.api.readSpecialDay(id);
  }
  protected saveData(id: string, edits: SpecialDayStaffingEdit[]) {
    return this.api.saveSpecialDay(id, edits);
  }
  protected seed = seed;
  protected copyDraft = copyDraft;
  protected sameDraft = sameDraft;
  private dateColumns?: { key: string; columns: readonly StaffingColumn[] };

  /** Each date not edited takes the fresh read; an edited date stays, now against the fresh one.
   *  An area or a date the fresh read no longer has loses its edits, named in the notice. Every
   *  area and date in the draft came from `previous`. */
  protected take(fresh: Draft, previous: SpecialDayStaffing | undefined): void {
    const gone = [...this.draft]
      .filter(([key, dates]) => !fresh.has(key) && !sameDates(dates, this.baseline.get(key)))
      .map(([key]) => previous!.areas.find(({ area }) => areaKey(area) === key)!.name);
    const lost = new Set<string>();
    for (const [key, dates] of this.draft) {
      const kept = fresh.get(key);
      if (!kept) continue;
      for (const [dateId, day] of dates)
        if (!kept.has(dateId) && !sameBlocks(day, this.baseline.get(key)?.get(dateId)))
          lost.add(dateId);
    }
    const goneDates = lost.size ? previous!.dates.filter(({ dateId }) => lost.has(dateId)) : [];
    if (gone.length || goneDates.length)
      this.notice = droppedNotice(
        gone,
        goneDates.map(({ date }) => dateLabel(date)),
      );
    const draft: Draft = new Map();
    for (const [key, dates] of fresh) {
      const current = this.draft.get(key);
      const before = this.baseline.get(key);
      draft.set(
        key,
        new Map(
          [...dates].map(([dateId, day]) => {
            const edited = current && !sameBlocks(current.get(dateId), before?.get(dateId));
            return [dateId, edited ? current.get(dateId)! : copyBlocks(day)];
          }),
        ),
      );
    }
    this.draft = draft;
    this.commitBaseline(fresh);
  }

  private paint(key: string, event: CustomEvent<StaffingChange>): void {
    event.stopPropagation();
    const dates = copyDates(this.draft.get(key)!);
    dates.set(event.detail.key, event.detail.blocks);
    this.notice = "";
    if (this.refused?.area === key && this.refused.column === event.detail.key)
      this.refused = undefined;
    this.draft = new Map(this.draft).set(key, dates);
    this.scope?.changed();
  }

  protected edits(read: SpecialDayStaffing): SpecialDayStaffingEdit[] {
    return read.areas.flatMap(({ area }) => {
      const key = areaKey(area);
      const dates = this.draft.get(key)!;
      return [...dates]
        .filter(([dateId, day]) => !sameBlocks(day, this.baseline.get(key)?.get(dateId)))
        .map(([dateId, day]) => ({ area: { ...area }, dateId, blocks: copyBlocks(day) }));
    });
  }

  protected savedBaseline(edits: SpecialDayStaffingEdit[]): Draft {
    const baseline = copyDraft(this.baseline);
    for (const { area, dateId, blocks } of edits)
      baseline.get(areaKey(area))!.set(dateId, copyBlocks(blocks));
    return baseline;
  }

  /** `staffing.invalid` naming `edits.<i>` shows the i-th sent edit's area and marks its date. */
  protected refuse(
    error: unknown,
    edits: SpecialDayStaffingEdit[],
    read: SpecialDayStaffing,
  ): void {
    const { message, edit } = refusedEdit(error, edits);
    if (!edit) {
      this.refused = { message };
      return;
    }
    const key = areaKey(edit.area);
    const found = read.areas.find(({ area }) => areaKey(area) === key)!;
    this.shown = key;
    this.refused = {
      message: tf("staffing.painter.refused_on", {
        area: found.name,
        day: dateLabel(found.dates.find(({ dateId }) => dateId === edit.dateId)!.date),
        message,
      }),
      area: key,
      column: edit.dateId,
      reason: message,
    };
  }

  /** Kept while the dates and the language stay, so the grid sees the same columns. */
  private columns(read: SpecialDayStaffing): readonly StaffingColumn[] {
    const { dates } = read;
    const key = `${currentLocale()} ${dates.map(({ dateId, date }) => `${dateId}=${date}`).join(",")}`;
    if (this.dateColumns?.key !== key)
      this.dateColumns = {
        key,
        columns: dates.map(({ dateId, date }) => ({ key: dateId, label: dateLabel(date) })),
      };
    return this.dateColumns.columns;
  }

  private content(read: SpecialDayStaffing | undefined, shown: string, chosen: string | undefined) {
    if (!read)
      return this.loadError
        ? html`<p class="message" role="alert" data-test="load-error">${this.loadError}</p>`
        : html`<p class="message" data-test="loading">${t("staffing.painter.loading")}</p>`;
    if (!read.areas.length)
      return html`<p class="message" data-test="no-areas">${t("staffing.painter.no_areas")}</p>`;
    if (!read.dates.length)
      return html`<p class="message" data-test="no-dates">${t("staffing.painter.no_dates")}</p>`;
    const columns = this.columns(read);
    const area = read.areas.find(({ area }) => areaKey(area) === shown)!;
    return html`<staffing-grid
      followable
      .target=${`${this.specialDayId}/${shown}`}
      .columns=${columns}
      .days=${this.draft.get(shown) ?? NOTHING_BY_KEY}
      .seasonBlocks=${new Map(area.dates.map(({ dateId, seasonBlocks }) => [dateId, seasonBlocks]))}
      .guides=${this.guides(read.guides[shown], columns)}
      .guideKind=${area.area.kind}
      .guideDepartmentIds=${read.areas.filter(({ area }) => area.kind === "department").map(({ area }) => area.id)}
      .staffRoles=${this.staffRoles}
      .chosen=${chosen}
      .headcount=${this.headcount}
      .cutover=${read.cutover}
      .readOnly=${this.readOnly || this.saving}
      .columnErrors=${this.columnErrors(this.refused, shown)}
      @staffing-change=${(event: CustomEvent<StaffingChange>) => this.paint(shown, event)}
    ></staffing-grid>`;
  }

  private heading(read: SpecialDayStaffing) {
    const dates = read.dates.map(({ date }) => date);
    return dates.length
      ? tf("staffing.painter.special_day", { name: read.name, dates: formatDateRuns(dates) })
      : tf("staffing.painter.special_day_undated", { name: read.name });
  }

  override render() {
    const read = this.read;
    const shown = read ? this.areaShown(read) : "";
    const chosen = this.chosenRole();
    const shownArea = read?.areas.find(({ area }) => areaKey(area) === shown);
    const paintable = !!read?.areas.length && !!read.dates.length;
    return html`<painter-frame
        .open=${true}
        .band=${"special"}
        .heading=${read ? this.heading(read) : t("staffing.painter.heading")}
        .scope=${this.scope}
        .coordinator=${this.coordinator}
        .dirty=${this.scope?.isDirty() ?? false}
        .busy=${this.saving}
        .refusal=${this.refused?.message ?? [this.refreshError, this.notice].filter(Boolean).join(" ")}
        .readOnly=${this.readOnly}
        @painter-save=${() => void this.save()}
        @painter-close=${() => this.closePainter()}
      >
        ${this.viewSwitch(() =>
          this.open("special-day", { "special-day": this.specialDayId }, { replace: true }),
        )}
        ${
          paintable
            ? areaPicker(read.areas, shown, this.saving, (value) => this.pick(value))
            : nothing
        }
        ${
          paintable && !this.readOnly
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
        ${this.content(read, shown, chosen)}
      </painter-frame>
      ${this.roleDialog()}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "staffing-special-day-painter": StaffingSpecialDayPainter;
  }
}
