import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-card.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import type { BumpMode, Course, DashboardApi, FireControl, Station } from "../api/client.js";

/** A kitchen station the editor holds in local, editable state (a defensive copy of the loaded
 * {@link Station}). `isDefault` is read-only in a row — it is flipped by the make-default action
 * (`setDefaultStation`), never by a plain row save (which never touches `is_default`). */
interface EditableStation {
  id: string;
  name: string;
  displayOrder: number;
  isDefault: boolean;
}

/** A kitchen course the editor holds in local, editable state (a defensive copy of the loaded
 * {@link Course}). No `isDefault` — courses have no default concept (a null course fires earliest). */
interface EditableCourse {
  id: string;
  name: string;
  displayOrder: number;
}

/**
 * The management dashboard's COCINA (kitchen) config screen (KDS-1 §5b + KDS-2 §5c): configures the
 * venue's kitchen stations, kitchen COURSES, the whole-ticket bump mode and the KDS fire-control mode,
 * mirroring `floor-screen.ts`'s Zonas panel (its own CRUD/reload idiom, `@waitron/ui` primitives, `--wt-*`
 * tokens). On connect it loads `api.listStations()` + `api.listCourses()` into editable rows and
 * `api.getFireControl()` into the toggle. A station row edits its name + display order and Guardar-s it;
 * "Hacer predeterminada" adopts it as the venue's single default (the counter/pass fallback); a Cursos
 * row edits its name + display order (courses have no default — a null course fires earliest); the
 * "new" forms author a fresh station/course from just a name. Segmented controls set the per-venue
 * `bump_mode` (`line` / `ticket`) and `fire_control` (`waiter` = the tab fires courses / `kitchen` = the
 * station display fires them).
 *
 * Each mutation drives the PER-ITEM CRUD on the injected `api` and RELOADS the list afterwards (the
 * `floor-screen`/`service-status-screen` idiom): the config routes are per-item POST/PATCH/DELETE (plus
 * the station default POST), not a single bulk PUT, so create, save-row, make-default and deactivate each
 * hit one endpoint then call `#load` to resync. A row's save reads its CURRENT values from state at click
 * time, never a stale render closure.
 *
 * READ-BACK: the station list carries `isDefault` (shown truthfully) and `fire_control` HAS a read route
 * (`getFireControl`), so the fire-control toggle reflects the PERSISTED value. `bump_mode` still has no
 * read route (KDS-1), so that one segmented control starts on `line` (the column default) and reflects
 * the operator's own picks; the config reads also project no category's/product's routing station.
 *
 * Gating is server-side (`till.configure`): the shell hides this nav from a `staff` session and every
 * route re-checks. ERROR HANDLING mirrors the sibling screens — every loader/mutation is fully
 * `try/catch`ed (invoked via `void`), so a rejection becomes `errorKey` (the raw `{ code }`, falling
 * back to `server.internal`) rendered in a `role="alert"` banner. The raw code stays in state;
 * `codeMessage` maps it to localised copy at the render edge, so the banner shows a sentence and never
 * the raw wire code (`station.name_taken`, `station.not_found`).
 */
