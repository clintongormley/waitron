import { LitElement, css, html, nothing } from "lit";
import { keyed } from "lit/directives/keyed.js";
import { codeOf } from "@waitron/dashboard-kit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  leaveCoordinatorFor,
  UrlStateController,
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
import type { PeriodEditor } from "./period-editor.js";
import type { MenuPeriodInput, MenuPeriodUse, OpeningHoursModel } from "../menu-timetable-types.js";
import type { OpeningHoursApi } from "./opening-hours-client.js";
import { format, formatDate } from "./hours-view.js";
import { t } from "./strings.js";

type Department = OpeningHoursModel["departments"][number];
type Period = Department["periods"][number];
type View = "week" | "periods" | "day";
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
  @state() private view: View = "week";
  @state() private weekMode = "week";
  @state() private specialDateId = "";
  @state() private readError = "";
  @state() private editor?: Editor;
  @state() private deleting?: Deletion;
  @state() private deleteError = "";
  @state() private busy = false;
  private detach?: () => void;
  private generation = {};
  private readonly url = new UrlStateController(this, () => this.followUrl(), {
    basePath: "/manage",
    primary: "dashboard",
    children: { "opening-hours": { view: "view", department: "department" } },
  });
  private followUrl() {
    if (this.url.read("dashboard") !== "opening-hours") return;
    const view = this.url.read("view");
    this.view = view === "periods" || view === "day" ? view : "week";
    this.departmentId = this.url.read("department") ?? "";
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
    this.generation = {};
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
  private async chooseWeek(value: string, date = false) {
    const generation = this.generation;
    const proceed = () => {
      if (!this.isConnected || generation !== this.generation || this.view !== "week") return;
      if (date) this.specialDateId = value;
      else this.weekMode = value;
    };
    const coordinator = leaveCoordinatorFor(this);
    if (coordinator) await coordinator.request({ scopes: "all", reason: "navigation", proceed });
    else proceed();
  }
  private selectedSpecialDate() {
    const dates = this.model?.specialDates ?? [];
    return dates.find((date) => date.id === this.specialDateId) ?? dates[0];
  }
  private weekChooser() {
    const dates = this.model!.specialDates;
    const special = this.selectedSpecialDate();
    return html`<div class="chooser">
      <wt-combobox
        name="weekMode"
        label=${t("opening.week_mode")}
        search="never"
        .value=${this.weekMode}
        .options=${[
          { value: "week", label: t("menu.normal_week") },
          { value: "date", label: t("opening.special_date") },
        ]}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          if (
            !this.isConnected ||
            event.currentTarget !== this.shadowRoot?.querySelector("[name=weekMode]")
          )
            return;
          (event.currentTarget as HTMLElementTagNameMap["wt-combobox"]).value = this.weekMode;
          if (event.detail.value === "week" || event.detail.value === "date")
            void this.chooseWeek(event.detail.value);
        }}
      ></wt-combobox>
      ${
        this.weekMode === "date"
          ? html`<wt-combobox
                name="specialDateId"
                label=${t("opening.special_date")}
                search="never"
                .value=${special?.id ?? ""}
                .options=${dates.map((date) => ({ value: date.id, label: `${formatDate(date.date)} · ${date.name}` }))}
                @wt-change=${(event: CustomEvent<{ value: string }>) => {
                  event.stopPropagation();
                  if (
                    !this.isConnected ||
                    event.currentTarget !== this.shadowRoot?.querySelector("[name=specialDateId]")
                  )
                    return;
                  (event.currentTarget as HTMLElementTagNameMap["wt-combobox"]).value =
                    special?.id ?? "";
                  if (dates.some((date) => date.id === event.detail.value))
                    void this.chooseWeek(event.detail.value, true);
                }}
              ></wt-combobox>
              <a data-test="station-hours-link" href="/manage/hours"
                >${t("opening.add_special_dates")}</a
              >
              ${dates.length ? nothing : html`<p>${t("menu.no_dates")}</p>`}`
          : nothing
      }
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
    const special = this.weekMode === "date" ? this.selectedSpecialDate() : undefined;
    const editor = this.editor;
    const deleting = this.deleting;
    const currentDelete = () => this.isConnected && this.deleting === deleting && !this.busy;
    return html`<h1>${t("opening.title")}</h1>
      ${this.readError ? html`<p role="alert" data-test="read-error">${this.readError}</p>` : nothing}${
        !this.model
          ? nothing
          : html` ${
                department
                  ? html`<div class="chooser">
                      <wt-combobox
                        name="departmentId"
                        label=${t("menu.department")}
                        search="never"
                        .options=${this.model.departments.map((d) => ({ value: d.id, label: d.active ? d.name : `${d.name} ${t("menu.inactive")}` }))}
                        .value=${department.id}
                        @wt-change=${(event: CustomEvent<{ value: string }>) => {
                          event.stopPropagation();
                          (event.currentTarget as HTMLElementTagNameMap["wt-combobox"]).value =
                            department.id;
                          void this.url.write({
                            dashboard: "opening-hours",
                            department: event.detail.value,
                          });
                          this.followUrl();
                        }}
                      ></wt-combobox>
                    </div>`
                  : html`<p>${t("menu.no_departments")}</p>`
              }
              <wt-tabs
                label=${t("opening.title")}
                .value=${this.view}
                .items=${[
                  { key: "week", label: t("hours.tab.week") },
                  { key: "periods", label: t("opening.tab.periods") },
                  { key: "day", label: t("opening.tab.day") },
                ]}
                @wt-tab-change=${(event: CustomEvent<{ value: View }>) => {
                  if (event.target !== event.currentTarget) return;
                  (event.currentTarget as HTMLElementTagNameMap["wt-tabs"]).value = this.view;
                  void this.url.write({ dashboard: "opening-hours", view: event.detail.value });
                  this.followUrl();
                }}
              >
                <div slot="week">
                  ${this.view === "week" ? this.weekChooser() : nothing}
                  ${this.view === "week" && department && (this.weekMode === "week" || special) ? keyed(`${department.id}:${this.weekMode}:${special?.id ?? ""}`, html`<opening-hours-week .api=${this.api} .department=${department} .menus=${this.model!.menus} .dayCutover=${this.model!.dayCutover} .specialDate=${special} .readOnly=${this.readOnly}></opening-hours-week>`) : nothing}
                </div>
                <div slot="periods">
                  ${this.view === "periods" && department ? this.periods(department) : nothing}
                </div>
                <div slot="day"></div>
              </wt-tabs>`
      }
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
