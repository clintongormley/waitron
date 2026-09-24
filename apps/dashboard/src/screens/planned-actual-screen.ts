import { DashboardQueries } from "../api/query-controller.js";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
// This import also registers `<dashboard-location-picker>`.
import { resolveLocationSelection } from "../widgets/location-picker.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import type { DashboardApi, LocationSummary, PlannedVsActualRow } from "../api/client.js";
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
      .pickers {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-4);
      }
      /* The bottom gap lives on the pickers themselves (not the pickers row) so the week picker here
       * matches the shared dashboard-location-picker widget's own bottom margin and the two align in
       * the flex row — the location picker moved into that widget, which carries the same margin. */
      .picker {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        margin-bottom: var(--wt-space-4);
        color: var(--wt-color-text);
      }
      input[type="date"] {
        font: inherit;
        padding: var(--wt-space-2);
        border-radius: var(--wt-radius-md);
        border: 1px solid var(--wt-color-border);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
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
  );

  @state() private locations: LocationSummary[] = [];
  @state() private locationId = "";
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
    let initial = true;
    try {
      await Promise.all([
        this.#queries.watch("listStaff", [], (value) => {
          this.#names = personNameMap(value);
          this.requestUpdate();
        }),
        this.#queries.watch("getLocations", [], async (locations) => {
          this.locations = locations;
          if (locations.length === 0) {
            this.locationId = "";
            this.#queries.release("getPlannedVsActual");
            this.rows = [];
            return;
          }
          const selected = resolveLocationSelection(locations, this.locationId);
          if (initial || selected !== this.locationId) {
            initial = false;
            this.locationId = selected;
            await this.#loadRows();
          }
        }),
      ]);
    } catch (error) {
      this.#fail(error);
    }
  }

  async #loadRows(): Promise<void> {
    await this.#queries.watch(
      "getPlannedVsActual",
      [this.locationId, this.weekMonday, weekEnd(this.weekMonday)],
      (value) => {
        this.rows = value;
      },
    );
  }

  #fail(error: unknown): void {
    this.errorKey = codeOf(error);
  }

  async #onSelectLocation(event: CustomEvent<{ locationId: string }>): Promise<void> {
    event.stopPropagation();
    this.locationId = event.detail.locationId;
    this.errorKey = null;
    try {
      await this.#loadRows();
    } catch (error) {
      this.#fail(error);
    }
  }

  async #onSelectWeek(event: Event): Promise<void> {
    event.stopPropagation();
    const value = (event.target as HTMLInputElement).value;
    // A cleared date input gives "", which parses to NaN.
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
      ${
        this.locations.length === 0
          ? html`<p class="muted" data-test="no-location">${t("planned.no_location")}</p>`
          : this.#renderBody()
      }
    `;
  }

  #renderBody(): TemplateResult {
    return html`
      <div class="pickers">
        <dashboard-location-picker
          .locations=${this.locations}
          .selected=${this.locationId}
          .label=${t("planned.location")}
          @location-changed=${(e: CustomEvent<{ locationId: string }>) =>
            void this.#onSelectLocation(e)}
        ></dashboard-location-picker>
        <label class="picker"
          >${t("planned.week")}
          <input
            type="date"
            data-test="week-picker"
            .value=${this.weekMonday}
            @change=${(e: Event) => void this.#onSelectWeek(e)}
          />
        </label>
      </div>
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
      ${
        this.errorKey
          ? html`<p class="error" role="alert" data-test="error">${codeMessage(this.errorKey)}</p>`
          : nothing
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-planned-actual-screen": PlannedActualScreen;
  }
}
