import { LitElement, css, html, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { live } from "lit/directives/live.js";
import {
  baseStyles,
  draftScopeFor,
  FormFeedback,
  saveActionState,
  submitOnEnter,
  type DraftScope,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import type { DashboardApi, SetMenuDetails, SetMenuLine } from "../api/client.js";
import { codeMessage, codeOf, fieldOf } from "../i18n/codes.js";
import { fill, t } from "../i18n/t.js";
import { sameValue } from "./product-editor-model.js";

type DraftLine = Omit<SetMenuLine, "count"> & { count: string };
const draftLine = (line: SetMenuLine): DraftLine => ({ ...line, count: String(line.count) });
const amountField = (id: string) => `count-${id}`;
const coursesField = (id: string) => `courses-${id}`;

@customElement("dashboard-set-menu-lines-form")
export class SetMenuLinesForm extends LitElement {
  static override styles = [
    baseStyles,
    css`
      form {
        --wt-form-actions-in-place: true;
        display: grid;
        gap: var(--wt-space-3);
      }
      fieldset {
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        margin: 0;
        min-width: 0;
        padding: var(--wt-space-3);
      }
      .line {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
      }
      wt-input {
        inline-size: var(--wt-stepper-field-width);
      }
      wt-combobox {
        min-inline-size: min(100%, var(--wt-row-field-min-width));
      }
      .remove {
        margin-inline-start: auto;
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @property() menuId = "";
  @property({ attribute: false }) lines: SetMenuLine[] = [];
  @property({ attribute: false }) courses: SetMenuDetails["courses"] = [];
  @state() private draft: DraftLine[] = [];
  @state() private saving = false;
  @state() private refusal = "";
  readonly #feedback = new FormFeedback(this);
  #scope?: DraftScope<DraftLine[]>;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#scope = draftScopeFor<DraftLine[]>(this, {
      id: this,
      current: () => this.draft,
      snapshot: (value) => structuredClone(value),
      equal: (a, b) => sameValue(this.#body(a), this.#body(b)),
      restore: (value) => {
        this.draft = value;
        this.refusal = "";
        this.#feedback.reset();
      },
    }).scope;
  }

  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    super.disconnectedCallback();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("lines") && !this.#scope?.isDirty()) this.#adopt(this.lines);
  }

  applyDishLineChanges(saved: SetMenuLine[], added: SetMenuLine[], removed: SetMenuLine[]): void {
    if (!this.#scope?.isDirty() || (!added.length && !removed.length)) return;
    // Save replaces the whole list. Keep automatic line changes in both the draft and its baseline.
    const removedIds = new Set(removed.map(({ id }) => id));
    this.draft = [...this.draft.filter(({ id }) => !removedIds.has(id)), ...added.map(draftLine)];
    this.#scope.commit(saved.map(draftLine));
  }

  #adopt(lines: SetMenuLine[]): void {
    this.draft = lines.map(draftLine);
    this.#scope?.commit(this.draft);
    this.#feedback.reset();
  }

  #body(lines: DraftLine[]) {
    return lines.map(({ count, courseIds }) => ({ count: Number(count), courseIds }));
  }

  #change(draft: DraftLine[]): void {
    this.draft = draft;
    this.#scope?.changed();
    this.refusal = "";
  }

  #edit(id: string, patch: Partial<DraftLine>): void {
    this.#change(this.draft.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  }

  #validate(): Record<string, string> {
    const errors: Record<string, string> = {};
    for (const { id, count, courseIds } of this.draft) {
      const amount = Number(count);
      if (!Number.isInteger(amount) || amount < 1 || amount > 99)
        errors[amountField(id)] = codeMessage("set_menu.invalid", undefined, { field: "count" });
      if (courseIds.length === 0)
        errors[coursesField(id)] = codeMessage("set_menu.invalid", undefined, {
          field: "courseIds",
        });
    }
    return errors;
  }

  async #save(): Promise<void> {
    if (this.saving || saveActionState(this.#scope).unchanged) return;
    this.#feedback.press();
    if (Object.keys(this.#validate()).length) {
      void this.#feedback.focus(this.shadowRoot!);
      return;
    }
    this.refusal = "";
    this.saving = true;
    try {
      const { lines } = await this.api.saveSetMenuLines(this.menuId, this.#body(this.draft));
      this.#adopt(lines);
      this.dispatchEvent(
        new CustomEvent("set-menu-lines-saved", { bubbles: true, composed: true }),
      );
    } catch (error) {
      this.refusal = codeMessage(codeOf(error), undefined, { field: fieldOf(error) });
    } finally {
      this.saving = false;
    }
  }

  #line({ id, count, courseIds }: DraftLine, index: number, errors: Record<string, string>) {
    const choices = this.courses.filter((course) => !courseIds.includes(course.id));
    const names = this.courses.filter((course) => courseIds.includes(course.id));
    const label = fill("menus.set_menu_line_number", { number: String(index + 1) });
    return html`<fieldset>
      <legend>${label}</legend>
      <div class="line">
        <wt-input
          name="count"
          type="number"
          label=${t("menus.set_menu_count")}
          hide-label
          required
          .value=${count}
          .error=${errors[amountField(id)] ?? ""}
          .disabled=${this.saving}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.#edit(id, { count: event.detail.value });
          }}
        ></wt-input>
        <span aria-hidden="true">×</span>
        ${names.map(
          ({ id: courseId, name }, i) => html`
            ${i === 0 ? "" : html`<span>${t("menus.set_menu_or")}</span>`}
            <wt-button
              variant="secondary"
              .disabled=${this.saving}
              aria-label=${fill("menus.set_menu_remove_course", { name })}
              @click=${() => this.#edit(id, { courseIds: courseIds.filter((key) => key !== courseId) })}
              >${name} <span aria-hidden="true">×</span></wt-button
            >
          `,
        )}
        <wt-combobox
          name="course"
          label=${names.length ? t("menus.set_menu_or_course") : t("menus.set_menu_choose_course")}
          .options=${choices.map(({ id, name }) => ({ value: id, label: name }))}
          .value=${live("")}
          .error=${errors[coursesField(id)] ?? ""}
          .disabled=${this.saving || !choices.length}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            const next = event.detail.value;
            this.#edit(id, {
              courseIds: this.courses
                .filter(({ id }) => id === next || courseIds.includes(id))
                .map(({ id }) => id),
            });
          }}
        ></wt-combobox>
        <wt-button
          class="remove"
          variant="secondary"
          .disabled=${this.saving}
          aria-label=${fill("menus.set_menu_remove_line_named", { line: label })}
          @click=${() => this.#change(this.draft.filter((line) => line.id !== id))}
          >${t("menus.set_menu_remove_line")}</wt-button
        >
      </div>
    </fieldset>`;
  }

  override render() {
    const errors = this.#feedback.attempted ? this.#validate() : {};
    const invalid = Object.keys(errors).length > 0;
    const action = saveActionState(this.#scope);
    const message = this.#feedback.message(
      { ...errors, refusal: this.refusal },
      new Set(Object.keys(errors)),
      t("form.fix_fields"),
    );
    return html`<form
      novalidate
      @submit=${(event: Event) => {
        event.preventDefault();
        void this.#save();
      }}
      @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector('[data-test="save"]'))}
    >
      ${repeat(
        this.draft,
        ({ id }) => id,
        (line, index) => this.#line(line, index, errors),
      )}
      <div>
        <wt-button
          variant="secondary"
          .disabled=${this.saving || !this.courses.length}
          @click=${() => this.#change([...this.draft, { id: crypto.randomUUID(), count: "1", courseIds: [] }])}
          >${t("menus.set_menu_add_line")}</wt-button
        >
      </div>
      <wt-form-actions .error=${message}>
        <wt-button
          data-test="save"
          variant=${action.variant}
          .disabled=${action.unchanged || this.saving || invalid}
          .loading=${this.saving}
          @click=${() => void this.#save()}
          >${t("action.save")}</wt-button
        >
      </wt-form-actions>
    </form>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-set-menu-lines-form": SetMenuLinesForm;
  }
}
