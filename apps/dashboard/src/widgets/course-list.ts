import { ReorderController, baseStyles, reorder, type ReorderModel } from "@waitron/ui";
import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import { DashboardQueries } from "../api/query-controller.js";
import type { Course, DashboardApi } from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import { ListWriteQueue } from "./section-writes.js";

const NEW = "new";
const SCOPE = "courses";

/** A name being typed: a course's rename, or the new row's (`id` is `NEW`). Only one is shown;
 * one replaced while its field still had focus is committed when that field loses it. */
interface Edit {
  id: string;
  name: string;
  error: string;
  saving: boolean;
  /** Saved, abandoned or dropped: losing focus must not commit it. */
  done: boolean;
}

function namesTheName(error: unknown): boolean {
  const field = (error as { params?: { field?: unknown } } | null)?.params?.field;
  return codeOf(error) === "course.name_taken" || field === "name";
}

/**
 * Every active course of the venue, in firing order. Each change is saved as it is made: a move,
 * a rename, a removal or a new course. Emits `course-added` with the new course's id.
 */
@customElement("dashboard-course-list")
export class CourseList extends LitElement {
  static override styles = [
    baseStyles,
    ReorderController.styles,
    ReorderController.tableStyles,
    css`
      :host {
        display: block;
      }
      thead th {
        padding: 0;
        border: 0;
      }
      tbody td,
      tfoot td {
        vertical-align: middle;
      }
      td.handle-cell,
      td.actions-cell {
        width: 1%;
        padding-inline: 0;
        white-space: nowrap;
      }
      td.actions-cell {
        text-align: end;
      }
      .open-name {
        width: 100%;
        min-height: var(--wt-tap-min);
        padding: 0;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: start;
        overflow-wrap: anywhere;
        cursor: pointer;
      }
      .open-name:hover {
        opacity: var(--wt-opacity-hover);
      }
      .empty {
        margin: 0;
        color: var(--wt-color-text-muted);
      }
      .error {
        margin: var(--wt-space-2) 0 0;
        color: var(--wt-color-danger);
      }
      .add {
        margin-top: var(--wt-space-3);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) readOnly = false;
  @state() private courses: Course[] = [];
  @state() private edit: Edit | null = null;
  @state() private errorKey: string | null = null;
  /** Whether `errorKey` is a read's failure, the only message the reads' recovery may clear. */
  #readErrorShown = false;
  readonly #writes = new ListWriteQueue();
  /** Moves shown on screen but not yet answered: a list read meanwhile would put their rows back. */
  #movesOut = 0;
  /** A list read arrived while moves were out, so what it carried has not been shown yet. */
  #readDropped = false;
  #dragFrom: number | null = null;

  readonly #queries = new DashboardQueries(
    this,
    () => this.api,
    (error) => this.#showReadError(error),
    () => {
      if (this.#readErrorShown) this.#showError(null);
    },
  );

  readonly #reorder = new ReorderController(
    this,
    {
      order: () => this.courses.map((course) => course.id),
      move: (id, to, via) => this.#move(id, to, via),
      drop: (id) => this.#drop(id),
      label: (id) => this.courses.find((course) => course.id === id)!.name,
      // Never busy: that would disable the grip a keyboard user is on and drop their focus.
      busy: () => false,
      get reorderLabel(): string {
        return t("kitchen.reorder_course");
      },
    } satisfies ReorderModel,
    { announce: () => t("action.reordered") },
  );

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  /** Settles once no change is left unanswered, counting those made while it waits. */
  async settled(): Promise<void> {
    await this.#writes.idle;
  }

  /** Whether a name field is open: not yet left, or refused. */
  get unsaved(): boolean {
    return this.edit !== null;
  }

  async #load(): Promise<void> {
    // A watch started after the host disconnected is never released.
    if (!this.isConnected) return;
    // A failed read is reported through the query controller's error callback.
    await this.#queries.watch("listCourses", [], (rows) => this.#show(rows)).catch(() => undefined);
  }

  #showError(code: string | null, fromRead = false): void {
    this.errorKey = code;
    this.#readErrorShown = fromRead;
  }

  /** A read's failure never replaces an action's message. */
  #showReadError(error: unknown): void {
    if (this.errorKey === null || this.#readErrorShown) this.#showError(codeOf(error), true);
  }

  #show(rows: Course[]): void {
    this.#readDropped = this.#movesOut > 0;
    if (this.#readDropped) return;
    this.courses = rows;
    const edit = this.edit;
    if (edit !== null && edit.id !== NEW && !rows.some((course) => course.id === edit.id))
      this.#close(edit, false);
  }

  async #focus(selector: string): Promise<void> {
    await this.updateComplete;
    const target = this.shadowRoot!.querySelector<
      HTMLElement & { updateComplete?: Promise<unknown> }
    >(selector);
    await target?.updateComplete;
    target?.focus();
  }

  #focusName(id: string): Promise<void> {
    return this.#focus(id === NEW ? '[data-test="add-course"]' : `[data-test="name-${id}"]`);
  }

  // ── Moves ──────────────────────────────────────────────────────────────────────────────────────

  #move(id: string, to: number, via: "key" | "pointer"): void {
    const from = this.courses.findIndex((course) => course.id === id);
    this.courses = reorder(this.courses, from, to);
    if (via === "key") this.#saveMove(id, to);
    else this.#dragFrom ??= from;
  }

  #drop(id: string): void {
    const from = this.#dragFrom;
    this.#dragFrom = null;
    const to = this.courses.findIndex((course) => course.id === id);
    if (from !== null && to >= 0 && to !== from) this.#saveMove(id, to);
  }

  #saveMove(id: string, to: number): void {
    this.#showError(null);
    this.#movesOut += 1;
    this.#writes.move(
      SCOPE,
      () => this.api.moveCourse(id, to),
      async (courses, last) => {
        this.#movesOut -= 1;
        // An earlier answer would pull rows back under a keyboard that has moved on.
        if (last) this.#show(courses);
        else if (this.#movesOut === 0 && this.#readDropped) await this.#load();
      },
      async (error) => {
        // The queue drops, unsent, every move still waiting behind a refused one.
        this.#movesOut = 0;
        this.#showError(codeOf(error));
        await this.#load();
      },
    );
  }

  // ── Names ──────────────────────────────────────────────────────────────────────────────────────

  async #open(id: string, name: string): Promise<void> {
    this.edit = { id, name, error: "", saving: false, done: false };
    await this.#focus('wt-input[name="course-name"]');
  }

  /** Reads `edit` when clicked: leaving a blank new row to press this has already dropped it. */
  #add(): Promise<void> {
    if (this.edit?.id === NEW) return this.#focus('wt-input[name="course-name"]');
    return this.#open(NEW, "");
  }

  #nextOrder(): number {
    return Math.max(-1, ...this.courses.map((course) => course.displayOrder)) + 1;
  }

  #mark(edit: Edit, error: string): void {
    edit.error = error;
    this.requestUpdate();
  }

  #close(edit: Edit, refocus: boolean): void {
    edit.done = true;
    if (this.edit !== edit) return;
    this.edit = null;
    if (refocus) void this.#focusName(edit.id);
  }

  #commit(edit: Edit, via: "enter" | "leave"): void {
    if (edit.done || edit.saving) return;
    const name = edit.name.trim();
    if (name === "") {
      if (edit.id === NEW && via === "leave") this.#close(edit, false);
      else this.#mark(edit, t("kitchen.course_name_required"));
      return;
    }
    if (edit.id !== NEW && name === this.courses.find((course) => course.id === edit.id)?.name) {
      this.#close(edit, via === "enter");
      return;
    }
    edit.saving = true;
    this.#showError(null);
    this.requestUpdate();
    this.#writes.run(SCOPE, async () => {
      let added: string | null = null;
      try {
        if (edit.id === NEW)
          ({ id: added } = await this.api.createCourse({ name, displayOrder: this.#nextOrder() }));
        else await this.api.updateCourse(edit.id, { name });
      } catch (error) {
        edit.saving = false;
        this.requestUpdate();
        if (this.edit === edit && namesTheName(error)) this.#mark(edit, codeMessage(codeOf(error)));
        else this.#showError(codeOf(error));
        return;
      }
      if (added !== null)
        this.dispatchEvent(
          new CustomEvent("course-added", { detail: { id: added }, bubbles: true, composed: true }),
        );
      this.#close(edit, via === "enter");
      await this.#load();
    });
  }

  #onKeydown(event: KeyboardEvent, edit: Edit): void {
    if (event.key !== "Enter" && event.key !== "Escape") return;
    // Kept from a surrounding dialog, which would close on Escape or act on Enter.
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Enter") this.#commit(edit, "enter");
    else this.#close(edit, true);
  }

  #nameField(edit: Edit, label: string): TemplateResult {
    return html`<wt-input
      name="course-name"
      label=${label}
      hide-label
      required
      ?readonly=${edit.saving}
      .value=${edit.name}
      error=${edit.error}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        edit.name = event.detail.value;
        this.#mark(edit, "");
      }}
      @keydown=${(event: KeyboardEvent) => this.#onKeydown(event, edit)}
      @focusout=${() => this.#commit(edit, "leave")}
    ></wt-input>`;
  }

  // ── Removal ────────────────────────────────────────────────────────────────────────────────────

  #remove(course: Course): void {
    this.#showError(null);
    const at = this.courses.indexOf(course);
    const neighbour = this.courses[at + 1] ?? this.courses[at - 1];
    this.#writes.run(SCOPE, async () => {
      try {
        await this.api.deactivateCourse(course.id);
      } catch (error) {
        this.#showError(codeOf(error));
        return;
      }
      await this.#load();
      const next = this.courses.find((row) => row.id === neighbour?.id);
      await this.#focusName(next?.id ?? NEW);
    });
  }

  // ── Rendering ──────────────────────────────────────────────────────────────────────────────────

  #row(course: Course): TemplateResult {
    const edit = this.edit?.id === course.id ? this.edit : null;
    return html`<tr data-course=${course.id}>
      <td class="handle-cell">${this.#reorder.handle(course.id)}</td>
      <td>
        ${
          edit
            ? this.#nameField(edit, t("kitchen.course_name"))
            : html`<button
                type="button"
                class="open-name"
                data-test=${`name-${course.id}`}
                aria-label=${`${t("kitchen.rename_course")}: ${course.name}`}
                @click=${() => void this.#open(course.id, course.name)}
              >
                ${course.name}
              </button>`
        }
      </td>
      <td class="actions-cell">
        <wt-row-actions align="end" label=${`${t("kitchen.course_actions")}: ${course.name}`}
          ><wt-button
            align="start"
            variant="ghost"
            data-test=${`remove-${course.id}`}
            @click=${(event: Event) => {
              event.stopPropagation();
              this.#remove(course);
            }}
            >${t("action.remove")}</wt-button
          ></wt-row-actions
        >
      </td>
    </tr>`;
  }

  #table(adding: Edit | null): TemplateResult {
    if (this.readOnly)
      return html`<ul>
        ${this.courses.map((course) => html`<li data-course=${course.id}>${course.name}</li>`)}
      </ul>`;
    return html`<div
      class="table-wrap"
      tabindex="0"
      role="region"
      aria-label=${t("kitchen.courses_title")}
    >
      <table>
        <thead>
          <tr>
            <th scope="col"><span class="visually-hidden">${t("kitchen.reorder_course")}</span></th>
            <th scope="col"><span class="visually-hidden">${t("kitchen.course_name")}</span></th>
            <th scope="col"><span class="visually-hidden">${t("kitchen.course_actions")}</span></th>
          </tr>
        </thead>
        <tbody>
          ${repeat(
            this.courses,
            (course) => course.id,
            (course) => this.#row(course),
          )}
        </tbody>
        ${
          adding
            ? html`<tfoot>
                <tr data-course=${NEW}>
                  <td class="handle-cell"></td>
                  <td>${this.#nameField(adding, t("kitchen.new_course"))}</td>
                  <td class="actions-cell"></td>
                </tr>
              </tfoot>`
            : nothing
        }
      </table>
    </div>`;
  }

  override render(): TemplateResult {
    const adding = this.edit?.id === NEW ? this.edit : null;
    return html`${this.readOnly ? nothing : this.#reorder.liveRegion()}
    ${
      this.courses.length === 0 && adding === null
        ? html`<p class="empty" data-test="empty">${t("kitchen.no_courses")}</p>`
        : this.#table(adding)
    }
    ${
      this.errorKey
        ? html`<p class="error" role="alert">${codeMessage(this.errorKey)}</p>`
        : nothing
    }
    ${
      this.readOnly
        ? nothing
        : html`<div class="add">
            <wt-button variant="secondary" data-test="add-course" @click=${() => void this.#add()}
              >${t("kitchen.add_course")}</wt-button
            >
          </div>`
    }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-course-list": CourseList;
  }
}
