import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { QueryController, codeMessage, codeOf, currentLocale } from "@waitron/dashboard-kit";
import {
  baseStyles,
  draftScopeFor,
  saveActionState,
  type DraftScope,
  type LeaveCoordinator,
} from "@waitron/ui";
import { paintRowStyles, periodColourStyles } from "@waitron/venue-service/painter";
import { copyBlocks, sameBlocks } from "../block-model.js";
import { areaKey, type StaffingBlock } from "../slots.js";
import type { SpecialDayStaffing, SpecialDayStaffingEdit, StaffRole } from "../staffing-types.js";
import type { StaffingApi } from "./client.js";
import { dateLabel } from "./format.js";
import {
  NOTHING_BY_KEY,
  areaPicker,
  droppedNotice,
  columnErrorsKeeper,
  guidesKeeper,
  guideText,
  paintRow,
  painterStyles,
  refusedEdit,
  staffRoleDialog,
} from "./painter-parts.js";
import type { StaffingChange, StaffingColumn } from "./staffing-grid.js";
import { t, tf } from "./strings.js";
import "./staffing-grid.js";

/** Blocks per date id; null follows the season. */
type Dates = Map<string, StaffingBlock[] | null>;
/** One set of dates per area key. */
type Draft = Map<string, Dates>;
interface Refused {
  message: string;
  area?: string;
  column?: string;
  reason?: string;
}

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
export class StaffingSpecialDayPainter extends LitElement {
  static override styles = [baseStyles, periodColourStyles, paintRowStyles, painterStyles];

  @property({ attribute: false }) api!: StaffingApi;
  @property() specialDayId = "";
  /** The address's area key; the picker starts there and never writes it back. */
  @property() area = "";
  /** The Calendar's month, YYYY-MM, kept when closing. */
  @property() month = "";
  @property({ type: Boolean }) readOnly = false;
  /** Moves the Calendar's address. */
  @property({ attribute: false }) open!: (view: string, params: Record<string, string>) => void;

