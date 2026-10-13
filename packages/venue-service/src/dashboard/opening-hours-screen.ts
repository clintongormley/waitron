import { LitElement, css, html, nothing } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { codeOf } from "@waitron/dashboard-kit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  leaveCoordinatorFor,
  UrlStateController,
  navigationGuardFor,
  type DataTableColumn,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-tabs.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-data-table.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "./period-editor.js";
import "./opening-hours-week.js";
import "./opening-hours-zone-week.js";
import "./opening-hours-day.js";
import "./opening-hours-all.js";
import "./opening-hours-station.js";
import "./opening-hours-year.js";
import "./opening-hours-month.js";
import "./ordinary-date-dialog.js";
import type { OrdinaryDateOpen } from "./opening-hours-month.js";
import { seasonTints } from "./season-tint.js";
import "./special-day-dialog.js";
import type { SpecialDayAction, SpecialDayRef } from "./special-day-action.js";
import type { OpeningHoursMonth, OpeningHoursYear } from "../opening-hours-calendar.js";
import type { SpecialDayDialog, SpecialDayFacts } from "./special-day-dialog.js";
import type { SpecialDayDetail } from "../special-days.js";
import type { PeriodEditor } from "./period-editor.js";
import type {
  MenuPeriodInput,
  MenuPeriodUse,
  OpeningHoursModel,
  PeriodRoutingUse,
} from "../menu-timetable-types.js";
import type { OpeningHoursApi, OpeningStation } from "./opening-hours-client.js";
import { businessDateToday } from "./opening-hours-day.js";
import {
  addDays,
  isLocalDate,
  parseCalendarMonth,
  parseCalendarYear,
  weekdayOf,
} from "../hours-rules.js";
import { format, formatDate } from "./hours-view.js";
import { t } from "./strings.js";
import { chosenSeasonId, seasonOptions } from "./season-choice.js";

type Department = OpeningHoursModel["departments"][number];
type Period = Department["periods"][number];
type View = "year" | "month" | "week" | "periods" | "date";
type Editor = { department: Department; period?: Period; clockRevision: number };
type OpenSpecialDay = Omit<SpecialDayAction, "specialDay"> & {
  clockRevision: number;
  /** The stored special day holding the date, read when the action opened. */
  detail?: SpecialDayDetail;
  /** The venue's special days, read when the action opened on a public holiday. */
  existing?: { id: string; name: string; latest?: string }[];
  /** A date to add to `detail` as an unsaved change. */
  addDate?: string;
  /** Whether the dialog offers the per-date editor for `date`. */
  offerEditDate?: boolean;
};
type Deletion = { period: Period };

