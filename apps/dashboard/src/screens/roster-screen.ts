import { DashboardQueries } from "../api/query-controller.js";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "../widgets/shift-dialog.js";
// This import also registers `<dashboard-location-picker>`.
import { resolveLocationSelection } from "../widgets/location-picker.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { breachKindName } from "../i18n/domain.js";
import type { AddShiftDetail, UpdateShiftDetail } from "../widgets/shift-dialog.js";
import type {
  DashboardApi,
  LocationSummary,
  PersonSummary,
  RosterBreach,
  RosterSnapshot,
  Shift,
} from "../api/client.js";
import { MS_PER_DAY, mondayOf, today } from "../date-utils.js";

function weekDays(monday: string): string[] {
  const base = Date.parse(`${monday}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, i) =>
    new Date(base + i * MS_PER_DAY).toISOString().slice(0, 10),
  );
}
function localDate(instant: string, offsetMinutes: number): string {
  return new Date(Date.parse(instant) + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

/** Breaches are advisory: a breaching roster still publishes (owner decision 2026-08-02). */
@customElement("dashboard-roster-screen")
export class RosterScreen extends LitElement {
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
      table {
        width: 100%;
        border-collapse: collapse;
        color: var(--wt-color-text);
      }
      th,
      td {
        /* An explicit surface background (not transparent) so a color-contrast check composites the
         * cell text against a DEFINED background in both themes — axe cannot see through the transparent
         * cell + shadow boundary to the host bg and would otherwise read it as white. Same surface/text
         * pairing wt-input uses. */
        background: var(--wt-color-surface);
        border: 1px solid var(--wt-color-border);
        padding: var(--wt-space-2);
        text-align: left;
        vertical-align: top;
      }
      /* The editable cell's affordance is a real button filling the cell (transparent, so its text
       * still composites against the td's defined surface for the contrast check). It inherits the
       * host's :focus-visible ring from baseStyles, so keyboard focus is visible. min-height keeps an
       * empty cell a comfortable click/tap target. */
      .cell-button {
        display: block;
        width: 100%;
        min-height: var(--wt-space-5);
        margin: 0;
        padding: 0;
        border: none;
        background: none;
        font: inherit;
        color: inherit;
        text-align: left;
        cursor: pointer;
      }
      .breaches {
        margin-top: var(--wt-space-4);
        color: var(--wt-color-text);
      }
      .error {
        color: var(--wt-color-danger);
        margin-top: var(--wt-space-3);
      }
      .readonly {
        color: var(--wt-color-text-muted);
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
  @state() private staff: PersonSummary[] = [];
  @state() private weekMonday = mondayOf(today());
  @state() private snapshot: RosterSnapshot = { version: null, shifts: [] };
  @state() private dialogOpen = false;
  @state() private dialogPersonId = "";
  @state() private dialogDay = "";
  @state() private dialogShift: Shift | null = null;
  @state() private breaches: RosterBreach[] = [];
  @state() private errorKey: string | null = null;
  // Set synchronously on entry, so a double-fired event files at most one mutation.
  @state() private busy = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  private get editable(): boolean {
    return this.snapshot.version === null || this.snapshot.version.status === "draft";
  }

  private get draftVersionId(): string | null {
    return this.snapshot.version?.status === "draft" ? this.snapshot.version.id : null;
  }

  async #load(): Promise<void> {
    this.errorKey = null;
    this.breaches = [];
    let initial = true;
    try {
      await Promise.all([
        this.#queries.watch("listStaff", [], (value) => {
          this.staff = value;
        }),
        this.#queries.watch("getLocations", [], async (locations) => {
          this.locations = locations;
          if (locations.length === 0) {
            this.locationId = "";
            this.#queries.release("getRoster");
            this.snapshot = { version: null, shifts: [] };
            return;
          }
          const selected = resolveLocationSelection(locations, this.locationId);
          if (initial || selected !== this.locationId) {
            initial = false;
            this.locationId = selected;
            await this.#loadRoster();
          }
        }),
      ]);
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  async #loadRoster(): Promise<void> {
    await this.#queries.watch("getRoster", [this.locationId, this.weekMonday], (value) => {
      this.snapshot = value;
    });
  }

  async #onSelectLocation(event: CustomEvent<{ locationId: string }>): Promise<void> {
    event.stopPropagation();
    this.locationId = event.detail.locationId;
    this.errorKey = null;
    // The breaches belong to the roster being left.
    this.breaches = [];
    try {
      await this.#loadRoster();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  async #onSelectWeek(event: Event): Promise<void> {
    event.stopPropagation();
    const value = (event.target as HTMLInputElement).value;
    // A cleared date input gives "", on which mondayOf throws a RangeError.
    if (Number.isNaN(Date.parse(`${value}T00:00:00Z`))) return;
    this.weekMonday = mondayOf(value);
    this.errorKey = null;
    // The breaches belong to the roster being left.
    this.breaches = [];
    try {
      await this.#loadRoster();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** `shift` is null for a new one. The caller names it because a cell can hold several shifts. */
  openCell(personId: string, day: string, shift: Shift | null): void {
    if (!this.editable) return;
    this.errorKey = null;
    this.dialogPersonId = personId;
    this.dialogDay = day;
    this.dialogShift = shift;
    this.dialogOpen = true;
  }

  async #onAddShift(event: CustomEvent<AddShiftDetail>): Promise<void> {
    event.stopPropagation();
    if (this.busy) return;
    this.busy = true;
    this.errorKey = null;
    try {
      let versionId = this.draftVersionId;
      if (versionId === null) {
        versionId = (await this.api.createRosterVersion(this.locationId, this.weekMonday))
          .versionId;
      }
      await this.api.addShift(versionId, { ...event.detail, locationId: this.locationId });
      this.dialogOpen = false;
      await this.#loadRoster();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.busy = false;
    }
  }

  async #onUpdateShift(event: CustomEvent<UpdateShiftDetail>): Promise<void> {
    event.stopPropagation();
    if (this.busy) return;
    this.busy = true;
    this.errorKey = null;
    try {
      await this.api.updateShift(event.detail.shiftId, event.detail.patch);
      this.dialogOpen = false;
      await this.#loadRoster();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.busy = false;
    }
  }

  async #onRemoveShift(event: CustomEvent<{ shiftId: string }>): Promise<void> {
    event.stopPropagation();
    if (this.busy) return;
    this.busy = true;
    this.errorKey = null;
    try {
      await this.api.removeShift(event.detail.shiftId);
      this.dialogOpen = false;
      await this.#loadRoster();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.busy = false;
    }
  }

  async #onPublish(): Promise<void> {
    const versionId = this.draftVersionId;
    if (versionId === null || this.busy) return;
    this.busy = true;
    this.errorKey = null;
    try {
      this.breaches = (await this.api.publishRoster(versionId)).breaches;
      await this.#loadRoster();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.busy = false;
    }
  }

  override render(): TemplateResult {
    return html`
      <h1>${t("roster.title")}</h1>
      ${
        this.locations.length === 0
          ? html`<p class="prompt" data-test="no-location">${t("roster.no_location")}</p>`
          : this.#renderGrid()
      }
      <dashboard-shift-dialog
        .open=${this.dialogOpen}
        .day=${this.dialogDay}
        .personId=${this.dialogPersonId}
        .shift=${this.dialogShift}
        .busy=${this.busy}
        @add-shift=${(e: CustomEvent<AddShiftDetail>) => void this.#onAddShift(e)}
        @update-shift=${(e: CustomEvent<UpdateShiftDetail>) => void this.#onUpdateShift(e)}
        @remove-shift=${(e: CustomEvent<{ shiftId: string }>) => void this.#onRemoveShift(e)}
        @wt-close=${() => (this.dialogOpen = false)}
      ></dashboard-shift-dialog>
    `;
  }

  #renderGrid(): TemplateResult {
    const days = weekDays(this.weekMonday);
    const version = this.snapshot.version;
    const published = version !== null && version.status !== "draft";
    return html`
      <div class="pickers">
        <dashboard-location-picker
          .locations=${this.locations}
          .selected=${this.locationId}
          .label=${t("roster.location")}
          @location-changed=${(e: CustomEvent<{ locationId: string }>) =>
            void this.#onSelectLocation(e)}
        ></dashboard-location-picker>
        <label class="picker"
          >${t("roster.week")}
          <input
            type="date"
            data-test="week-picker"
            .value=${this.weekMonday}
            @change=${(e: Event) => void this.#onSelectWeek(e)}
          />
        </label>
      </div>
      <table>
        <thead>
          <tr>
            <th scope="col">${t("roster.title")}</th>
            ${days.map((d) => html`<th scope="col">${d}</th>`)}
          </tr>
        </thead>
        <tbody>
          ${this.staff.map(
            (person) => html`
              <tr data-test=${`row-${person.personId}`}>
                <th scope="row">${person.displayName}</th>
                ${days.map((day) => this.#renderCell(person.personId, day))}
              </tr>
            `,
          )}
        </tbody>
      </table>
      ${
        this.draftVersionId !== null
          ? html`<wt-button
              variant="primary"
              data-test="publish"
              ?disabled=${this.busy}
              @click=${() => void this.#onPublish()}
              >${t("roster.publish")}</wt-button
            >`
          : nothing
      }
      ${
        published
          ? html`<p class="readonly" data-test="readonly">${t("roster.published_readonly")}</p>`
          : nothing
      }
      ${
        this.breaches.length > 0
          ? html`<div class="breaches" role="status" data-test="breaches">
              <p>${t("roster.breaches_intro")}</p>
              <ul>
                ${this.breaches.map((b) => html`<li>${breachKindName(b.kind)}</li>`)}
              </ul>
            </div>`
          : nothing
      }
      ${
        this.errorKey
          ? html`<p class="error" role="alert" data-test="error">${codeMessage(this.errorKey)}</p>`
          : nothing
      }
    `;
  }

  /** Real buttons rather than a clickable `<td>`, which axe did not flag. The add button carries an
   * `aria-label` only while the cell is empty; otherwise it shows visible text, so its accessible name
   * and its content never disagree. */
  #renderCell(personId: string, day: string): TemplateResult {
    const cellShifts = this.snapshot.shifts.filter(
      (s) => s.personId === personId && localDate(s.startsAt, s.startsOffsetMinutes) === day,
    );
    const testId = `cell-${personId}-${day}`;
    const label = (s: Shift): string => `${s.startsAt.slice(11, 16)}–${s.endsAt.slice(11, 16)}`;
    if (!this.editable) {
      return html`<td data-test=${testId}>
        ${cellShifts.map((s) => html`<span>${label(s)}</span>`)}
      </td>`;
    }
    return html`<td>
      ${cellShifts.map(
        (s) =>
          html`<button
            type="button"
            class="cell-button"
            data-test=${`edit-${s.id}`}
            @click=${() => this.openCell(personId, day, s)}
          >
            ${label(s)}
          </button>`,
      )}
      <button
        type="button"
        class="cell-button"
        data-test=${testId}
        aria-label=${cellShifts.length > 0 ? nothing : t("roster.new_shift")}
        @click=${() => this.openCell(personId, day, null)}
      >
        ${cellShifts.length > 0 ? t("roster.add_another") : nothing}
      </button>
    </td>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-roster-screen": RosterScreen;
  }
}
