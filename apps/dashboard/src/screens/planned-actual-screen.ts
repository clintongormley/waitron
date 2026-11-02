import { DashboardQueries } from "../api/query-controller.js";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-input.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import type { DashboardApi, PlannedVsActualRow } from "../api/client.js";
import { MS_PER_DAY, mondayOf, today } from "../date-utils.js";
import { personNameMap, resolvePersonName } from "../person-utils.js";

function weekEnd(monday: string): string {
  return new Date(Date.parse(`${monday}T00:00:00Z`) + 7 * MS_PER_DAY).toISOString().slice(0, 10);
}

@customElement("dashboard-planned-actual-screen")
export class PlannedActualScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      h1 {
        margin: 0 0 var(--wt-space-4);
        font-size: var(--wt-font-size-lg);
        color: var(--wt-color-text);
      }
      .picker {
        margin-bottom: var(--wt-space-4);
      }
      table {
        width: 100%;
        border-collapse: collapse;
        color: var(--wt-color-text);
      }
      th,
      td {
        background: var(--wt-color-surface);
        border: 1px solid var(--wt-color-border);
        padding: var(--wt-space-2);
        text-align: left;
      }
      .muted {
        color: var(--wt-color-text-muted);
        margin-top: var(--wt-space-3);
      }
      .error {
        color: var(--wt-color-danger);
        margin-top: var(--wt-space-3);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.errorKey = codeOf(error);
    },
    (error) => {
      if (this.errorKey === codeOf(error)) this.errorKey = null;
    },
  );

  @state() private weekMonday = mondayOf(today());
  @state() private rows: PlannedVsActualRow[] = [];
  @state() private errorKey: string | null = null;
  #names = new Map<string, string>();

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  async #load(): Promise<void> {
    this.errorKey = null;
    try {
      await Promise.all([
        this.#queries.watch("listStaff", [], (value) => {
          this.#names = personNameMap(value);
          this.requestUpdate();
        }),
        this.#loadRows(),
      ]);
    } catch (error) {
      this.#fail(error);
    }
  }

  async #loadRows(): Promise<void> {
    await this.#queries.watch(
      "getPlannedVsActual",
      [this.weekMonday, weekEnd(this.weekMonday)],
      (value) => {
        this.rows = value;
      },
    );
  }

  #fail(error: unknown): void {
    this.errorKey = codeOf(error);
  }

  async #onSelectWeek(event: CustomEvent<{ value: string }>): Promise<void> {
    event.stopPropagation();
    const value = event.detail.value;
    // A date field reads "" while cleared or part-typed, which parses to NaN.
    if (Number.isNaN(Date.parse(`${value}T00:00:00Z`))) return;
    this.weekMonday = mondayOf(value);
    this.errorKey = null;
    try {
      await this.#loadRows();
    } catch (error) {
      this.#fail(error);
    }
  }

  #name(personId: string): string {
    return resolvePersonName(this.#names, personId);
  }

  #flags(row: PlannedVsActualRow): string {
    const labels: string[] = [];
    if (row.noShow) labels.push(t("planned.no_show"));
    if (row.unplanned) labels.push(t("planned.unplanned"));
    return labels.join(" ");
  }

  override render(): TemplateResult {
    return html`
      <h1>${t("planned.title")}</h1>
      ${this.#renderBody()}
    `;
  }

  #renderError(errorKey: string): TemplateResult {
    return html`<p class="error" role="alert" data-test="error">${codeMessage(errorKey)}</p>`;
  }

  #renderBody(): TemplateResult {
    return html`
      <wt-input
        class="picker"
        type="date"
        data-test="week-picker"
        name="week"
        label=${t("planned.week")}
        .value=${this.weekMonday}
        @wt-change=${(e: CustomEvent<{ value: string }>) => void this.#onSelectWeek(e)}
      ></wt-input>
      ${
        this.rows.length === 0
          ? html`<p class="muted" data-test="empty">${t("planned.empty")}</p>`
          : html`<table>
              <thead>
                <tr>
                  <th scope="col">${t("planned.person")}</th>
                  <th scope="col">${t("planned.day")}</th>
                  <th scope="col">${t("planned.planned_minutes")}</th>
                  <th scope="col">${t("planned.worked_minutes")}</th>
                  <th scope="col">${t("planned.late_minutes")}</th>
                  <th scope="col">${t("planned.flags")}</th>
                </tr>
              </thead>
              <tbody>
                ${this.rows.map(
                  (r) =>
                    html`<tr data-test=${`row-${r.personId}-${r.workDate}`}>
                      <th scope="row">${this.#name(r.personId)}</th>
                      <td>${r.workDate}</td>
                      <td>${r.plannedMinutes}</td>
                      <td>${r.workedMinutes}</td>
                      <td>${r.lateMinutes}</td>
                      <td>${this.#flags(r)}</td>
                    </tr>`,
                )}
              </tbody>
            </table>`
      }
      ${this.errorKey ? this.#renderError(this.errorKey) : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-planned-actual-screen": PlannedActualScreen;
  }
}
