import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
// Value import (not `import type`): pulls in the widget module for its `@customElement` side effect,
// so `<dashboard-shift-dialog>` is registered before this screen renders it (the widget-registration
// pattern the catalogue screen follows).
import "../widgets/shift-dialog.js";
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
import { selectStyles } from "../select-styles.js";
import { MS_PER_DAY, mondayOf, today } from "../date-utils.js";

/** The 7 local dates Mon..Sun of the week starting at `monday`. */
function weekDays(monday: string): string[] {
  const base = Date.parse(`${monday}T00:00:00Z`);
  return Array.from({ length: 7 }, (_, i) =>
    new Date(base + i * MS_PER_DAY).toISOString().slice(0, 10),
  );
}
/** The local wall date of an instant + its offset (the roster-validation localDate convention). */
function localDate(instant: string, offsetMinutes: number): string {
  return new Date(Date.parse(instant) + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

/**
 * The management dashboard's ROSTER SCREEN (design §3d): a location picker + week picker over a
 * person × day grid, driving the `<dashboard-shift-dialog>` for add/edit/remove and a Publish button
 * that surfaces the advisory breach warnings. The single owner of the selected location + week, the
 * loaded locations/staff and the current roster snapshot; it injects the `DashboardApi`.
 *
 * ON CONNECT it loads locations + staff, picks the first location and loads that location's roster for
 * the current week (snapped to its Monday). A location or week change reloads. Authoring is only
 * offered while the week is EDITABLE — no roster yet, or a DRAFT; once a week is PUBLISHED the grid is
 * read-only (a note explains changes need a new draft — a later slice).
 *
 * The first add-shift on an un-rostered week lazily CREATES the draft version, then adds the shift with
 * the screen's selected `locationId` (the dialog does not know it). Publish returns the advisory
 * breaches (owner decision 2026-08-02: a breaching roster still publishes), rendered as a banner.
 *
 * ERROR HANDLING, every async path (mirroring `catalogue-screen.ts`): each loader/handler is fully
 * `try/catch`ed — a rejection becomes `errorKey` (from the thrown `{ code }`, falling back to
 * `server.internal`) in a `role="alert"` banner, never an unhandled rejection. A single-flight `busy`
 * gate (passed DOWN to the dialog) drops a double-fired mutation; `stopPropagation` on every child
 * event keeps the composed events inside this screen.
 */
@customElement("dashboard-roster-screen")
export class RosterScreen extends LitElement {
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
        gap: var(--wt-space-4);
        margin-bottom: var(--wt-space-4);
      }
      .picker {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
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

  /** The HTTP face of the dashboard. The app shell injects a real client; a test injects a stub. */
  @property({ attribute: false }) api!: DashboardApi;

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
  // Single-flight for the shift mutations + publish, passed DOWN to the dialog as `.busy`. Reactive
  // because the dialog renders off it; set synchronously at handler entry so a double-fired event
  // files at most one mutation.
  @state() private busy = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  /** Whether the current week is authorable — no roster yet, or a draft. A published week is read-only. */
  private get editable(): boolean {
    return this.snapshot.version === null || this.snapshot.version.status === "draft";
  }

  /** The id of the current DRAFT version, or null (no roster, or a published one). Publish targets it. */
  private get draftVersionId(): string | null {
    return this.snapshot.version?.status === "draft" ? this.snapshot.version.id : null;
  }

  /**
   * (Re)load locations + staff, then pick the first location and load its roster for the current week.
   * When the tenant has NO location the grid can't be authored — the location stays unset, the roster
   * stays empty and the no-location prompt renders. A rejection anywhere becomes the `errorKey` banner.
   */
  async #load(): Promise<void> {
    this.errorKey = null;
    this.breaches = [];
    try {
      const [locations, staff] = await Promise.all([this.api.getLocations(), this.api.listStaff()]);
      this.locations = locations;
      this.staff = staff;
      if (locations.length === 0) {
        this.locationId = "";
        this.snapshot = { version: null, shifts: [] };
        return;
      }
      if (!locations.some((l) => l.id === this.locationId)) {
        this.locationId = locations[0]!.id;
      }
      await this.#loadRoster();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Load the selected location + week's roster snapshot. Throws to its caller's catch. */
  async #loadRoster(): Promise<void> {
    this.snapshot = await this.api.getRoster(this.locationId, this.weekMonday);
  }

  /** The location picker changed. Native `change` is `composed:false`; `stopPropagation` is defensive
   * consistency with the composed handlers (the catalogue-screen pattern). Reload the roster. */
  async #onSelectLocation(event: Event): Promise<void> {
    event.stopPropagation();
    this.locationId = (event.target as HTMLSelectElement).value;
    this.errorKey = null;
    // The breaches belong to the roster we're leaving — clear them so a new location's grid never
    // shows the prior roster's advisory warnings (they reappear only on a fresh publish).
    this.breaches = [];
    try {
      await this.#loadRoster();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** The week picker changed. Snap the entered date to its Monday, then reload. */
  async #onSelectWeek(event: Event): Promise<void> {
    event.stopPropagation();
    const value = (event.target as HTMLInputElement).value;
    // A native <input type="date"> can be CLEARED (value ""); mondayOf("") builds an Invalid Date and
    // throws a RangeError on toISOString(). Ignore an empty or otherwise unparseable value — keep the
    // current week — rather than crashing the screen.
    if (Number.isNaN(Date.parse(`${value}T00:00:00Z`))) return;
    this.weekMonday = mondayOf(value);
    this.errorKey = null;
    // The breaches belong to the roster we're leaving — clear them so a new week's grid never shows
    // the prior roster's advisory warnings (they reappear only on a fresh publish).
    this.breaches = [];
    try {
      await this.#loadRoster();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /**
   * Open the dialog for a grid cell (person × day) targeting `shift` — an existing shift to edit/remove,
   * or null to author a NEW one. Only on an EDITABLE week; a published week's cells are inert.
   *
   * Split shifts (jornada partida) ARE authorable: `#renderCell` renders each existing shift as its own
   * edit button and an always-present add button, so the caller passes the exact target rather than this
   * method resolving one — a populated cell can both edit its shift(s) and add another.
   */
  openCell(personId: string, day: string, shift: Shift | null): void {
    if (!this.editable) return;
    this.errorKey = null;
    this.dialogPersonId = personId;
    this.dialogDay = day;
    this.dialogShift = shift;
    this.dialogOpen = true;
  }

  /**
   * Add a shift from the dialog's detail. The first add on an un-rostered week lazily CREATES the draft
   * version, then attaches the shift with the screen's selected `locationId` (the dialog omits it). On
   * rejection the dialog stays open with its values for a retry. Single-flight.
   */
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

  /** Edit a shift from the dialog's detail, then reload. Single-flight. */
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

  /** Remove a shift from the dialog's detail, then reload. Single-flight. */
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

  /** Publish the current draft, render its advisory breaches, then reload (the version flips to
   * published). A no-op when there is no draft. Single-flight. */
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
        <label class="picker"
          >${t("roster.location")}
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

  /**
   * One grid cell (person × day). On an EDITABLE week each existing shift is its own real `<button>`
   * (its visible time is its accessible name) and an always-present add button follows them — so a
   * populated cell can BOTH edit any of its shifts and author another (a split shift / jornada partida),
   * all keyboard-operable (Tab to focus, Enter/Space to activate) and announced to assistive tech, not
   * a mouse-only `<td>` click target (which axe did not flag). The add button carries the
   * `cell-<person>-<day>` test id; when the cell is EMPTY it has an `aria-label` (no visible text), and
   * when populated it shows visible "add another" text so its name and content never mismatch (axe). A
   * PUBLISHED week is read-only, so its cells render plain, non-interactive content (a bare `<td>`, no
   * handler).
   */
  #renderCell(personId: string, day: string): TemplateResult {
    const cellShifts = this.snapshot.shifts.filter(
      (s) => s.personId === personId && localDate(s.startsAt, s.startsOffsetMinutes) === day,
    );
    const testId = `cell-${personId}-${day}`;
    const label = (s: Shift): string => `${s.startsAt.slice(11, 16)}–${s.endsAt.slice(11, 16)}`;
    // A published week is read-only: plain, non-interactive spans, no handler.
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
