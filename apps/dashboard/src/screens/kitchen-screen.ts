import { DraftRows } from "@waitron/dashboard-kit";
import { DashboardQueries } from "../api/query-controller.js";
import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { submitOnEnter, baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-card.js";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import type { BumpMode, Course, DashboardApi, FireControl } from "../api/client.js";

interface EditableCourse {
  id: string;
  name: string;
  displayOrder: number;
}

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

  @property({ attribute: false }) api!: DashboardApi;
  readonly #coursesDrafts = new DraftRows<EditableCourse>();
  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => {
      this.errorKey = codeOf(error);
    },
  );

  @state() private submitting = false;
  @state() private courses: EditableCourse[] = [];
  @state() private newCourse = "";
  // There is no route to read the bump mode back, so the control starts on the column default.
  @state() private bumpMode: BumpMode = "line";
  @state() private fireControl: FireControl = "waiter";
  @state() private errorKey: string | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  async #load(): Promise<void> {
    this.errorKey = null;
    try {
      await Promise.all([
        this.#queries.watch("listCourses", [], (rows) => {
          this.courses = this.#coursesDrafts.merge(
            this.courses,
            rows.map((c: Course) => ({ id: c.id, name: c.name, displayOrder: c.displayOrder })),
          );
        }),
        this.#queries.watch("getFireControl", [], (fire) => {
          this.fireControl = fire.mode;
        }),
      ]);
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  async #setBump(mode: BumpMode): Promise<void> {
    this.errorKey = null;
    this.bumpMode = mode;
    try {
      await this.api.setBumpMode(mode);
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  // ── Kitchen courses ──────────────────────────────────────────────────────────────────────────────────

  #onNewCourse(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.newCourse = event.detail.value;
  }

  async #createCourse(): Promise<void> {
    if (this.submitting) return;
    this.errorKey = null;
    const name = this.newCourse.trim();
    if (name === "") return;
    this.submitting = true;
    try {
      await this.api.createCourse({ name });
      this.newCourse = "";
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.submitting = false;
    }
  }

  #editCourse(id: string, patch: Partial<EditableCourse>): void {
    this.courses = this.courses.map((c) => (c.id === id ? { ...c, ...patch } : c));
  }

  async #saveCourse(id: string): Promise<void> {
    if (this.submitting) return;
    this.errorKey = null;
    const row = this.courses.find((c) => c.id === id);
    if (row === undefined) return;
    this.submitting = true;
    try {
      await this.api.updateCourse(row.id, { name: row.name, displayOrder: row.displayOrder });
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.submitting = false;
    }
  }

  async #deactivateCourse(id: string): Promise<void> {
    this.errorKey = null;
    try {
      await this.api.deactivateCourse(id);
      await this.#load();
    } catch (error) {
      this.errorKey = codeOf(error);
    }
  }

  async #setFire(mode: FireControl): Promise<void> {
    this.errorKey = null;
    this.fireControl = mode;
    try {
      await this.api.setFireControl(mode);
    } catch (error) {
      this.errorKey = codeOf(error);
    }
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

  #renderCourse(c: EditableCourse): TemplateResult {
    return html`<li data-test="course-row-${c.id}">
      <wt-card>
        <div class="row">
          <wt-input
            @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>(`[data-test="course-save-${c.id}"]`))}
            label=${t("kitchen.course_name")}
            data-test="course-name-${c.id}"
            .value=${c.name}
            @wt-change=${(e: CustomEvent<{ value: string }>) => {
              e.stopPropagation();
              this.#editCourse(c.id, { name: e.detail.value });
            }}
          ></wt-input>
          <wt-input
            @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>(`[data-test="course-save-${c.id}"]`))}
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
            ?disabled=${this.submitting}
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
      <p><a href="/manage/prep-stations">${t("kitchen.prep_stations_link")}</a></p>

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
            @keydown=${(e: KeyboardEvent) => submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-add-course]"))}
            label=${t("kitchen.new_course")}
            data-new-course
            .value=${this.newCourse}
            @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onNewCourse(e)}
          ></wt-input>
          <wt-button
            variant="primary"
            data-add-course
            ?disabled=${this.submitting}
            @click=${() => void this.#createCourse()}
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
          ${this.#fireOption("expo", t("kitchen.fire_expo"))}
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
