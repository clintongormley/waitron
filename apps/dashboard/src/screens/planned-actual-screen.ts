import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import type { DashboardApi, LocationSummary, PlannedVsActualRow } from "../api/client.js";
import { selectStyles } from "../select-styles.js";
import { MS_PER_DAY, mondayOf, today } from "../date-utils.js";
import { personNameMap, resolvePersonName } from "../person-utils.js";

/** The exclusive end of the week starting at `monday` — Monday + 7 days (the half-open [from, to)). */
function weekEnd(monday: string): string {
  return new Date(Date.parse(`${monday}T00:00:00Z`) + 7 * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * The management dashboard's PLANNED-VS-ACTUAL SCREEN (design §3h): a location picker + week picker
 * whose from/to bound `[Monday, Monday+7)`, over a table of one (person, local day) row each —
 * planned vs worked minutes, late minutes, and the no-show / unplanned flags. Person ids render as
 * names via `listStaff`. Every async path is `try/catch`ed into the `errorKey` banner (the
 * roster-screen pattern); a location or week change reloads. Read-only: it authors nothing.
 */
@customElement("dashboard-planned-actual-screen")
export class PlannedActualScreen extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
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
        margin-bottom: var(--wt-space-4);
      }
      .picker {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
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

  @state() private locations: LocationSummary[] = [];
  @state() private locationId = "";
  @state() private weekMonday = mondayOf(today());
  @state() private rows: PlannedVsActualRow[] = [];
  @state() private errorKey: string | null = null;
  // A personId → displayName lookup rebuilt whenever the staff list loads (in #load), so #name is
  // O(1) per rendered row rather than a per-row scan of the staff list.
  #names = new Map<string, string>();

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  /** Load the locations + staff, pick a location (keeping a still-valid one across a reconnect), then
   * the selected location + week's rows. A rejection anywhere becomes the error banner. */
  async #load(): Promise<void> {
    this.errorKey = null;
    try {
      const [locations, staff] = await Promise.all([this.api.getLocations(), this.api.listStaff()]);
      this.locations = locations;
      this.#names = personNameMap(staff);
      if (locations.length === 0) {
        this.locationId = "";
        this.rows = [];
        return;
      }
      if (!locations.some((l) => l.id === this.locationId)) this.locationId = locations[0]!.id;
      await this.#loadRows();
    } catch (error) {
      this.#fail(error);
    }
  }

  /** Load the selected location + week's comparison rows. Throws to its caller's catch. */
  async #loadRows(): Promise<void> {
    this.rows = await this.api.getPlannedVsActual(
      this.locationId,
      this.weekMonday,
      weekEnd(this.weekMonday),
    );
  }

  /** Surface a rejection as the `errorKey` banner — the thrown domain `{ code }`, or `server.internal`
   * when the value carries none (a bare Error / network fault). The one place the fallback lives. */
  #fail(error: unknown): void {
    this.errorKey = codeOf(error);
  }

  async #onSelectLocation(event: Event): Promise<void> {
    event.stopPropagation();
    this.locationId = (event.target as HTMLSelectElement).value;
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
    // A cleared <input type=date> (value "") builds an Invalid Date → NaN; ignore it rather than
    // reloading with a bogus window.
    if (Number.isNaN(Date.parse(`${value}T00:00:00Z`))) return;
    this.weekMonday = mondayOf(value);
    this.errorKey = null;
    try {
      await this.#loadRows();
    } catch (error) {
      this.#fail(error);
    }
  }

  /** A person's display name, or the raw id when a row references someone not in the staff list.
   * Backed by the `#names` map built when the staff list loaded, so it is O(1) per rendered row. */
  #name(personId: string): string {
    return resolvePersonName(this.#names, personId);
  }

  /** The row's advisory flags as a space-joined label — no-show and/or unplanned, or "" for neither. */
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
        <label class="picker"
          >${t("planned.location")}
          <select
            data-test="location-select"
            @change=${(e: Event) => void this.#onSelectLocation(e)}
          >
            ${this.locations.map(
              (l) =>
                html`<option value=${l.id} .selected=${l.id === this.locationId}>
                  ${l.name}
                </option>`,
            )}
          </select>
        </label>
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
