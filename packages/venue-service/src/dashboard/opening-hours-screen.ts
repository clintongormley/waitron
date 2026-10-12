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
import "./hours-calendar.js";
import "./special-day-dialog.js";
import type { SpecialDayAction, SpecialDayRef } from "./hours-calendar.js";
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
import { addDays, isLocalDate, weekdayOf } from "../hours-rules.js";
import type { SpecialDaysModel } from "../holiday-types.js";
import "@waitron/ui/src/components/wt-switch.js";
import { format, formatDate } from "./hours-view.js";
import { t } from "./strings.js";
import { chosenSeasonId, seasonOptions } from "./season-choice.js";

type Department = OpeningHoursModel["departments"][number];
type Period = Department["periods"][number];
type View = "week" | "periods" | "day" | "calendar";
type Editor = { department: Department; period?: Period; clockRevision: number };
type OpenSpecialDay = Omit<SpecialDayAction, "specialDay"> & {
  clockRevision: number;
  /** The stored special day holding the date, read when the action opened. */
  detail?: SpecialDayDetail;
  /** The venue's special days, read when the action opened on a public holiday. */
  existing?: { id: string; name: string; latest?: string }[];
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
      .week-nav {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--wt-space-3);
        margin-block: var(--wt-space-3);
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
  @state() private month = "";
  @state() private weekStart = "";
  @state() private namedWeek?: SpecialDaysModel;
  @state() private namedReadError = "";
  private weekDetach?: () => void;
  private watchedWeek = "";
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
        month: "month",
        season: "season",
      },
    },
  });
  private followUrl() {
    if (this.url.read("dashboard") !== "opening-hours") return;
    const view = this.url.read("view");
    const shown = view === "periods" || view === "day" || view === "calendar" ? view : "week";
    if (shown !== this.view) this.specialReadError = "";
    this.view = shown;
    this.departmentId = this.url.read("department") ?? "";
    this.zoneId = this.url.read("zone") ?? "";
    this.requestedSeason = this.url.read("season") ?? "";
    this.stationId =
      this.url.read("station") ??
      new URL(navigationGuardFor(window)?.href ?? location.href).searchParams.get("station") ??
      "";
    const month = this.url.read("month") ?? "";
    this.month = /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : "";
    const week =
      new URL(navigationGuardFor(window)?.href ?? location.href).searchParams.get("week") ?? "";
    this.weekStart = isLocalDate(week) && weekdayOf(week) === 1 ? week : "";
    this.resolveSeason();
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
    this.weekDetach?.();
    this.watchedWeek = "";
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
        ? chosenSeasonId(
            this.model.seasons,
            this.model.currentSeasonId,
            this.weekStart ? "" : this.requestedSeason,
          )
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
    const rawWeek = new URL(navigationGuardFor(window)?.href ?? location.href).searchParams.get(
      "week",
    );
    if (this.view === "week" && rawWeek !== null && !this.weekStart) {
      void this.writeWeek("", true);
      return;
    }
    const current = this.currentWeek();
    if (this.weekStart && current && this.weekStart < current) {
      void this.writeWeek(current, true);
      return;
    }
    const week = this.view === "week" ? this.weekStart : "";
    if (week === this.watchedWeek) return;
    this.weekDetach?.();
    this.watchedWeek = week;
    this.namedWeek = undefined;
    this.namedReadError = "";
    if (week)
      this.weekDetach = this.api.specialDays.watchSpecialDays(
        week,
        addDays(week, 6),
        (model) => {
          if (this.isConnected && this.watchedWeek === week) {
            this.namedWeek = model;
            this.namedReadError = "";
          }
        },
        () => {
          if (this.isConnected && this.watchedWeek === week)
            this.namedReadError = t("opening.load_error");
        },
        () => {
          if (this.isConnected && this.watchedWeek === week) this.namedReadError = "";
        },
      );
  }
  private async writeWeek(week: string, replace = false) {
    if (!this.isConnected || this.view !== "week") return;
    const url = new URL(navigationGuardFor(window)?.href ?? location.href);
    if (week) url.searchParams.set("week", week);
    else url.searchParams.delete("week");
    await this.writeAddress(url, replace);
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
  private weekChooser() {
    const current = this.currentWeek();
    return html`<div class="chooser">
      <wt-switch
        name="realWeek"
        label=${t("opening.real_week")}
        .checked=${!!this.weekStart}
        .disabled=${!current}
        @wt-change=${(event: CustomEvent<{ checked: boolean }>) => {
          event.stopPropagation();
          if (
            !this.isConnected ||
            event.currentTarget !== this.shadowRoot?.querySelector("[name=realWeek]") ||
            this.view !== "week" ||
            (!current && event.detail.checked)
          )
            return;
          (event.currentTarget as HTMLElementTagNameMap["wt-switch"]).checked = !!this.weekStart;
          void this.writeWeek(event.detail.checked ? current : "");
        }}
      ></wt-switch>
      ${!current ? html`<p>${t("opening.clock_unreadable")}</p>` : nothing}
      ${
        this.weekStart
          ? html`<div class="week-nav">
              <wt-button
                variant="secondary"
                data-test="previous-week"
                aria-label=${t("opening.previous_week")}
                ?disabled=${!current || this.weekStart <= current}
                @click=${() => {
                  if (current && this.weekStart > current)
                    void this.writeWeek(addDays(this.weekStart, -7));
                }}
                >‹</wt-button
              >
              <span>${formatDate(this.weekStart)} – ${formatDate(addDays(this.weekStart, 6))}</span>
              <wt-button
                variant="secondary"
                data-test="next-week"
                aria-label=${t("opening.next_week")}
                @click=${() => this.writeWeek(addDays(this.weekStart, 7))}
                >›</wt-button
              >
            </div>`
          : nothing
      }
      ${this.namedReadError ? html`<p role="alert">${this.namedReadError}</p>` : nothing}
    </div>`;
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
                : use.kind === "special_day"
                  ? format("menu.period_use_special_day", {
                      name: use.name,
                      date: formatDate(use.date),
                    })
                  : formatDate(use.date),
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
    if (
      !this.isConnected ||
      this.readOnly ||
      this.busy ||
      this.editor ||
      this.deleting ||
      this.namedAction ||
      ![
        this.shadowRoot?.querySelector("hours-calendar"),
        this.shadowRoot?.querySelector("opening-hours-week"),
        this.shadowRoot?.querySelector("opening-hours-zone-week"),
        this.shadowRoot?.querySelector("opening-hours-day"),
      ].some((component) => component === event.currentTarget)
    )
      return;
    if (
      event.currentTarget !== this.shadowRoot?.querySelector("hours-calendar") &&
      event.currentTarget !== this.shadowRoot?.querySelector("opening-hours-day") &&
      (!this.namedWeek || this.namedReadError)
    )
      return;
    const { specialDay: sent, ...detail } = event.detail;
    const known = this.namedWeek?.days?.find((day) => day.date === detail.date);
    const specialDay: SpecialDayRef | null =
      sent === undefined ? (known?.specialDay ?? null) : sent;
    if (detail.kind === "delete" && !specialDay) return;
    const action: OpenSpecialDay = {
      ...detail,
      holidays: known?.holidays ?? detail.holidays,
      clockRevision: this.namedWeek?.clockRevision ?? this.model!.clockRevision,
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
    this.api.specialDays.rereadWatches();
    this.api.rereadWatches();
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
    this.api.specialDays.rereadWatches();
    this.api.rereadWatches();
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
    this.api.specialDays.rereadWatches();
    this.api.rereadWatches();
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
        .holidays=${[...action.holidays, ...(action.visibleHolidays ?? [])]}
        .existing=${action.existing ?? []}
        .busy=${this.busy}
        @special-day-save=${this.saveNamedDay}
        @special-day-add-to=${this.addToSpecialDay}
        @special-day-close=${(event: Event) => {
          event.stopPropagation();
          if (current()) this.closeNamedDay(action);
        }}
      ></special-day-dialog>`,
    );
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
                this.view !== "day" &&
                this.view !== "calendar"
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
                        this.view === "week" &&
                        !this.weekStart &&
                        !this.stationId &&
                        this.model.seasons.length
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
                  : this.view === "day" || this.view === "calendar"
                    ? nothing
                    : html`<p>${t("menu.no_departments")}</p>`
              }
              <wt-tabs
                label=${t("opening.title")}
                .value=${this.view}
                .items=${[
                  { key: "week", label: t("hours.tab.week") },
                  { key: "periods", label: t("opening.tab.periods") },
                  { key: "day", label: t("opening.tab.day") },
                  { key: "calendar", label: t("hours.tab.calendar") },
                ]}
                @wt-tab-change=${(event: CustomEvent<{ value: View }>) => {
                  if (event.target !== event.currentTarget) return;
                  (event.currentTarget as HTMLElementTagNameMap["wt-tabs"]).value = this.view;
                  void this.url.write({ dashboard: "opening-hours", view: event.detail.value });
                  this.followUrl();
                }}
              >
                <div slot="week">
                  ${this.view === "week" && !department ? html`<p>${t("menu.no_departments")}</p>` : nothing}
                  ${this.view === "week" ? this.weekChooser() : nothing}
                  ${
                    this.view === "week" && this.stationId
                      ? html`<opening-hours-station
                          .api=${this.api}
                          .model=${this.model}
                          .stationId=${this.stationId}
                          .weekStart=${this.weekStart || this.currentWeek() || "2026-01-05"}
                          .normal=${!this.weekStart}
                        ></opening-hours-station>`
                      : this.view === "week" && this.departmentId === "all"
                        ? html`<opening-hours-all
                            .departments=${this.model.departments}
                            .clockRevision=${this.model.clockRevision}
                            .businessDayClock=${this.model.businessDayClock}
                            .dayCutover=${this.model.dayCutover}
                            .weekStart=${this.weekStart}
                            .seasonId=${this.season}
                            .seasons=${this.model.seasons}
                            .namedDays=${this.model.namedDays}
                            @department-open=${(event: CustomEvent<{ departmentId: string }>) => {
                              event.stopPropagation();
                              void this.chooseDepartment(event.detail.departmentId);
                            }}
                          ></opening-hours-all>`
                        : this.view === "week" && this.zone()
                          ? keyed(
                              `${this.zone()!.id}:${this.weekStart}:${this.season}`,
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
                                .weekStart=${this.weekStart}
                                .namedDays=${this.model.namedDays}
                                .dateActionsReady=${!!this.namedWeek && !this.namedReadError}
                                @special-day-action=${this.openNamedDay}
                              ></opening-hours-zone-week>`,
                            )
                          : this.view === "week" && department
                            ? keyed(
                                `${department.id}:${this.weekStart}:${this.season}`,
                                html`<opening-hours-week
                                  .api=${this.api}
                                  .department=${department}
                                  .seasonId=${this.season}
                                  .seasons=${this.model.seasons}
                                  .menus=${this.model!.menus}
                                  .clockRevision=${this.model!.clockRevision}
                                  .businessDayClock=${this.model!.businessDayClock}
                                  .dayCutover=${this.model!.dayCutover}
                                  .timeZone=${this.model!.clockReadable ? this.model!.timeZone : undefined}
                                  .weekStart=${this.weekStart}
                                  .namedDays=${this.model.namedDays}
                                  .dateActionsReady=${!!this.namedWeek && !this.namedReadError}
                                  .readOnly=${this.readOnly}
                                  @special-day-action=${this.openNamedDay}
                                ></opening-hours-week>`,
                              )
                            : nothing
                  }
                </div>
                <div slot="periods">
                  ${this.view === "periods" && department ? this.periods(department) : nothing}
                </div>
                <div slot="calendar">
                  ${
                    this.view === "calendar"
                      ? html`<hours-calendar
                          .namedApi=${this.api.specialDays}
                          @special-day-action=${this.openNamedDay}
                          .month=${this.month}
                          .readOnly=${this.readOnly}
                          @calendar-month-change=${(event: CustomEvent<{ month: string }>) => {
                            event.stopPropagation();
                            void Promise.resolve(
                              this.url.write({
                                dashboard: "opening-hours",
                                view: "calendar",
                                month: event.detail.month,
                              }),
                            ).then(() => this.followUrl());
                          }}
                        ></hours-calendar>`
                      : nothing
                  }
                </div>
                <div slot="day">
                  ${this.view === "day" ? html`<opening-hours-day .api=${this.api} .model=${this.model} .readOnly=${this.readOnly} @special-day-action=${this.openNamedDay}></opening-hours-day>` : nothing}
                </div>
              </wt-tabs>`
      }
      ${this.specialReadError ? html`<p role="alert" data-test="special-read-error">${this.specialReadError}</p>` : nothing}
      ${this.namedDialog()}
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