@customElement("dashboard-kitchen-screen")
export class KitchenScreen extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .title {
        margin: 0 0 var(--wt-space-4);
        font-size: var(--wt-font-size-lg);
        color: var(--wt-color-text);
      }
      .panel-title {
        margin: 0 0 var(--wt-space-3);
        font-size: var(--wt-font-size-md);
        color: var(--wt-color-text);
      }
      ol {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        gap: var(--wt-space-3);
      }
      .empty {
        color: var(--wt-color-text-muted);
      }
      .row {
        display: flex;
        gap: var(--wt-space-3);
        align-items: flex-end;
        flex-wrap: wrap;
      }
      .badge {
        color: var(--wt-color-text-muted);
        align-self: center;
      }
      .new {
        display: flex;
        gap: var(--wt-space-3);
        align-items: flex-end;
        margin-top: var(--wt-space-6);
        flex-wrap: wrap;
      }
      .bump {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
        margin-top: var(--wt-space-6);
        color: var(--wt-color-text);
      }
      .bump-options {
        display: flex;
        gap: var(--wt-space-2);
      }
      .error {
        color: var(--wt-color-danger);
        margin-top: var(--wt-space-3);
      }
    `,
  ];

  /** The HTTP face of the dashboard. The app shell injects a real client; a test injects a stub. */
  @property({ attribute: false }) api!: DashboardApi;

  // The configured stations as editable rows, loaded on connect and re-synced after every mutation.
  @state() private stations: EditableStation[] = [];
  // The new-station form's single field.
  @state() private newStation = "";
  // The configured courses as editable rows (KDS-2), loaded + re-synced exactly like the stations.
  @state() private courses: EditableCourse[] = [];
  // The new-course form's single field.
  @state() private newCourse = "";
  // The venue's whole-ticket bump mode. Write-only (no read route), so it starts on the column default
  // `line` and reflects the operator's own picks — see the class doc's read-back note.
  @state() private bumpMode: BumpMode = "line";
  // The venue's KDS fire-control mode (KDS-2). UNLIKE bump_mode this HAS a read route, so `#load` seeds
  // it from the persisted value; the toggle then reflects both the persisted setting and later picks.
  @state() private fireControl: FireControl = "waiter";
  @state() private errorKey: string | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  /** Load the configured stations + courses into editable rows and the persisted fire-control setting
   * into the toggle. A rejection anywhere becomes the `errorKey` banner rather than an unhandled
   * rejection. Used on connect and after every station/course mutation. */
  async #load(): Promise<void> {
    this.errorKey = null;
    try {
      const [stations, courses, fire] = await Promise.all([
        this.api.listStations(),
        this.api.listCourses(),
        this.api.getFireControl(),
      ]);
      this.stations = stations.map((s: Station) => ({
        id: s.id,
        name: s.name,
        displayOrder: s.displayOrder,
        isDefault: s.isDefault,
      }));
      this.courses = courses.map((c: Course) => ({
        id: c.id,
        name: c.name,
        displayOrder: c.displayOrder,
      }));
      this.fireControl = fire.mode;
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** The new-station field's composed `wt-change`. `stopPropagation` keeps it inside this screen. */
  #onNewStation(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.newStation = event.detail.value;
  }

  /** Create a station from the new-station form, then reload. A blank (whitespace-only) name is a no-op.
   * `displayOrder`/`isDefault` are left to defaults (a manager reorders / picks the default afterwards). */
  async #createStation(): Promise<void> {
    this.errorKey = null;
    const name = this.newStation.trim();
    if (name === "") return;
    try {
      await this.api.createStation({ name });
      this.newStation = "";
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Apply a partial edit to the station `id` holds, replacing it in state with a fresh object (so a
   * row's edits never mutate a shared reference the render still points at). */
  #editStation(id: string, patch: Partial<EditableStation>): void {
    this.stations = this.stations.map((s) => (s.id === id ? { ...s, ...patch } : s));
  }

  /** Persist the CURRENT name + display order of the station `id` holds, then reload. Reads the row from
   * state at click time (not a captured render closure). A vanished row is a no-op. */
  async #saveStation(id: string): Promise<void> {
    this.errorKey = null;
    const row = this.stations.find((s) => s.id === id);
    if (row === undefined) return;
    try {
      await this.api.updateStation(row.id, { name: row.name, displayOrder: row.displayOrder });
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Soft-delete (deactivate) the station `id` holds, then reload. */
  async #deactivateStation(id: string): Promise<void> {
    this.errorKey = null;
    try {
      await this.api.deactivateStation(id);
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Make the station `id` holds the venue's single default (the counter/pass fallback), then reload. */
  async #makeDefault(id: string): Promise<void> {
    this.errorKey = null;
    try {
      await this.api.setDefaultStation(id);
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Set the venue's whole-ticket bump mode, reflecting the pick locally. A no-op reselect of the
   * current mode still writes (idempotent server-side) — the control is a plain segmented picker. */
  async #setBump(mode: BumpMode): Promise<void> {
    this.errorKey = null;
    this.bumpMode = mode;
    try {
      await this.api.setBumpMode(mode);
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  // ── Kitchen courses (KDS-2) — mirror the station CRUD above, minus the default concept ──────────────

  /** The new-course field's composed `wt-change`. `stopPropagation` keeps it inside this screen. */
  #onNewCourse(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.newCourse = event.detail.value;
  }

  /** Create a course from the new-course form, then reload. A blank name is a no-op. `displayOrder` is
   * left to the default (a manager reorders afterwards); courses have no default concept. */
  async #createCourse(): Promise<void> {
    this.errorKey = null;
    const name = this.newCourse.trim();
    if (name === "") return;
    try {
      await this.api.createCourse({ name });
      this.newCourse = "";
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Apply a partial edit to the course `id` holds, replacing it in state with a fresh object (so a
   * row's edits never mutate a shared reference the render still points at). */
  #editCourse(id: string, patch: Partial<EditableCourse>): void {
    this.courses = this.courses.map((c) => (c.id === id ? { ...c, ...patch } : c));
  }

  /** Persist the CURRENT name + display order of the course `id` holds, then reload. Reads the row from
   * state at click time (not a captured render closure). A vanished row is a no-op. */
  async #saveCourse(id: string): Promise<void> {
    this.errorKey = null;
    const row = this.courses.find((c) => c.id === id);
    if (row === undefined) return;
    try {
      await this.api.updateCourse(row.id, { name: row.name, displayOrder: row.displayOrder });
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Soft-delete (deactivate) the course `id` holds, then reload. */
  async #deactivateCourse(id: string): Promise<void> {
    this.errorKey = null;
    try {
      await this.api.deactivateCourse(id);
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  /** Set the venue's KDS fire-control mode, reflecting the pick locally. A no-op reselect still writes
   * (idempotent server-side) — the control is a plain segmented picker, like the bump-mode one. */
  async #setFire(mode: FireControl): Promise<void> {
    this.errorKey = null;
    this.fireControl = mode;
    try {
      await this.api.setFireControl(mode);
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  #renderStation(s: EditableStation): TemplateResult {
    return html`<li data-test="station-row-${s.id}">
      <wt-card>
        <div class="row">
          <wt-input
            label=${t("kitchen.station_name")}
            data-test="station-name-${s.id}"
            .value=${s.name}
            @wt-change=${(e: CustomEvent<{ value: string }>) => {
              e.stopPropagation();
              this.#editStation(s.id, { name: e.detail.value });
            }}
          ></wt-input>
          <wt-input
            type="number"
            label=${t("kitchen.station_order")}
            data-test="station-order-${s.id}"
            .value=${String(s.displayOrder)}
            @wt-change=${(e: CustomEvent<{ value: string }>) => {
              e.stopPropagation();
              this.#editStation(s.id, { displayOrder: Number(e.detail.value) || 0 });
            }}
          ></wt-input>
          ${
            s.isDefault
              ? html`<span class="badge" data-test="station-badge-${s.id}"
                  >${t("kitchen.default_badge")}</span
                >`
              : html`<wt-button
                  variant="secondary"
                  size="sm"
                  data-test="station-default-${s.id}"
                  @click=${() => void this.#makeDefault(s.id)}
                  >${t("kitchen.make_default")}</wt-button
                >`
          }
          <wt-button
            variant="primary"
            size="sm"
            data-test="station-save-${s.id}"
            @click=${() => void this.#saveStation(s.id)}
            >${t("action.save")}</wt-button
          >
          <wt-button
            variant="danger"
            size="sm"
            data-test="station-deactivate-${s.id}"
            @click=${() => void this.#deactivateStation(s.id)}
            >${t("action.deactivate")}</wt-button
          >
        </div>
      </wt-card>
    </li>`;
  }

  #bumpOption(mode: BumpMode, label: string): TemplateResult {
    return html`<wt-button
      variant=${this.bumpMode === mode ? "primary" : "secondary"}
      size="sm"
      data-test="bump-${mode}"
      @click=${() => void this.#setBump(mode)}
      >${label}</wt-button
    >`;
  }

  /** A course row — the station row minus the default/make-default control (courses have no default). */
  #renderCourse(c: EditableCourse): TemplateResult {
    return html`<li data-test="course-row-${c.id}">
      <wt-card>
        <div class="row">
          <wt-input
            label=${t("kitchen.course_name")}
            data-test="course-name-${c.id}"
            .value=${c.name}
            @wt-change=${(e: CustomEvent<{ value: string }>) => {
              e.stopPropagation();
              this.#editCourse(c.id, { name: e.detail.value });
            }}
          ></wt-input>
          <wt-input
            type="number"
            label=${t("kitchen.course_order")}
            data-test="course-order-${c.id}"
            .value=${String(c.displayOrder)}
            @wt-change=${(e: CustomEvent<{ value: string }>) => {
              e.stopPropagation();
              this.#editCourse(c.id, { displayOrder: Number(e.detail.value) || 0 });
            }}
          ></wt-input>
          <wt-button
            variant="primary"
            size="sm"
            data-test="course-save-${c.id}"
            @click=${() => void this.#saveCourse(c.id)}
            >${t("action.save")}</wt-button
          >
          <wt-button
            variant="danger"
            size="sm"
            data-test="course-deactivate-${c.id}"
            @click=${() => void this.#deactivateCourse(c.id)}
            >${t("action.deactivate")}</wt-button
          >
        </div>
      </wt-card>
    </li>`;
  }

  #fireOption(mode: FireControl, label: string): TemplateResult {
    return html`<wt-button
      variant=${this.fireControl === mode ? "primary" : "secondary"}
      size="sm"
      data-test="fire-${mode}"
      @click=${() => void this.#setFire(mode)}
      >${label}</wt-button
    >`;
  }

  override render(): TemplateResult {
    return html`
      <h1 class="title">${t("kitchen.title")}</h1>
      <section data-test="stations-panel">
        <h2 class="panel-title">${t("kitchen.stations_title")}</h2>
        ${
          this.stations.length === 0
            ? html`<p class="empty">${t("kitchen.no_stations")}</p>`
            : html`<ol>
                ${this.stations.map((s) => this.#renderStation(s))}
              </ol>`
        }
        <div class="new">
          <wt-input
            label=${t("kitchen.new_station")}
            data-new-station
            .value=${this.newStation}
            @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onNewStation(e)}
          ></wt-input>
          <wt-button variant="primary" data-add-station @click=${() => void this.#createStation()}
            >${t("kitchen.add_station")}</wt-button
          >
        </div>
      </section>

      <section data-test="courses-panel">
        <h2 class="panel-title">${t("kitchen.courses_title")}</h2>
        ${
          this.courses.length === 0
            ? html`<p class="empty">${t("kitchen.no_courses")}</p>`
            : html`<ol>
                ${this.courses.map((c) => this.#renderCourse(c))}
              </ol>`
        }
        <div class="new">
          <wt-input
            label=${t("kitchen.new_course")}
            data-new-course
            .value=${this.newCourse}
            @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onNewCourse(e)}
          ></wt-input>
          <wt-button variant="primary" data-add-course @click=${() => void this.#createCourse()}
            >${t("kitchen.add_course")}</wt-button
          >
        </div>
      </section>

      <section class="bump" role="group" aria-label=${t("kitchen.bump_mode")}>
        <span class="panel-title">${t("kitchen.bump_mode")}</span>
        <div class="bump-options">
          ${this.#bumpOption("line", t("kitchen.bump_line"))}
          ${this.#bumpOption("ticket", t("kitchen.bump_ticket"))}
        </div>
      </section>

      <section class="bump" role="group" aria-label=${t("kitchen.fire_mode")}>
        <span class="panel-title">${t("kitchen.fire_mode")}</span>
        <div class="bump-options">
          ${this.#fireOption("waiter", t("kitchen.fire_waiter"))}
          ${this.#fireOption("kitchen", t("kitchen.fire_kitchen"))}
        </div>
      </section>

      ${this.errorKey ? html`<p class="error" role="alert">${codeMessage(this.errorKey)}</p>` : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-kitchen-screen": KitchenScreen;
  }
}