@customElement("dashboard-opening-hours-screen")
export class OpeningHoursScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      h1 {
        margin-top: 0;
      }
      .chooser {
        max-width: var(--wt-form-max-width);
        margin-block: var(--wt-space-4);
      }
      a {
        color: var(--wt-color-primary-text);
      }
      .toolbar {
        display: flex;
        justify-content: flex-end;
        margin-block-end: var(--wt-space-3);
      }
      wt-data-table::part(period-colour) {
        display: inline-block;
        width: var(--wt-space-3);
        height: var(--wt-space-3);
        margin-inline-end: var(--wt-space-2);
        border-radius: var(--wt-radius-sm);
      }
    `,
  ];
  @property({ attribute: false }) api!: OpeningHoursApi;
  @property({ type: Boolean }) readOnly = false;
  @state() private model?: OpeningHoursModel;
  @state() private departmentId = "";
  @state() private zoneId = "";
  @state() private stationId = "";
  private requestedSeason = "";
  /** Held rather than derived per render, so a reread never swaps out an editor holding a draft. */
  @state() private season = "";
  @state() private stations: OpeningStation[] = [];
  @state() private stationReadError = "";
  private stationsDetach?: () => void;
  @state() private view: View = "week";
  /** The address's year, or 0 for the venue's current one. */
  @state() private requestedYear = 0;
  @state() private yearModel?: OpeningHoursYear;
  @state() private yearReadError = "";
  @state() private knownSpecialDays: readonly { id: string; name: string }[] = [];
  private yearDetach?: () => void;
  private watchedYear = 0;
  private knownSpecialDaysRead = {};
  /** The address's month, or "" for the venue's current one. */
  @state() private requestedMonth = "";
  @state() private monthModel?: OpeningHoursMonth;
  @state() private monthReadError = "";
  private monthDetach?: () => void;
  private watchedMonth = "";
  @state() private ordinary?: OrdinaryDateOpen;
  @state() private dayDate = "";
  @state() private readError = "";
  @state() private editor?: Editor;
  @state() private deleting?: Deletion;
  @state() private deleteError = "";
  @state() private busy = false;
  @state() private namedAction?: OpenSpecialDay;
  @state() private namedDeleteError = "";
  @state() private specialReadError = "";
  private detach?: () => void;
  private generation = {};
  private readonly url = new UrlStateController(this, () => this.followUrl(), {
    basePath: "/manage",
    primary: "dashboard",
    children: {
      "opening-hours": {
        view: "view",
        department: "department",
        zone: "zone",
        station: "station",
        season: "season",
        date: "date",
        year: "year",
        month: "month",
      },
    },
  });
  private followUrl() {
    if (this.url.read("dashboard") !== "opening-hours") return;
    const view = this.url.read("view");
    const shown: View =
      view === "year" ||
      view === "month" ||
      view === "periods" ||
      view === "date" ||
      view === "week"
        ? view
        : view === "calendar"
          ? "year"
          : view === null &&
              !this.namesWeek(new URL(navigationGuardFor(window)?.href ?? location.href))
            ? "year"
            : "week";
    if (shown !== this.view) this.specialReadError = "";
    this.view = shown;
    this.departmentId = this.url.read("department") ?? "";
    this.zoneId = this.url.read("zone") ?? "";
    this.requestedSeason = this.url.read("season") ?? "";
    this.stationId =
      this.url.read("station") ??
      new URL(navigationGuardFor(window)?.href ?? location.href).searchParams.get("station") ??
      "";
    this.requestedYear = parseCalendarYear(this.url.read("year")) ?? 0;
    this.requestedMonth = parseCalendarMonth(this.url.read("month")) ?? "";
    const date = this.url.read("date") ?? "";
    this.dayDate = isLocalDate(date) ? date : "";
    this.resolveSeason();
  }
  /** Whether an address with no view opens the Week rather than the Year (ruling R3). */
  private namesWeek(url: URL) {
    return (
      ["department", "zone", "station", "season"].some((key) => this.url.read(key) !== null) ||
      url.searchParams.has("station")
    );
  }
  override connectedCallback() {
    super.connectedCallback();
    this.stationsDetach = this.api.watchStations(
      (stations) => {
        this.stations = stations;
        this.stationReadError = "";
      },
      () => {
        this.stationReadError = t("opening.load_error");
      },
      () => {
        this.stationReadError = "";
      },
    );
    this.detach = this.api.watchOpeningHours(
      (model) => {
        this.model = model;
        if (
          !this.season ||
          (!model.seasons.some((season) => season.id === this.season) &&
            !leaveCoordinatorFor(this)?.isDirty())
        )
          this.resolveSeason();
        this.readError = "";
      },
      () => {
        this.readError = t("opening.load_error");
      },
      () => {
        this.readError = "";
      },
    );
  }
  override disconnectedCallback() {
    this.stationsDetach?.();
    this.detach?.();
    this.monthDetach?.();
    this.watchedMonth = "";
    this.yearDetach?.();
    this.watchedYear = 0;
    this.generation = {};
    this.busy = false;
    super.disconnectedCallback();
  }
  private department() {
    const departments = this.model?.departments ?? [];
    return (
      departments.find((d) => d.id === this.departmentId) ??
      departments.find((d) => d.active) ??
      departments[0]
    );
  }
  private zone() {
    return this.department()?.zones?.find((zone) => zone.id === this.zoneId);
  }
  private pickerOptions() {
    const departments = this.model?.departments.filter((department) => department.active) ?? [];
    return this.view === "week"
      ? [
          { value: "all", label: t("opening.all_departments") },
          ...departments.flatMap((department) => [
            { value: department.id, label: department.name },
            ...(department.zones ?? []).map((zone) => ({
              value: `zone:${zone.id}`,
              label: `${department.name} › ${zone.name}`,
            })),
          ]),
          ...this.stations
            .filter((station) => station.active)
            .map((station) => ({
              value: `station:${station.id}`,
              label: station.name,
              group: t("nav.prep_stations"),
            })),
        ]
      : departments.map((department) => ({ value: department.id, label: department.name }));
  }
  private pickerValue() {
    if (this.view === "week" && this.stationId) return `station:${this.stationId}`;
    if (this.view === "week" && this.departmentId === "all") return "all";
    const zone = this.view === "week" ? this.zone() : undefined;
    return zone ? `zone:${zone.id}` : (this.department()?.id ?? "");
  }
  private async chooseDepartment(value: string) {
    if (!this.isConnected) return;
    if (value.startsWith("station:") && this.view === "week") {
      const stationId = value.slice(8);
      if (!this.stations.some((station) => station.active && station.id === stationId)) return;
      const url = new URL(navigationGuardFor(window)?.href ?? location.href);
      url.pathname = "/manage/opening-hours/view/week";
      url.searchParams.set("station", stationId);
      url.searchParams.delete("department");
      url.searchParams.delete("zone");
      await this.writeAddress(url);
    } else if (value === "all" && this.view === "week") {
      await this.url.write(
        {
          dashboard: "opening-hours",
          department: "all",
          zone: null,
          station: null,
        },
        false,
        ["station"],
      );
    } else if (value.startsWith("zone:") && this.view === "week") {
      const zoneId = value.slice(5);
      const department = this.model?.departments.find(
        (d) => d.active && d.zones?.some((z) => z.id === zoneId),
      );
      if (!department) return;
      await this.url.write(
        {
          dashboard: "opening-hours",
          department: department.id,
          zone: zoneId,
          station: null,
        },
        false,
        ["station"],
      );
    } else {
      const department = this.model?.departments.find((d) => d.id === value);
      if (!department) return;
      await this.url.write(
        {
          dashboard: "opening-hours",
          department: department.id,
          zone: null,
          station: null,
        },
        false,
        ["station"],
      );
    }
    this.followUrl();
  }
  /** The picker, and so the address's season, governs only the standard week. */
  private resolveSeason() {
    this.season =
      this.model && this.view === "week" && !this.stationId
        ? chosenSeasonId(this.model.seasons, this.model.currentSeasonId, this.requestedSeason)
        : "";
  }
  private async chooseSeason(value: string) {
    if (!this.isConnected || !this.model?.seasons.some((season) => season.id === value)) return;
    await this.url.write({ dashboard: "opening-hours", season: value });
    this.followUrl();
  }
  private currentWeek() {
    const date = this.model ? businessDateToday(this.model) : "";
    return date ? addDays(date, -((weekdayOf(date) + 6) % 7)) : "";
  }
  protected override willUpdate() {
    if (!this.model) return;
    this.watchYear();
    this.watchMonth();
    if (this.editor) {
      const department = this.model.departments.find(
        (row) => row.active && row.id === this.editor!.department.id,
      );
      if (
        !department ||
        (this.editor.period &&
          !department.periods.some((period) => period.id === this.editor!.period!.id))
      ) {
        this.editor = undefined;
        this.busy = false;
      }
    }
    if (
      this.deleting &&
      !this.model.departments.some(
        (department) =>
          department.active &&
          department.periods.some((period) => period.id === this.deleting!.period.id),
      )
    ) {
      this.deleting = undefined;
      this.busy = false;
    }
  }
  private shownYear() {
    if (this.view !== "year" || !this.model) return 0;
    return (
      this.requestedYear ||
      Number((businessDateToday(this.model) || String(new Date().getFullYear())).slice(0, 4))
    );
  }
  private watchYear() {
    const year = this.shownYear();
    if (year === this.watchedYear) return;
    this.yearDetach?.();
    this.yearDetach = undefined;
    this.watchedYear = year;
    this.yearReadError = "";
    // The last year stays drawn until the next one arrives, so the pressed ‹ or › keeps focus.
    if (!year) {
      this.yearModel = undefined;
      return;
    }
    const current = () => this.isConnected && this.watchedYear === year;
    this.yearDetach = this.api.watchYear(
      year,
      (model) => {
        if (!current()) return;
        this.yearModel = model;
        this.yearReadError = "";
      },
      () => {
        if (!current()) return;
        this.yearReadError = t("opening.load_error");
        if (this.yearModel?.year !== year) this.yearModel = undefined;
      },
      () => {
        if (current()) this.yearReadError = "";
      },
    );
  }
  /** The month drawn: the month view's, or the date view's when it names no valid date. */
  private shownMonth() {
    if (!this.model || !(this.view === "month" || (this.view === "date" && !this.dayDate)))
      return "";
    return (
      this.requestedMonth ||
      (businessDateToday(this.model) || new Date().toISOString().slice(0, 10)).slice(0, 7)
    );
  }
  private watchMonth() {
    const month = this.shownMonth();
    if (month === this.watchedMonth) return;
    this.monthDetach?.();
    this.monthDetach = undefined;
    this.watchedMonth = month;
    this.monthReadError = "";
    if (!month) {
      this.monthModel = undefined;
      return;
    }
    const current = () => this.isConnected && this.watchedMonth === month;
    this.monthDetach = this.api.watchMonth(
      month,
      (model) => {
        if (!current()) return;
        this.monthModel = model;
        this.monthReadError = "";
      },
      () => {
        if (!current()) return;
        this.monthReadError = t("opening.load_error");
        if (this.monthModel?.month !== month) this.monthModel = undefined;
      },
      () => {
        if (current()) this.monthReadError = "";
      },
    );
  }
  /** Feeds only the season dialog's naming of a refusal, so a failed read keeps the last list. */
  private readKnownSpecialDays() {
    const read = (this.knownSpecialDaysRead = {});
    void this.api.specialDays.listSpecialDays({ passive: true }).then(
      (days) => {
        if (this.isConnected && this.knownSpecialDaysRead === read)
          this.knownSpecialDays = days.map(({ id, name }) => ({ id, name }));
      },
      () => {},
    );
  }
  private readonly areaWrites = {
    saveHolidayArea: (areaKey: string) => this.api.specialDays.saveHolidayArea(areaKey),
    rereadWatches: () => this.api.rereadWithSpecialDays(),
  };
  private openMonth(event: CustomEvent<{ date: string }>) {
    event.stopPropagation();
    void Promise.resolve(
      this.url.write({
        dashboard: "opening-hours",
        view: "month",
        month: event.detail.date.slice(0, 7),
        year: null,
      }),
    ).then(() => this.followUrl());
  }
  private async writeAddress(url: URL, replace = false) {
    const generation = this.generation;
    const guard = navigationGuardFor(window);
    if (guard) {
      await guard.write(url, replace);
      if (this.isConnected && generation === this.generation) this.followUrl();
      return;
    }
    const proceed = () => {
      if (!this.isConnected || generation !== this.generation || this.view !== "week") return;
      if (replace) history.replaceState(history.state, "", url);
      else history.pushState(history.state, "", url);
      this.followUrl();
    };
    const coordinator = leaveCoordinatorFor(this);
    if (coordinator) await coordinator.request({ scopes: "all", reason: "navigation", proceed });
    else proceed();
  }
  private menuLabel(id: string) {
    const menu = this.model!.menus.find((m) => m.id === id);
    if (!menu) return id;
    return menu.includes.length
      ? format("opening.menu_includes", {
          name: menu.name,
          menus: menu.includes
            .map((included) => this.model!.menus.find((m) => m.id === included)?.name ?? included)
            .join(", "),
        })
      : menu.name;
  }
  private openPeriod(department: Department, period?: Period) {
    if (this.readOnly || this.busy || !this.isConnected || this.editor || this.deleting) return;
    this.editor = { department, period, clockRevision: this.model!.clockRevision };
  }
  private async savePeriod(
    event: CustomEvent<{ periodId: string | null; input: MenuPeriodInput }>,
  ) {
    event.stopPropagation();
    const editor = this.editor;
    const component = event.currentTarget as PeriodEditor;
    if (
      !editor ||
      this.readOnly ||
      this.busy ||
      !this.isConnected ||
      component !== this.shadowRoot?.querySelector("period-editor")
    )
      return;
    const { periodId, input } = event.detail;
    this.busy = true;
    component.refusal = undefined;
    try {
      if (periodId === null)
        await this.api.createPeriod(editor.department.id, input, editor.clockRevision);
      else await this.api.updatePeriod(periodId, input, editor.clockRevision);
    } catch (error) {
      if (this.editor === editor && this.isConnected) {
        component.refusal = {
          code: codeOf(error),
          params:
            typeof error === "object" && error !== null
              ? (error as { params?: Record<string, unknown> }).params
              : undefined,
        };
      }
      return;
    } finally {
      if (this.editor === editor && this.isConnected) this.busy = false;
    }
    if (this.editor === editor && component.commitSubmitted(input)) this.editor = undefined;
    this.api.rereadWatches();
  }
  private askDelete(period: Period) {
    if (this.readOnly || this.busy || !this.isConnected || this.editor || this.deleting) return;
    this.deleteError = "";
    this.deleting = { period };
  }
  /** The period's routing uses as last read, so the warning follows a re-read while it is open. */
  private routingWarning(period: Period) {
    const current =
      this.model?.departments
        .flatMap((department) => department.periods)
        .find((candidate) => candidate.id === period.id) ?? period;
    const uses = current.routingUses;
    if (uses.length === 0) return nothing;
    const label = (use: PeriodRoutingUse) =>
      format("opening.routing_use", {
        row:
          use.rowLabel ??
          t(use.rowKind === "all" ? "routing.all_categories" : "routing.no_category"),
        zone: use.zoneName ?? t("routing.every_zone"),
      });
    return html`<div data-test="routing-uses">
      <p>
        ${
          uses.length === 1
            ? t("opening.delete_routing_one")
            : format("opening.delete_routing", { count: String(uses.length) })
        }
      </p>
      <ul>
        ${uses.map((use) => html`<li>${label(use)}</li>`)}
      </ul>
    </div>`;
  }
  private async deletePeriod(deletion: Deletion) {
    const period = deletion.period;
    if (this.readOnly || this.busy || !this.isConnected || this.deleting !== deletion) return;
    this.busy = true;
    this.deleteError = "";
    try {
      await this.api.deletePeriod(period.id);
    } catch (error) {
      if (this.deleting !== deletion || !this.isConnected) return;
      if (codeOf(error) === "menu_period.in_use") {
        const uses = (error as { params?: { uses?: MenuPeriodUse[] } }).params?.uses ?? [];
        this.deleteError = format("menu.period_in_use", {
          name: period.name,
          days: uses
            .map((use) =>
              use.kind === "week"
                ? t(`hours.day.${use.weekday}` as Parameters<typeof t>[0])
                : format("menu.period_use_special_day", {
                    name: use.name,
                    date: formatDate(use.date),
                  }),
            )
            .join(", "),
        });
      } else
        this.deleteError = t(
          codeOf(error) === "menu_period.not_found" ? "menu.period_gone" : "menu.save_error",
        );
      return;
    } finally {
      this.busy = false;
    }
    if (this.deleting === deletion) this.deleting = undefined;
    this.api.rereadWatches();
  }
  private async openNamedDay(event: CustomEvent<SpecialDayAction>) {
    event.stopPropagation();
    const day = this.shadowRoot?.querySelector("opening-hours-day");
    if (
      ![
        this.shadowRoot?.querySelector("opening-hours-year"),
        this.shadowRoot?.querySelector("opening-hours-month"),
        day,
      ].some((component) => component === event.currentTarget)
    )
      return;
    await this.openSpecial(event.detail, { offerEditDate: event.currentTarget !== day });
  }
  private async openSpecial(
    sentAction: SpecialDayAction,
    extra: Pick<OpenSpecialDay, "addDate" | "offerEditDate">,
  ) {
    if (
      !this.isConnected ||
      this.readOnly ||
      this.busy ||
      this.editor ||
      this.deleting ||
      this.namedAction
    )
      return;
    const { specialDay: sent, ...detail } = sentAction;
    const specialDay: SpecialDayRef | null = sent ?? null;
    if (detail.kind === "delete" && !specialDay) return;
    const action: OpenSpecialDay = {
      ...detail,
      ...extra,
      clockRevision: this.model!.clockRevision,
    };
    this.namedDeleteError = "";
    this.specialReadError = "";
    const onHoliday = action.holidays.some((holiday) => holiday.date === action.date);
    if (!specialDay && !onHoliday) {
      this.namedAction = action;
      return;
    }
    const generation = this.generation;
    this.busy = true;
    let opened: OpenSpecialDay;
    try {
      opened = specialDay
        ? { ...action, detail: await this.api.specialDays.readSpecialDay(specialDay.id) }
        : {
            ...action,
            existing: await this.api.specialDays.listSpecialDays().then(
              (days) =>
                days.map((day) => ({
                  id: day.id,
                  name: day.name,
                  latest: day.dates.at(-1)?.date,
                })),
              // The list only feeds the optional "Add to <name>" offer.
              () => [],
            ),
          };
    } catch {
      if (this.isConnected && generation === this.generation)
        this.specialReadError = t("opening.load_error");
      return;
    } finally {
      if (generation === this.generation) this.busy = false;
    }
    if (!this.isConnected || generation !== this.generation || this.namedAction) return;
    this.namedAction = opened;
  }
  private closeNamedDay(action: OpenSpecialDay) {
    if (!this.isConnected || this.namedAction !== action || this.busy) return;
    this.namedAction = undefined;
    void this.updateComplete.then(() => action.returnTo()?.focus());
  }
  /** Runs one special-day write for `action`, putting a refusal on its dialog; true once saved. */
  private async writeSpecialDay(
    action: OpenSpecialDay,
    component: SpecialDayDialog,
    write: (current: () => boolean) => Promise<unknown>,
  ): Promise<boolean> {
    const generation = this.generation;
    const current = () =>
      this.isConnected && generation === this.generation && this.namedAction === action;
    this.busy = true;
    component.refusal = undefined;
    try {
      await write(current);
    } catch (error) {
      if (current())
        component.refusal = {
          code: codeOf(error),
          params:
            typeof error === "object" && error !== null
              ? (error as { params?: Record<string, unknown> }).params
              : undefined,
        };
      return false;
    } finally {
      if (generation === this.generation) this.busy = false;
    }
    return current();
  }
  private dialogFor(event: Event): { action: OpenSpecialDay; component: SpecialDayDialog } | null {
    event.stopPropagation();
    const action = this.namedAction;
    const component = event.currentTarget as SpecialDayDialog;
    if (
      !action ||
      !this.isConnected ||
      this.readOnly ||
      this.busy ||
      component !== this.shadowRoot?.querySelector("special-day-dialog")
    )
      return null;
    return { action, component };
  }
  private async saveNamedDay(event: CustomEvent<{ id: string | null; input: SpecialDayFacts }>) {
    const opened = this.dialogFor(event);
    if (!opened) return;
    const { action, component } = opened;
    const { id, input } = event.detail;
    const saved = await this.writeSpecialDay(action, component, (current) =>
      this.api.specialDays.saveSpecialDay(id, input, current, action.clockRevision),
    );
    if (!saved) return;
    if (component.commitSubmitted(input)) this.closeNamedDay(action);
    this.api.rereadWithSpecialDays();
  }
  private async addToSpecialDay(event: CustomEvent<{ id: string; date: string }>) {
    const opened = this.dialogFor(event);
    if (!opened) return;
    const { action, component } = opened;
    const { id, date } = event.detail;
    const saved = await this.writeSpecialDay(action, component, async (current) => {
      const stored = await this.api.specialDays.readSpecialDay(id);
      const dates = [
        ...stored.dates
          .filter((entry) => entry.date !== date)
          .map((entry) => ({ date: entry.date, closedAllDay: entry.closedAllDay })),
        { date, closedAllDay: false },
      ].sort((a, b) => (a.date < b.date ? -1 : 1));
      return this.api.specialDays.saveSpecialDay(
        id,
        { name: stored.name, repeatsYearly: stored.repeatsYearly, dates },
        current,
        action.clockRevision,
      );
    });
    if (!saved) return;
    this.closeNamedDay(action);
    this.api.rereadWithSpecialDays();
  }
  private async deleteNamedDay(action: OpenSpecialDay) {
    if (
      !this.isConnected ||
      this.readOnly ||
      this.busy ||
      this.namedAction !== action ||
      !action.detail
    )
      return;
    const generation = this.generation;
    this.busy = true;
    this.namedDeleteError = "";
    try {
      await this.api.specialDays.deleteSpecialDay(action.detail.id, action.clockRevision);
    } catch {
      if (this.isConnected && generation === this.generation && this.namedAction === action)
        this.namedDeleteError = t("hours.save_error");
      return;
    } finally {
      if (generation === this.generation) this.busy = false;
    }
    if (!this.isConnected || generation !== this.generation || this.namedAction !== action) return;
    this.closeNamedDay(action);
    this.api.rereadWithSpecialDays();
  }
  private namedDialog() {
    const action = this.namedAction;
    if (!action) return nothing;
    const current = () => this.isConnected && this.namedAction === action && !this.busy;
    if (action.kind === "delete")
      return keyed(
        action,
        html`<wt-dialog
          open
          data-test="delete-special-day"
          heading=${t("hours.delete")}
          .dismissible=${!this.busy}
          @wt-close=${(event: Event) => {
            event.stopPropagation();
            if (current()) this.closeNamedDay(action);
          }}
        >
          <p>
            ${format(action.detail!.repeatsYearly ? "special.delete_repeat" : "special.delete", { name: action.detail!.name })}
          </p>
          ${this.namedDeleteError ? html`<p role="alert">${this.namedDeleteError}</p>` : nothing}
          <wt-form-actions slot="footer"
            ><wt-button
              slot="cancel"
              variant="secondary"
              ?disabled=${this.busy}
              @click=${() => {
                if (current()) this.closeNamedDay(action);
              }}
              >${t("hours.cancel")}</wt-button
            ><wt-button
              data-test="confirm-special-delete"
              variant="danger"
              ?disabled=${this.busy}
              ?loading=${this.busy}
              @click=${() => this.deleteNamedDay(action)}
              >${t("hours.delete")}</wt-button
            ></wt-form-actions
          >
        </wt-dialog>`,
      );
    return keyed(
      action,
      html`<special-day-dialog
        .open=${true}
        .specialDay=${action.detail}
        .date=${action.date}
        .addDate=${action.addDate ?? ""}
        .offerEditDate=${action.offerEditDate ?? false}
        .holidays=${action.visibleHolidays ?? action.holidays}
        .existing=${action.existing ?? []}
        .busy=${this.busy}
        @special-day-save=${this.saveNamedDay}
        @special-day-edit-date=${this.editDate}
        @special-day-add-to=${this.addToSpecialDay}
        @special-day-close=${(event: Event) => {
          event.stopPropagation();
          if (current()) this.closeNamedDay(action);
        }}
      ></special-day-dialog>`,
    );
  }
  /** Goes to the per-date editor through the leave question, closing the dialog once it has gone. */
  private async editDate(event: CustomEvent<{ date: string }>) {
    const opened = this.dialogFor(event);
    if (!opened || !isLocalDate(event.detail.date)) return;
    const { action } = opened;
    const write = () =>
      this.url.write({
        dashboard: "opening-hours",
        view: "date",
        date: event.detail.date,
        month: null,
        year: null,
      });
    const coordinator = leaveCoordinatorFor(this);
    const outcome = navigationGuardFor(window)
      ? await write()
      : coordinator
        ? await coordinator.request({
            scopes: "all",
            reason: "navigation",
            proceed: () => void write(),
          })
        : (write(), "proceeded");
    if (outcome !== "proceeded" || !this.isConnected || this.namedAction !== action) return;
    this.namedAction = undefined;
    this.followUrl();
  }
  private openOrdinary(event: CustomEvent<OrdinaryDateOpen>) {
    event.stopPropagation();
    if (
      !this.isConnected ||
      this.readOnly ||
      this.busy ||
      this.editor ||
      this.deleting ||
      this.namedAction ||
      this.ordinary ||
      event.currentTarget !== this.shadowRoot?.querySelector("opening-hours-month")
    )
      return;
    this.ordinary = event.detail;
    this.readKnownSpecialDays();
  }
  private ordinaryDialog() {
    const open = this.ordinary;
    const seasons = this.monthModel?.seasons ?? [];
    if (!open) return nothing;
    const season = seasons.find((row) => row.id === open.seasonId);
    const leave = (event: Event) => {
      event.stopPropagation();
      if (!this.isConnected || this.ordinary !== open) return false;
      this.ordinary = undefined;
      return true;
    };
    return keyed(
      open,
      html`<ordinary-date-dialog
        .open=${true}
        .date=${open.date}
        .season=${season ? { id: season.id, name: season.name } : undefined}
        .tint=${season ? (seasonTints(seasons).get(season.id) ?? "") : ""}
        .specialDays=${this.knownSpecialDays}
        .returnTo=${open.returnTo}
        @wt-close=${leave}
        @ordinary-date-edit-week=${(event: CustomEvent<{ seasonId: string }>) => {
          if (!leave(event)) return;
          void Promise.resolve(
            this.url.write({
              dashboard: "opening-hours",
              view: "week",
              season: event.detail.seasonId,
              zone: null,
              station: null,
              month: null,
              date: null,
              year: null,
            }),
          ).then(() => this.followUrl());
        }}
        @ordinary-date-make-special=${(event: CustomEvent<{ date: string }>) => {
          if (!leave(event)) return;
          void this.openSpecial(
            {
              kind: "open",
              date: event.detail.date,
              specialDay: null,
              holidays: [],
              returnTo: open.returnTo,
            },
            {},
          );
        }}
        @ordinary-date-add-to-special=${(
          event: CustomEvent<{ date: string; specialDayId: string }>,
        ) => {
          if (!leave(event)) return;
          const { date, specialDayId } = event.detail;
          void this.openSpecial(
            {
              kind: "open",
              date: "",
              specialDay: {
                id: specialDayId,
                name: this.knownSpecialDays.find((day) => day.id === specialDayId)?.name ?? "",
              },
              holidays: [],
              returnTo: open.returnTo,
            },
            { addDate: date },
          );
        }}
      ></ordinary-date-dialog>`,
    );
  }
  private month() {
    const write = (changes: Record<string, string | null>) =>
      void Promise.resolve(this.url.write({ dashboard: "opening-hours", ...changes })).then(() =>
        this.followUrl(),
      );
    return html`${this.monthReadError ? html`<p role="alert" data-test="month-read-error">${this.monthReadError}</p>` : nothing}
      <opening-hours-month
        .model=${this.monthModel}
        .month=${this.shownMonth()}
        .departmentId=${this.departmentId}
        .departments=${this.model!.departments}
        .api=${this.api}
        .specialDays=${this.knownSpecialDays}
        .readOnly=${this.readOnly}
        @special-day-action=${this.openNamedDay}
        @ordinary-date-open=${this.openOrdinary}
        @season-dialog-open=${() => this.readKnownSpecialDays()}
        @season-changed=${(event: Event) => {
          event.stopPropagation();
          this.api.rereadWithSpecialDays();
        }}
        @month-change=${(event: CustomEvent<{ month: string }>) => {
          event.stopPropagation();
          write({ view: "month", month: event.detail.month, date: null });
        }}
        @month-year-open=${(event: CustomEvent<{ year: number }>) => {
          event.stopPropagation();
          write({
            view: "year",
            year: String(event.detail.year).padStart(4, "0"),
            month: null,
            date: null,
          });
        }}
        @month-department-change=${(event: CustomEvent<{ departmentId: string }>) => {
          event.stopPropagation();
          write({ department: event.detail.departmentId || null, zone: null, station: null });
        }}
      ></opening-hours-month>`;
  }
  private periods(department: Department) {
    const columns: DataTableColumn<Period>[] = [
      {
        key: "name",
        label: t("menu.period_name"),
        cell: (row) =>
          html`<span
              part="period-colour"
              data-colour=${row.colour}
              style=${`background: var(--wt-color-palette-${row.colour})`}
            ></span
            >${row.name}`,
      },
      { key: "menu", label: t("menu.period_menu"), cell: (row) => this.menuLabel(row.menuId) },
      {
        key: "staff",
        label: t("opening.staff_menus"),
        cell: (row) => row.staffMenuIds.map((id) => this.menuLabel(id)).join(", "),
      },
      {
        key: "endOffsetMinutes",
        label: t("menu.end_offset_column"),
        cell: (row) =>
          row.endOffsetMinutes > 0 ? `+${row.endOffsetMinutes}` : String(row.endOffsetMinutes),
      },
      {
        key: "weekdays",
        label: t("menu.period_uses"),
        cell: (row) =>
          row.weekdays.length
            ? row.weekdays.map((day) => t(`hours.day.${day}` as Parameters<typeof t>[0])).join(", ")
            : t("menu.not_placed"),
      },
      ...(this.readOnly
        ? []
        : [
            {
              key: "actions",
              label: t("menu.actions"),
              pinned: "end",
              cell: (row: Period) =>
                html`<wt-row-actions label=${format("menu.row_actions", { name: row.name })}
                  ><wt-button
                    variant="secondary"
                    data-test="edit-period"
                    @click=${() => this.openPeriod(department, row)}
                    >${t("menu.edit")}</wt-button
                  ><wt-button
                    variant="secondary"
                    data-test="delete-period"
                    @click=${() => this.askDelete(row)}
                    >${t("menu.delete")}</wt-button
                  ></wt-row-actions
                >`,
            } satisfies DataTableColumn<Period>,
          ]),
    ];
    return html`${this.readOnly ? nothing : html`<div class="toolbar"><wt-button variant="secondary" data-test="new-period" @click=${() => this.openPeriod(department)}>${t("menu.add_period")}</wt-button></div>`}
      <wt-data-table
        data-test="periods"
        aria-label=${t("opening.tab.periods")}
        .columns=${columns}
        .rows=${department.periods}
        .rowKey=${(row: Period) => row.id}
        .emptyMessage=${t("menu.no_periods")}
      ></wt-data-table>`;
  }
  override render() {
    const department = this.department();

    const editor = this.editor;
    const deleting = this.deleting;
    const currentDelete = () => this.isConnected && this.deleting === deleting && !this.busy;
    return html`<h1>${t("opening.title")}</h1>
      ${this.readError ? html`<p role="alert" data-test="read-error">${this.readError}</p>` : nothing}${
        !this.model
          ? nothing
          : html` ${
                (department || this.view === "week") &&
                (this.view === "week" || this.view === "periods")
                  ? html`<div class="chooser">
                      <wt-combobox
                        name="departmentId"
                        label=${t("opening.show")}
                        search="never"
                        .options=${this.pickerOptions()}
                        .value=${this.pickerValue()}
                        @wt-change=${(event: CustomEvent<{ value: string }>) => {
                          event.stopPropagation();
                          if (
                            !this.isConnected ||
                            event.currentTarget !==
                              this.shadowRoot?.querySelector("[name=departmentId]")
                          )
                            return;
                          (event.currentTarget as HTMLElementTagNameMap["wt-combobox"]).value =
                            this.pickerValue();
                          void this.chooseDepartment(event.detail.value);
                        }}
                      ></wt-combobox>
                      ${
                        this.view === "week" && !this.stationId && this.model.seasons.length
                          ? html`<wt-combobox
                              name="seasonId"
                              label=${t("opening.season")}
                              search="never"
                              .options=${seasonOptions(this.model.seasons)}
                              .value=${this.season}
                              @wt-change=${(event: CustomEvent<{ value: string }>) => {
                                event.stopPropagation();
                                if (
                                  !this.isConnected ||
                                  event.currentTarget !==
                                    this.shadowRoot?.querySelector("[name=seasonId]")
                                )
                                  return;
                                (
                                  event.currentTarget as HTMLElementTagNameMap["wt-combobox"]
                                ).value = this.season;
                                void this.chooseSeason(event.detail.value);
                              }}
                            ></wt-combobox>`
                          : nothing
                      }
                      ${this.stationReadError ? html`<p role="alert">${this.stationReadError}</p>` : nothing}
                    </div>`
                  : this.view === "periods"
                    ? html`<p>${t("menu.no_departments")}</p>`
                    : nothing
              }
              <wt-tabs
                label=${t("opening.title")}
                .value=${this.view === "month" || this.view === "date" ? "year" : this.view}
                .items=${[
                  { key: "year", label: t("opening.tab.year") },
                  { key: "week", label: t("hours.tab.week") },
                  { key: "periods", label: t("opening.tab.periods") },
                ]}
                @wt-tab-change=${(event: CustomEvent<{ value: View }>) => {
                  if (event.target !== event.currentTarget) return;
                  (event.currentTarget as HTMLElementTagNameMap["wt-tabs"]).value =
                    this.view === "month" || this.view === "date" ? "year" : this.view;
                  void this.url.write({
                    dashboard: "opening-hours",
                    view: event.detail.value,
                    year: null,
                    month: null,
                    date: null,
                  });
                  this.followUrl();
                }}
              >
                <div slot="year">
                  ${
                    this.view === "year"
                      ? html`${this.yearReadError ? html`<p role="alert" data-test="year-read-error">${this.yearReadError}</p>` : nothing}
                          <opening-hours-year
                            .model=${this.yearModel}
                            .year=${this.shownYear()}
                            .api=${this.api}
                            .areaApi=${this.areaWrites}
                            .specialDays=${this.knownSpecialDays}
                            .readOnly=${this.readOnly}
                            @special-day-action=${this.openNamedDay}
                            @season-dialog-open=${() => this.readKnownSpecialDays()}
                            @season-changed=${(event: Event) => {
                              event.stopPropagation();
                              this.api.rereadWithSpecialDays();
                            }}
                            @year-change=${(event: CustomEvent<{ year: number }>) => {
                              event.stopPropagation();
                              void Promise.resolve(
                                this.url.write({
                                  dashboard: "opening-hours",
                                  view: "year",
                                  year: String(event.detail.year).padStart(4, "0"),
                                }),
                              ).then(() => this.followUrl());
                            }}
                            @year-month-open=${this.openMonth}
                          ></opening-hours-year>`
                      : this.view === "date" && this.dayDate
                        ? html`<opening-hours-day
                            .api=${this.api}
                            .model=${this.model}
                            .date=${this.dayDate}
                            .readOnly=${this.readOnly}
                            @special-day-action=${this.openNamedDay}
                          ></opening-hours-day>`
                        : this.shownMonth()
                          ? this.month()
                          : nothing
                  }
                </div>
                <div slot="week">
                  ${this.view === "week" && !department ? html`<p>${t("menu.no_departments")}</p>` : nothing}
                  ${
                    this.view === "week" && this.stationId
                      ? html`<opening-hours-station
                          .api=${this.api}
                          .model=${this.model}
                          .stationId=${this.stationId}
                          .weekStart=${this.currentWeek() || "2026-01-05"}
                          .normal=${true}
                        ></opening-hours-station>`
                      : this.view === "week" && this.departmentId === "all"
                        ? html`<opening-hours-all
                            .departments=${this.model.departments}
                            .clockRevision=${this.model.clockRevision}
                            .businessDayClock=${this.model.businessDayClock}
                            .dayCutover=${this.model.dayCutover}
                            .seasonId=${this.season}
                            .seasons=${this.model.seasons}
                            @department-open=${(event: CustomEvent<{ departmentId: string }>) => {
                              event.stopPropagation();
                              void this.chooseDepartment(event.detail.departmentId);
                            }}
                          ></opening-hours-all>`
                        : this.view === "week" && this.zone()
                          ? keyed(
                              `${this.zone()!.id}:${this.season}`,
                              html`<opening-hours-zone-week
                                .api=${this.api}
                                .department=${department!}
                                .zone=${this.zone()!}
                                .seasonId=${this.season}
                                .seasons=${this.model.seasons}
                                .clockRevision=${this.model.clockRevision}
                                .businessDayClock=${this.model.businessDayClock}
                                .dayCutover=${this.model.dayCutover}
                                .readOnly=${this.readOnly}
                              ></opening-hours-zone-week>`,
                            )
                          : this.view === "week" && department
                            ? keyed(
                                `${department.id}:${this.season}`,
                                html`<opening-hours-week
                                  .api=${this.api}
                                  .department=${department}
                                  .seasonId=${this.season}
                                  .seasons=${this.model.seasons}
                                  .menus=${this.model!.menus}
                                  .clockRevision=${this.model!.clockRevision}
                                  .businessDayClock=${this.model!.businessDayClock}
                                  .dayCutover=${this.model!.dayCutover}
                                  .readOnly=${this.readOnly}
                                ></opening-hours-week>`,
                              )
                            : nothing
                  }
                </div>
                <div slot="periods">
                  ${this.view === "periods" && department ? this.periods(department) : nothing}
                </div>
              </wt-tabs>`
      }
      ${this.specialReadError ? html`<p role="alert" data-test="special-read-error">${this.specialReadError}</p>` : nothing}
      ${this.namedDialog()} ${this.ordinaryDialog()}
      ${
        this.editor
          ? keyed(
              this.editor,
              html`<period-editor
                .open=${true}
                .period=${this.editor.period}
                .departmentName=${this.editor.department.name}
                .usedColours=${this.editor.department.periods.map((period) => period.colour)}
                .menus=${this.model!.menus}
                .busy=${this.busy}
                @period-save=${this.savePeriod}
                @period-close=${(event: Event) => {
                  event.stopPropagation();
                  if (this.isConnected && this.editor === editor && !this.busy)
                    this.editor = undefined;
                }}
              ></period-editor>`,
            )
          : nothing
      }
      ${
        this.deleting
          ? keyed(
              this.deleting,
              html`<wt-dialog
                .open=${true}
                heading=${t("menu.delete_period_heading")}
                .dismissible=${!this.busy}
                @wt-close=${(event: Event) => {
                  event.stopPropagation();
                  if (currentDelete()) this.deleting = undefined;
                }}
              >
                <p>${format("opening.delete_confirm", { name: this.deleting.period.name })}</p>
                ${this.routingWarning(this.deleting.period)}
                ${this.deleteError ? html`<p role="alert" data-test="delete-error">${this.deleteError}</p>` : nothing}
                <wt-form-actions slot="footer"
                  ><wt-button
                    slot="cancel"
                    variant="secondary"
                    ?disabled=${this.busy}
                    @click=${() => {
                      if (currentDelete()) this.deleting = undefined;
                    }}
                    >${t("hours.cancel")}</wt-button
                  ><wt-button
                    data-test="confirm-delete"
                    variant="danger"
                    ?disabled=${this.busy}
                    @click=${() => this.deletePeriod(deleting!)}
                    >${t("menu.delete")}</wt-button
                  ></wt-form-actions
                >
              </wt-dialog>`,
            )
          : nothing
      }`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "dashboard-opening-hours-screen": OpeningHoursScreen;
  }
}
