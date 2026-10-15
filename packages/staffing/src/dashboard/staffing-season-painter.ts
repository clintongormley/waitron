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
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-number-stepper.js";
import { seasonTints, seasonTintStyles } from "@waitron/venue-service/dashboard/season-tint";
import { paintRowStyles, periodColourStyles, seasonLastDay } from "@waitron/venue-service/painter";
import { areaKey, type StaffingBlock } from "../slots.js";
import type { SeasonStaffing, SeasonStaffingEdit, StaffRole } from "../staffing-types.js";
import type { StaffingApi } from "./client.js";
import type { StaffingChange, StaffingColumn } from "./staffing-grid.js";
import { t, tf } from "./strings.js";
import "./staff-role-dialog.js";
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
/** A Monday, so its week names the columns Monday first. */
const A_MONDAY = Date.UTC(2024, 0, 1);
const DAY_MS = 86_400_000;
const MAX_HEADCOUNT = 50;
const NOTHING_BY_KEY: ReadonlyMap<string, never> = new Map<string, never>();

const copyWeek = (week: ReadonlyMap<string, readonly StaffingBlock[]>): Week =>
  new Map([...week].map(([key, day]) => [key, day.map((block) => ({ ...block }))]));
const copyDraft = (draft: Draft): Draft =>
  new Map([...draft].map(([key, week]) => [key, copyWeek(week)]));
const sameDay = (a: readonly StaffingBlock[] = [], b: readonly StaffingBlock[] = []) =>
  a.length === b.length &&
  a.every(
    (block, index) =>
      block.staffRoleId === b[index]!.staffRoleId &&
      block.headcount === b[index]!.headcount &&
      block.startsAt === b[index]!.startsAt &&
      block.endsAt === b[index]!.endsAt,
  );
const sameWeek = (a: Week, b?: Week) =>
  WEEKDAYS.every((weekday) => sameDay(a.get(String(weekday)), b?.get(String(weekday))));
const sameDraft = (a: Draft, b: Draft) =>
  a.size === b.size && [...a].every(([key, week]) => sameWeek(week, b.get(key)));

function seed(read: SeasonStaffing): Draft {
  return new Map(
    read.areas.map(({ area, weekdays }) => [
      areaKey(area),
      new Map(
        WEEKDAYS.map((weekday) => [
          String(weekday),
          (weekdays[weekday] ?? []).map((block) => ({ ...block })),
        ]),
      ),
    ]),
  );
}

function droppedNotice(names: readonly string[]): string {
  const list = new Intl.ListFormat(currentLocale().startsWith("es") ? "es-ES" : "en-GB", {
    type: "conjunction",
  }).format(names);
  return tf(names.length === 1 ? "staffing.painter.removed_one" : "staffing.painter.removed_many", {
    names: list,
  });
}