  @state() private read?: SpecialDayStaffing;
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
  /** Replaced whenever a save's answer would land on a special day it no longer belongs to. */
  private generation = {};
  /** Replaced by every read, so only the latest one's answer is taken. */
  private latestRead = {};
  private scope?: DraftScope<Draft>;
  private coordinator?: LeaveCoordinator;
  private watchingRoles = false;
  private dateColumns?: { key: string; columns: readonly StaffingColumn[] };
  private readonly guides = guidesKeeper();
  private readonly columnErrors = columnErrorsKeeper();

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
    if (this.specialDayId && this.specialDayId !== this.readFor) this.load();
    if (this.api && !this.watchingRoles) {
      this.watchingRoles = true;
      this.api
        .watchStaffRoles(
          this.#roles,
          (staffRoles) => {
            this.staffRoles = staffRoles;
            this.rolesError = undefined;
          },
          "painter-staff-roles",
        )
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
    const specialDayId = this.specialDayId;
    const token = (this.latestRead = {});
    if (!afterSave) {
      this.generation = {};
      this.readFor = specialDayId;
      this.read = undefined;
      this.loadError = undefined;
      this.refused = undefined;
      this.notice = "";
      this.refreshError = "";
      this.saving = false;
      this.draft = new Map();
      this.commitBaseline(new Map());
    }
    this.api.readSpecialDay(specialDayId).then(
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

  /** Each date not edited takes the fresh read; an edited date stays, now against the fresh one.
   *  An area or a date the fresh read no longer has loses its edits, named in the notice. Every
   *  area and date in the draft came from `previous`. */
  private take(fresh: Draft, previous: SpecialDayStaffing | undefined): void {
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
    const goneDates = lost.size
      ? previous!.areas[0]!.dates.filter(({ dateId }) => lost.has(dateId))
      : [];
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

  private commitBaseline(baseline: Draft): void {
    this.baseline = baseline;
    this.scope?.commit(copyDraft(baseline));
    if (!sameDraft(this.draft, baseline)) this.scope?.changed();
  }

  private areaShown(read: SpecialDayStaffing): string {
    const keys = read.areas.map(({ area }) => areaKey(area));
    return [this.shown, this.area].find((key) => keys.includes(key)) ?? keys[0] ?? "";
  }

  private addressParams(): Record<string, string> {
    return this.area ? { month: this.month, area: this.area } : { month: this.month };
  }

  private pick(value: string): void {
    if (!this.read!.areas.some(({ area }) => areaKey(area) === value)) return;
    this.notice = "";
    this.shown = value;
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

  private edits(read: SpecialDayStaffing): SpecialDayStaffingEdit[] {
    return read.areas.flatMap(({ area }) => {
      const key = areaKey(area);
      const dates = this.draft.get(key)!;
      return [...dates]
        .filter(([dateId, day]) => !sameBlocks(day, this.baseline.get(key)?.get(dateId)))
        .map(([dateId, day]) => ({ area: { ...area }, dateId, blocks: copyBlocks(day) }));
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
      await this.api.saveSpecialDay(this.specialDayId, edits);
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
    for (const { area, dateId, blocks } of edits)
      baseline.get(areaKey(area))!.set(dateId, copyBlocks(blocks));
    this.commitBaseline(baseline);
    this.load(true);
  }

  /** `staffing.invalid` naming `edits.<i>` shows the i-th sent edit's area and marks its date. */
  private refuse(error: unknown, edits: SpecialDayStaffingEdit[], read: SpecialDayStaffing): void {
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
    const dates = read.areas[0]!.dates;
    const key = `${currentLocale()} ${dates.map(({ dateId, date }) => `${dateId}=${date}`).join(",")}`;
    if (this.dateColumns?.key !== key)
      this.dateColumns = {
        key,
        columns: dates.map(({ dateId, date }) => ({ key: dateId, label: dateLabel(date) })),
      };
    return this.dateColumns.columns;
  }

  private chosenRole(): string | undefined {
    return this.staffRoles.some(({ id }) => id === this.chosen)
      ? this.chosen
      : this.staffRoles[0]?.id;
  }

  private content(read: SpecialDayStaffing | undefined, shown: string, chosen: string | undefined) {
    if (!read)
      return this.loadError
        ? html`<p class="message" role="alert" data-test="load-error">${this.loadError}</p>`
        : html`<p class="message" data-test="loading">${t("staffing.painter.loading")}</p>`;
    if (!read.areas.length)
      return html`<p class="message" data-test="no-areas">${t("staffing.painter.no_areas")}</p>`;
    if (!read.areas[0]!.dates.length)
      return html`<p class="message" data-test="no-dates">${t("staffing.painter.no_dates")}</p>`;
    const columns = this.columns(read);
    return html`<staffing-grid
      followable
      .target=${`${this.specialDayId}/${shown}`}
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
      .columnErrors=${this.columnErrors(this.refused, shown)}
      @staffing-change=${(event: CustomEvent<StaffingChange>) => this.paint(shown, event)}
    ></staffing-grid>`;
  }

  override render() {
    const read = this.read;
    const shown = read ? this.areaShown(read) : "";
    const chosen = this.chosenRole();
    const shownArea = read?.areas.find(({ area }) => areaKey(area) === shown);
    const paintable = !!read?.areas[0]?.dates.length;
    return html`<painter-frame
        .open=${true}
        .heading=${read ? read.name : t("staffing.painter.heading")}
        .scope=${this.scope}
        .coordinator=${this.coordinator}
        .dirty=${this.scope?.isDirty() ?? false}
        .busy=${this.saving}
        .refusal=${this.refused?.message ?? [this.refreshError, this.notice].filter(Boolean).join(" ")}
        .readOnly=${this.readOnly}
        @painter-save=${() => void this.save()}
        @painter-close=${() => this.open("staffing", this.addressParams())}
      >
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
      ${
        this.readOnly
          ? nothing
          : staffRoleDialog(
              this.api,
              this.dialogOpen,
              this.staffRoles,
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
    "staffing-special-day-painter": StaffingSpecialDayPainter;
  }
}
