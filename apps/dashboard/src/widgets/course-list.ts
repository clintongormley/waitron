import { ReorderController, baseStyles, reorder, type ReorderModel } from "@waitron/ui";
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-modal.js";
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

interface Deleting {
  course: Course;
  errorKey: string | null;
  busy: boolean;
}

function namesTheName(error: unknown): boolean {
  const field = (error as { params?: { field?: unknown } } | null)?.params?.field;
  return codeOf(error) === "course.name_taken" || field === "name";
}

/**
 * Every course of the venue: the active ones in firing order, then the disabled ones. Each change is
 * saved as it is made: a move, a rename, a removal, an Enable or a new course. Read-only, it lists
 * the active ones alone. Emits `course-added` with the new course's id.
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
      /* Not the shared baseline, which lines the grip and row menu up with the name button's LAST
         line once the name wraps. The name pads its first line to the centre of a tap target
         instead, where the top-aligned grip and menu have theirs. */
      tbody td {
        vertical-align: top;
      }
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
        padding: calc((var(--wt-tap-min) - 1lh) / 2) 0;
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
      .disabled-name {
        display: flex;
        flex-wrap: wrap;
        column-gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
        padding: calc((var(--wt-tap-min) - 1lh) / 2) 0;
        color: var(--wt-color-text-muted);
        overflow-wrap: anywhere;
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
  /** The active courses, in firing order: the only ones a move reorders. */
  @state() private courses: Course[] = [];
  @state() private disabled: Course[] = [];
  @state() private edit: Edit | null = null;
  @state() private errorKey: string | null = null;
  /** A Delete waiting for its confirmation; a refused one stays open with its refusal. */
  @state() private deleting: Deleting | null = null;
  /** Woken whenever `deleting` changes. */
  #deletingWaiters: (() => void)[] = [];
  /** Whether `errorKey` is a read's failure, the only message the reads' recovery may clear. */
  #readErrorShown = false;
  readonly #writes = new ListWriteQueue();
  /** Moves shown on screen but not yet answered: a list read meanwhile would put their rows back. */
  #movesOut = 0;
  /** A list read arrived while moves were out, so what it carried has not been shown yet. */
  #readDropped = false;
  #dragFrom: number | null = null;
  #watching: "listCourses" | "listCoursesWithDisabled" | null = null;

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

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#setDeleting(null);
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("readOnly") && this.readOnly) this.#setDeleting(null);
    if (changed.has("readOnly") && this.#watching !== null && this.#watching !== this.#read()) {
      this.#queries.release(this.#watching);
      void this.#load();
    }
  }

  /** A read-only list shows the active courses alone, so it asks for nothing more. */
  #read(): "listCourses" | "listCoursesWithDisabled" {
    return this.readOnly ? "listCourses" : "listCoursesWithDisabled";
  }

  /** Settles once no change is left unanswered and no Delete confirmation waits for an answer,
   *  counting those made while it waits. */
  async settled(): Promise<void> {
    for (;;) {
      await this.#writes.idle;
      const open = this.deleting;
      if (open === null || open.errorKey !== null) return;
      await new Promise<void>((resolve) => this.#deletingWaiters.push(resolve));
    }
  }

  /** Whether a name field or a Delete confirmation is open: not yet answered, or refused. */
  get unsaved(): boolean {
    return this.edit !== null || this.deleting !== null;
  }

  async #load(): Promise<void> {
    // A watch started after the host disconnected is never released.
    if (!this.isConnected) return;
    // A failed read is reported through the query controller's error callback.
    this.#watching = this.#read();
    await this.#queries
      .watch(this.#watching, [], (rows) => this.#show(rows))
      .catch(() => undefined);
  }

  #showError(code: string | null, fromRead = false): void {
    this.errorKey = code;
    this.#readErrorShown = fromRead;
  }

  /** A read's failure never replaces an action's message. */
  #showReadError(error: unknown): void {
    if (this.errorKey === null || this.#readErrorShown) this.#showError(codeOf(error), true);
  }

  /** A move answers with the active courses alone, so it leaves the disabled ones as they are. */
  #show(rows: Course[], withDisabled = true): void {
    this.#readDropped = this.#movesOut > 0;
    if (this.#readDropped) return;
    this.courses = rows.filter((course) => course.active);
    if (withDisabled) this.disabled = rows.filter((course) => !course.active);
    const edit = this.edit;
    if (edit !== null && edit.id !== NEW && !this.courses.some((course) => course.id === edit.id))
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
        // An earlier answer would pull rows back under a keyboard that has moved on, and a read
        // dropped meanwhile carried disabled courses a move's answer does not.
        if (last && !this.#readDropped) this.#show(courses, false);
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

  // ── Removal and Enable ─────────────────────────────────────────────────────────────────────────

  #setDeleting(next: Deleting | null): void {
    this.deleting = next;
    const waiters = this.#deletingWaiters;
    this.#deletingWaiters = [];
    for (const wake of waiters) wake();
  }

  /** A Delete asks first. A Disable only ever disables, even if nothing names the course by now. */
  #remove(course: Course): void {
    if (!course.inUse) {
      this.#setDeleting({ course, errorKey: null, busy: false });
      return;
    }
    this.#change(
      () => this.api.removeCourse(course.id, { disable: true }),
      this.#neighbour(course),
    );
  }

  /** The server disables rather than deletes a course something has come to name since the read. */
  #confirmDelete(): void {
    const target = this.deleting;
    if (target === null || target.busy || this.readOnly) return;
    const sending = { ...target, errorKey: null, busy: true };
    this.#setDeleting(sending);
    this.#change(
      () => this.api.removeCourse(target.course.id, { disable: false }),
      this.#neighbour(target.course),
      {
        refused: (error) => {
          if (this.deleting === sending)
            this.#setDeleting({ ...target, errorKey: codeOf(error), busy: false });
          else this.#showError(codeOf(error));
        },
        sent: () => {
          if (this.deleting === sending) this.#setDeleting(null);
        },
      },
    );
  }

  #neighbour(course: Course): string | undefined {
    const rows = course.active ? this.courses : this.disabled;
    const at = rows.indexOf(course);
    return (rows[at + 1] ?? rows[at - 1])?.id;
  }

  #enable(course: Course): void {
    this.#change(() => this.api.enableCourse(course.id), course.id);
  }

  /** Sends one row's change, then puts focus on the row `focusId` names if it is still listed. */
  #change(
    send: () => Promise<void>,
    focusId: string | undefined,
    report: { refused?: (error: unknown) => void; sent?: () => void } = {},
  ): void {
    this.#showError(null);
    this.#writes.run(SCOPE, async () => {
      try {
        await send();
      } catch (error) {
        if (report.refused) report.refused(error);
        else this.#showError(codeOf(error));
        return;
      }
      report.sent?.();
      await this.#load();
      if (this.courses.some((row) => row.id === focusId)) await this.#focusName(focusId!);
      else if (this.disabled.some((row) => row.id === focusId))
        await this.#focus(`tr[data-course="${focusId}"] wt-row-actions`);
      else await this.#focusName(NEW);
    });
  }

  #action(course: Course, kind: "remove" | "enable", label: string): TemplateResult {
    return html`<wt-button
      align="start"
      variant="ghost"
      data-test=${`${kind}-${course.id}`}
      @click=${(event: Event) => {
        event.stopPropagation();
        if (kind === "remove") this.#remove(course);
        else this.#enable(course);
      }}
      >${label}</wt-button
    >`;
  }

  #actions(course: Course): TemplateResult {
    // A row from the read-only read does not say whether it is in use, so it offers neither.
    const remove =
      course.inUse === undefined
        ? nothing
        : course.inUse
          ? course.active
            ? this.#action(course, "remove", t("action.disable"))
            : nothing
          : this.#action(course, "remove", t("action.delete"));
    return html`<td class="actions-cell">
      <wt-row-actions align="end" label=${`${t("kitchen.course_actions")}: ${course.name}`}
        >${course.active ? nothing : this.#action(course, "enable", t("action.enable"))}${remove}</wt-row-actions
      >
    </td>`;
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
      ${this.#actions(course)}
    </tr>`;
  }

  #disabledRow(course: Course): TemplateResult {
    return html`<tr data-course=${course.id}>
      <td class="handle-cell"></td>
      <td>
        <div class="disabled-name">
          <span data-test=${`disabled-name-${course.id}`}>${course.name}</span>
          <span data-test=${`status-${course.id}`}>${t("status.disabled")}</span>
        </div>
      </td>
      ${this.#actions(course)}
    </tr>`;
  }

  #deleteDialog(): TemplateResult | typeof nothing {
    const target = this.deleting;
    if (target === null) return nothing;
    return html`<wt-modal
      open
      size="compact"
      data-test="delete-course-modal"
      heading=${t("kitchen.delete_course")}
      .dismissible=${!target.busy}
      @wt-close=${(event: Event) => {
        // Kept from the window this list may sit in, which would close too.
        event.stopPropagation();
        this.#setDeleting(null);
      }}
    >
      <p>${t("kitchen.delete_course_confirm").replace("{name}", target.course.name)}</p>
      <wt-form-actions
        slot="footer"
        .error=${target.errorKey === null ? "" : codeMessage(target.errorKey)}
        ><wt-button
          slot="cancel"
          variant="secondary"
          ?disabled=${target.busy}
          @click=${() => this.#setDeleting(null)}
          >${t("action.cancel")}</wt-button
        ><wt-button
          data-test="confirm-delete-course"
          variant="danger"
          ?disabled=${target.busy}
          @click=${() => this.#confirmDelete()}
          >${t("action.delete")}</wt-button
        ></wt-form-actions
      >
    </wt-modal>`;
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
          )}${repeat(
            this.disabled,
            (course) => course.id,
            (course) => this.#disabledRow(course),
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
      this.courses.length === 0 && this.disabled.length === 0 && adding === null
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
    }
    ${this.#deleteDialog()}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-course-list": CourseList;
  }
}