function weekdayFormat(): Intl.DateTimeFormat {
  const locale = currentLocale().startsWith("es") ? "es-ES" : "en-GB";
  return new Intl.DateTimeFormat(locale, { weekday: "long", timeZone: "UTC" });
}
const weekdayDate = (weekday: number) => new Date(A_MONDAY + ((weekday + 6) % 7) * DAY_MS);
const monthDay = (md: string) =>
  new Intl.DateTimeFormat(currentLocale().startsWith("es") ? "es-ES" : "en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`2000-${md}T00:00:00Z`));

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
      .how-many {
        display: inline-flex;
        align-items: center;
      }
      .message {
        margin: var(--wt-space-3) 0;
        color: var(--wt-color-text-muted);
      }
      .message[role="alert"] {
        color: var(--wt-color-danger);
      }
      staffing-grid {
        container-type: size;
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
            const edited = current && !sameDay(current.get(weekday), before?.get(weekday));
            return [weekday, edited ? current.get(weekday)! : day.map((block) => ({ ...block }))];
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
          !sameDay(week.get(String(weekday)), this.baseline.get(key)?.get(String(weekday))),
      ).map((weekday) => ({
        area: { ...area },
        weekday,
        blocks: week.get(String(weekday))!.map((block) => ({ ...block })),
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
      baseline.get(areaKey(area))!.set(
        String(weekday),
        blocks.map((block) => ({ ...block })),
      );
    this.commitBaseline(baseline);
    this.load(true);
  }

  /** `staffing.invalid` naming `edits.<i>` shows the i-th sent edit's area and marks its day. */
  private refuse(error: unknown, edits: SeasonStaffingEdit[], read: SeasonStaffing): void {
    const code = codeOf(error);
    const message = codeMessage(code);
    const field = (error as { params?: { field?: unknown } } | null)?.params?.field;
    const match = /^edits\.(\d+)(?=\.|$)/.exec(typeof field === "string" ? field : "");
    const edit = code === "staffing.invalid" && match ? edits[Number(match[1])] : undefined;
    if (!edit) {
      this.refused = { message };
      return;
    }
    const key = areaKey(edit.area);
    this.shown = key;
    this.refused = {
      message: tf("staffing.painter.refused_on", {
        area: read.areas.find(({ area }) => areaKey(area) === key)!.name,
        day: weekdayFormat().format(weekdayDate(edit.weekday)),
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
      const format = weekdayFormat();
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

  private picker(read: SeasonStaffing, shown: string) {
    const group = (kind: string) =>
      kind === "department" ? t("staffing.painter.departments") : t("staffing.painter.stations");
    const options = [...read.areas]
      .sort((a, b) => Number(a.area.kind === "station") - Number(b.area.kind === "station"))
      .map(({ area, name }) => ({ value: areaKey(area), label: name, group: group(area.kind) }));
    return html`<wt-combobox
      slot="picker"
      name="area"
      label=${t("staffing.painter.area")}
      hide-label
      search="never"
      ?disabled=${this.saving}
      .value=${shown}
      .options=${options}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        this.pick(event.detail.value);
      }}
    ></wt-combobox>`;
  }

  private paintRow(chosen: string | undefined) {
    return html`<div slot="row" class="paint" data-test="paint-row">
      <div class="pots">
        <span class="label">${t("staffing.painter.paint")}</span>
        ${this.staffRoles.map(
          (staffRole) =>
            html`<span class="pot">
              <button
                type="button"
                data-test=${`staff-role-${staffRole.id}`}
                aria-pressed=${chosen === staffRole.id ? "true" : "false"}
                @click=${() => {
                  this.chosen = staffRole.id;
                }}
              >
                <span class="swatch" data-colour=${staffRole.colour}></span>${staffRole.name}
              </button>
            </span>`,
        )}
        <button
          type="button"
          class="new"
          data-test="new-staff-role"
          @click=${() => {
            this.dialogOpen = true;
          }}
        >
          ${t("staffing.painter.new_staff_role")}
        </button>
      </div>
      <wt-number-stepper
        class="how-many"
        name="headcount"
        label=${t("staffing.grid.how_many")}
        min="1"
        max=${MAX_HEADCOUNT}
        .value=${String(this.headcount)}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          // A blank waits for the field to be left, so it can be cleared and typed again.
          if (event.detail.value === "") return;
          const value = Number(event.detail.value);
          if (Number.isInteger(value)) this.headcount = Math.min(Math.max(value, 1), MAX_HEADCOUNT);
          (event.currentTarget as HTMLElementTagNameMap["wt-number-stepper"]).value = String(
            this.headcount,
          );
        }}
        @focusout=${(event: FocusEvent) => {
          (event.currentTarget as HTMLElementTagNameMap["wt-number-stepper"]).value = String(
            this.headcount,
          );
        }}
      ></wt-number-stepper>
      ${
        this.rolesError
          ? html`<p class="message" role="alert" data-test="roles-error">${this.rolesError}</p>`
          : nothing
      }
    </div>`;
  }

  private content(read: SeasonStaffing | undefined, shown: string, chosen: string | undefined) {
    if (!read)
      return this.loadError
        ? html`<p class="message" role="alert" data-test="load-error">${this.loadError}</p>`
        : html`<p class="message" data-test="loading">${t("staffing.painter.loading")}</p>`;
    if (!read.areas.length)
      return html`<p class="message" data-test="no-areas">${t("staffing.painter.no_areas")}</p>`;
    const guides = read.guides[shown] ?? {};
    return html`<staffing-grid
      .target=${`${this.seasonId}/${shown}`}
      .columns=${this.columns()}
      .days=${this.draft.get(shown) ?? NOTHING_BY_KEY}
      .guides=${new Map(WEEKDAYS.map((weekday) => [String(weekday), guides[weekday] ?? []]))}
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
        ${read?.areas.length ? this.picker(read, shown) : nothing}
        ${read?.areas.length && !this.readOnly ? this.paintRow(chosen) : nothing}
        ${this.content(read, shown, chosen)}
      </painter-frame>
      ${
        this.readOnly
          ? nothing
          : html`<staff-role-dialog
              .api=${this.api}
              .open=${this.dialogOpen}
              @staff-role-saved=${(event: CustomEvent<StaffRole>) => {
                event.stopPropagation();
                const saved = event.detail;
                if (!this.staffRoles.some(({ id }) => id === saved.id))
                  this.staffRoles = [...this.staffRoles, saved];
                this.chosen = saved.id;
              }}
              @staff-role-close=${(event: Event) => {
                event.stopPropagation();
                this.dialogOpen = false;
              }}
            ></staff-role-dialog>`
      }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "staffing-season-painter": StaffingSeasonPainter;
  }
}
