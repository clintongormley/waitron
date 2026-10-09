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
import "./hours-calendar.js";
import "./named-day-editor.js";
import "./named-day-copy.js";
import type { NamedCalendarAction } from "./hours-calendar.js";
import type { NamedDayEditor, NamedDayInput } from "./named-day-editor.js";
import type { NamedDayCopy } from "./named-day-copy.js";
import type { PeriodEditor } from "./period-editor.js";
import type { MenuPeriodInput, MenuPeriodUse, OpeningHoursModel } from "../menu-timetable-types.js";
import type { OpeningHoursApi } from "./opening-hours-client.js";
import { businessDateToday } from "./opening-hours-day.js";
import { addDays, isLocalDate, weekdayOf } from "../hours-rules.js";
import type { NamedDaysModel } from "../holiday-types.js";
import "@waitron/ui/src/components/wt-switch.js";
import { format, formatDate } from "./hours-view.js";
import { t } from "./strings.js";

type Department = OpeningHoursModel["departments"][number];
type Period = Department["periods"][number];
type View = "week" | "periods" | "day" | "calendar";
type Editor = { department: Department; period?: Period };
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
  @state() private view: View = "week";
  @state() private month = "";
  @state() private weekStart = "";
  @state() private namedWeek?: NamedDaysModel;
  @state() private namedReadError = "";
  private weekDetach?: () => void;
  private watchedWeek = "";
  @state() private readError = "";
  @state() private editor?: Editor;
  @state() private deleting?: Deletion;
  @state() private deleteError = "";
  @state() private busy = false;
  @state() private namedAction?: NamedCalendarAction;
  @state() private namedDeleteError = "";
  private detach?: () => void;
  private generation = {};
  private readonly url = new UrlStateController(this, () => this.followUrl(), {
    basePath: "/manage",
    primary: "dashboard",
    children: {
      "opening-hours": { view: "view", department: "department", zone: "zone", month: "month" },
    },
  });
  private followUrl() {
    if (this.url.read("dashboard") !== "opening-hours") return;
    const view = this.url.read("view");
    this.view = view === "periods" || view === "day" || view === "calendar" ? view : "week";
    this.departmentId = this.url.read("department") ?? "";
    this.zoneId = this.url.read("zone") ?? "";
    const month = this.url.read("month") ?? "";
    this.month = /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : "";
    const week =
      new URL(navigationGuardFor(window)?.href ?? location.href).searchParams.get("week") ?? "";
    this.weekStart = isLocalDate(week) && weekdayOf(week) === 1 ? week : "";
  }
  override connectedCallback() {
    super.connectedCallback();
    this.detach = this.api.watchOpeningHours(
      (model) => {
        this.model = model;
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
        ]
      : departments.map((department) => ({ value: department.id, label: department.name }));
  }
  private pickerValue() {
    if (this.view === "week" && this.departmentId === "all") return "all";
    const zone = this.view === "week" ? this.zone() : undefined;
    return zone ? `zone:${zone.id}` : (this.department()?.id ?? "");
  }
  private async chooseDepartment(value: string) {
    if (!this.isConnected) return;
    if (value === "all" && this.view === "week") {
      await this.url.write({ dashboard: "opening-hours", department: "all", zone: null });
    } else if (value.startsWith("zone:") && this.view === "week") {
      const zoneId = value.slice(5);
      const department = this.model?.departments.find(
        (d) => d.active && d.zones?.some((z) => z.id === zoneId),
      );
      if (!department) return;
      await this.url.write({ dashboard: "opening-hours", department: department.id, zone: zoneId });
    } else {
      const department = this.model?.departments.find((d) => d.id === value);
      if (!department) return;
      await this.url.write({ dashboard: "opening-hours", department: department.id, zone: null });
    }
    this.followUrl();
  }
  private currentWeek() {
    const date = this.model ? businessDateToday(this.model) : "";
    return date ? addDays(date, -((weekdayOf(date) + 6) % 7)) : "";
  }
  protected override willUpdate() {
    if (!this.model) return;
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
      this.weekDetach = this.api.namedDays.watchNamedDays(
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
    const generation = this.generation;
    const url = new URL(navigationGuardFor(window)?.href ?? location.href);
    if (week) url.searchParams.set("week", week);
    else url.searchParams.delete("week");
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
    this.editor = { department, period };
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
      if (periodId === null) await this.api.createPeriod(editor.department.id, input);
      else await this.api.updatePeriod(periodId, input);
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
      this.busy = false;
    }
    if (this.editor === editor && component.commitSubmitted(input)) this.editor = undefined;
    this.api.rereadWatches();
  }
  private askDelete(period: Period) {
    if (this.readOnly || this.busy || !this.isConnected || this.editor || this.deleting) return;
    this.deleteError = "";
    this.deleting = { period };
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
  private openNamedDay(event: CustomEvent<NamedCalendarAction>) {
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
    this.namedDeleteError = "";
    const holidays =
      this.namedWeek?.days?.find((day) => day.date === event.detail.date)?.holidays ??
      event.detail.holidays;
    this.namedAction = { ...event.detail, holidays };
  }
  private closeNamedDay(action: NamedCalendarAction) {
    if (!this.isConnected || this.namedAction !== action || this.busy) return;
    this.namedAction = undefined;
    void this.updateComplete.then(() => action.returnTo()?.focus());
  }
  private async saveNamedDay(
    event: CustomEvent<
      { id: string | null; input: NamedDayInput } | { id: string; dates: string[] }
    >,
  ) {
    event.stopPropagation();
    const action = this.namedAction;
    const component = event.currentTarget as NamedDayEditor | NamedDayCopy;
    if (
      !action ||
      !this.isConnected ||
      this.readOnly ||
      this.busy ||
      component !== this.shadowRoot?.querySelector("named-day-editor, named-day-copy")
    )
      return;
    const generation = this.generation;
    const detail = event.detail;
    this.busy = true;
    component.refusal = undefined;
    try {
      if ("dates" in detail) await this.api.namedDays.copyDay(detail.id, detail.dates);
      else
        await this.api.namedDays.saveDay(
          detail.id,
          detail.input,
          action.day,
          () => this.isConnected && generation === this.generation && this.namedAction === action,
        );
    } catch (error) {
      if (this.isConnected && generation === this.generation && this.namedAction === action)
        component.refusal = {
          code: codeOf(error),
          params:
            typeof error === "object" && error !== null
              ? (error as { params?: Record<string, unknown> }).params
              : undefined,
        };
      return;
    } finally {
      if (generation === this.generation) this.busy = false;
    }
    if (!this.isConnected || generation !== this.generation || this.namedAction !== action) return;
    const clean =
      "dates" in detail
        ? (component as NamedDayCopy).commitSubmitted(detail.dates)
        : (component as NamedDayEditor).commitSubmitted(detail.input);
    if (clean) this.closeNamedDay(action);
    this.api.namedDays.rereadWatches();
    this.api.rereadWatches();
  }
  private async deleteNamedDay(action: NamedCalendarAction) {
    if (
      !this.isConnected ||
      this.readOnly ||
      this.busy ||
      this.namedAction !== action ||
      !action.day
    )
      return;
    const generation = this.generation;
    this.busy = true;
    this.namedDeleteError = "";
    try {
      await this.api.namedDays.deleteDay(action.day.id);
    } catch {
      if (this.isConnected && generation === this.generation && this.namedAction === action)
        this.namedDeleteError = t("hours.save_error");
      return;
    } finally {
      if (generation === this.generation) this.busy = false;
    }
    if (!this.isConnected || generation !== this.generation || this.namedAction !== action) return;
    this.closeNamedDay(action);
    this.api.namedDays.rereadWatches();
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
          data-test="delete-named-day"
          heading=${t("hours.delete")}
          .dismissible=${!this.busy}
          @wt-close=${(event: Event) => {
            event.stopPropagation();
            if (current()) this.closeNamedDay(action);
          }}
        >
          <p>
            ${format(action.day!.repeats ? "named.delete_repeat" : "named.delete", { name: action.day!.name })}
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
              data-test="confirm-named-delete"
              variant="danger"
              ?disabled=${this.busy}
              ?loading=${this.busy}
              @click=${() => this.deleteNamedDay(action)}
              >${t("hours.delete")}</wt-button
            ></wt-form-actions
          >
        </wt-dialog>`,
      );
    if (action.kind === "copy")
      return keyed(
        action,
        html`<named-day-copy
          .open=${true}
          .day=${action.day!}
          .api=${this.api.namedDays}
          .busy=${this.busy}
          @named-day-copy-save=${this.saveNamedDay}
          @named-day-copy-close=${(event: Event) => {
            event.stopPropagation();
            if (current()) this.closeNamedDay(action);
          }}
        ></named-day-copy>`,
      );
    return keyed(
      action,
      html`<named-day-editor
        .open=${true}
        .day=${action.day}
        .date=${action.date}
        .holidays=${action.holidays}
        .ownHours=${action.kind === "own"}
        .savableAtOpen=${action.kind === "own"}
        .busy=${this.busy}
        @named-day-save=${this.saveNamedDay}
        @named-day-close=${(event: Event) => {
          event.stopPropagation();
          if (current()) this.closeNamedDay(action);
        }}
      ></named-day-editor>`,
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
                        label=${t("menu.department")}
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
                    this.view === "week" && this.departmentId === "all"
                      ? html`<opening-hours-all
                          .departments=${this.model.departments}
                          .dayCutover=${this.model.dayCutover}
                          .weekStart=${this.weekStart}
                          .namedDays=${this.model.namedDays}
                          @department-open=${(event: CustomEvent<{ departmentId: string }>) => {
                            event.stopPropagation();
                            void this.chooseDepartment(event.detail.departmentId);
                          }}
                        ></opening-hours-all>`
                      : this.view === "week" && this.zone()
                        ? keyed(
                            `${this.zone()!.id}:${this.weekStart}`,
                            html`<opening-hours-zone-week
                              .api=${this.api}
                              .department=${department!}
                              .zone=${this.zone()!}
                              .dayCutover=${this.model.dayCutover}
                              .readOnly=${this.readOnly}
                              .weekStart=${this.weekStart}
                              .namedDays=${this.model.namedDays}
                              .dateActionsReady=${!!this.namedWeek && !this.namedReadError}
                              @named-calendar-action=${this.openNamedDay}
                            ></opening-hours-zone-week>`,
                          )
                        : this.view === "week" && department
                          ? keyed(
                              `${department.id}:${this.weekStart}`,
                              html`<opening-hours-week
                                .api=${this.api}
                                .department=${department}
                                .menus=${this.model!.menus}
                                .dayCutover=${this.model!.dayCutover}
                                .timeZone=${this.model!.clockReadable ? this.model!.timeZone : undefined}
                                .weekStart=${this.weekStart}
                                .namedDays=${this.model.namedDays}
                                .dateActionsReady=${!!this.namedWeek && !this.namedReadError}
                                .readOnly=${this.readOnly}
                                @named-calendar-action=${this.openNamedDay}
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
                          .namedApi=${this.api.namedDays}
                          @named-calendar-action=${this.openNamedDay}
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
                  ${this.view === "day" ? html`<opening-hours-day .api=${this.api} .model=${this.model} .readOnly=${this.readOnly} @named-calendar-action=${this.openNamedDay}></opening-hours-day>` : nothing}
                </div>
              </wt-tabs>`
      }
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
