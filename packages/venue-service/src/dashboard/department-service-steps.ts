import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { ReorderController, baseStyles, reorder, type ReorderModel } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import type { ServiceStepStart } from "../schema/service-steps.js";
import { MAX_SERVICE_STEPS } from "../service-step-limits.js";
import type { ServiceStepDraft } from "./service-step-draft.js";
import { format } from "./hours-view.js";
import { t } from "./strings.js";

export type ServiceStepField = "name" | "start" | "minutes";
export type ServiceStepErrors = Record<string, Partial<Record<ServiceStepField, string>>>;

const COURSE = "course_served:";

const startValue = (step: ServiceStepDraft) =>
  step.start === "course_served" ? `${COURSE}${step.courseId}` : step.start;

@customElement("department-service-steps")
export class DepartmentServiceSteps extends LitElement {
  static override styles = [
    baseStyles,
    ReorderController.styles,
    ReorderController.tableStyles,
    css`
      :host {
        display: grid;
        gap: var(--wt-space-3);
        min-width: 0;
      }
      h4,
      p {
        margin: 0;
        overflow-wrap: anywhere;
      }
      h4 {
        font-size: var(--wt-font-size-md);
      }
      thead th {
        font-weight: var(--wt-font-weight-medium);
        color: var(--wt-color-text-muted);
      }
      tbody td {
        vertical-align: top;
      }
      td.handle-cell,
      td.actions-cell,
      th.handle-cell,
      th.actions-cell {
        width: 1%;
        padding-inline: 0;
        white-space: nowrap;
      }
      td.actions-cell {
        text-align: end;
      }
      .fields {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
        align-items: flex-start;
        min-width: 0;
      }
      .name {
        flex: 1 1 calc(var(--wt-tap-min) * 3);
        min-width: 0;
      }
      .start {
        flex: 4 1 calc(var(--wt-tap-min) * 3);
        min-width: 0;
      }
      .minutes {
        flex: 0 0 calc(var(--wt-tap-min) * 2 + var(--wt-space-6));
        min-width: 0;
      }
      .empty {
        color: var(--wt-color-text-muted);
      }
      .required,
      .error {
        color: var(--wt-color-danger);
      }
      .required {
        margin-inline-start: var(--wt-space-1);
      }
    `,
  ];

  @property({ attribute: false }) steps: ServiceStepDraft[] = [];
  @property({ attribute: false }) courses: { id: string; name: string }[] = [];
  @property({ attribute: false }) errors: ServiceStepErrors = {};
  @property({ attribute: false }) listError = "";
  @property({ type: Boolean }) disabled = false;

  readonly #reorder = new ReorderController(
    this,
    {
      order: () => this.steps.map((step) => step.key),
      move: (key, to) => this.#move(key, to),
      label: (key) => this.steps.find((step) => step.key === key)!.name,
      busy: () => this.disabled,
      get reorderLabel(): string {
        return t("venue.reorder_service_step");
      },
    } satisfies ReorderModel,
    { announce: () => t("venue.service_step_reordered").replace("{name}", "{item}") },
  );

  #send(steps: ServiceStepDraft[]): void {
    this.steps = steps;
    this.dispatchEvent(
      new CustomEvent("steps-change", { detail: { steps }, bubbles: true, composed: true }),
    );
  }

  #edit(key: string, change: Partial<ServiceStepDraft>): void {
    this.#send(this.steps.map((step) => (step.key === key ? { ...step, ...change } : step)));
  }

  #move(key: string, to: number): void {
    const from = this.steps.findIndex((step) => step.key === key);
    this.#send(reorder(this.steps, from, to));
  }

  async #focus(selector: string): Promise<void> {
    await this.updateComplete;
    const target = this.shadowRoot!.querySelector<
      HTMLElement & { updateComplete?: Promise<unknown> }
    >(selector);
    await target?.updateComplete;
    target?.focus();
  }

  #nameSelector = (key: string) => `tr[data-step="${key}"] wt-input[name="serviceStepName"]`;

  #add(): void {
    const key = crypto.randomUUID();
    this.#send([
      ...this.steps,
      {
        key,
        id: null,
        name: "",
        start: this.steps.length === 0 ? "seated" : "after_previous",
        courseId: null,
        minutes: "0",
      },
    ]);
    void this.#focus(this.#nameSelector(key));
  }

  #remove(key: string): void {
    const at = this.steps.findIndex((step) => step.key === key);
    const next = this.steps[at + 1]?.key;
    this.#send(this.steps.filter((step) => step.key !== key));
    void this.#focus(
      next === undefined ? '[data-test="add-service-step"]' : this.#nameSelector(next),
    );
  }

  #chooseStart(key: string, value: string): void {
    if (value.startsWith(COURSE))
      this.#edit(key, { start: "course_served", courseId: value.slice(COURSE.length) });
    else this.#edit(key, { start: value as ServiceStepStart, courseId: null });
  }

  #startOptions() {
    return [
      { value: "seated", label: t("venue.service_step_start.seated") },
      { value: "after_previous", label: t("venue.service_step_start.after_previous") },
      ...this.courses.map((course) => ({
        value: `${COURSE}${course.id}`,
        label: format("venue.service_step_start.course_served", { course: course.name }),
      })),
      { value: "all_served", label: t("venue.service_step_start.all_served") },
      { value: "since_last_order", label: t("venue.service_step_start.since_last_order") },
    ];
  }

  #row(step: ServiceStepDraft, options: { value: string; label: string }[]): TemplateResult {
    const errors = this.errors[step.key] ?? {};
    const stop = (event: Event) => event.stopPropagation();
    return html`<tr data-step=${step.key}>
      ${
        this.disabled
          ? nothing
          : html`<td class="handle-cell">${this.#reorder.handle(step.key)}</td>`
      }
      <td>
        <div class="fields">
          <wt-input
            class="name"
            name="serviceStepName"
            label=${t("venue.service_step")}
            hide-label
            required
            .value=${step.name}
            .error=${errors.name ?? ""}
            ?disabled=${this.disabled}
            @wt-change=${(event: CustomEvent<{ value: string }>) => {
              stop(event);
              this.#edit(step.key, { name: event.detail.value });
            }}
          ></wt-input>
          <wt-combobox
            class="start"
            name="serviceStepStart"
            label=${t("venue.service_step_starts")}
            hide-label
            required
            search="auto"
            searchPlaceholder=${t("venue.combobox_search")}
            noResultsLabel=${t("venue.combobox_no_results")}
            .options=${options}
            .value=${startValue(step)}
            .error=${errors.start ?? ""}
            ?disabled=${this.disabled}
            @wt-change=${(event: CustomEvent<{ value: string }>) => {
              stop(event);
              this.#chooseStart(step.key, event.detail.value);
            }}
          ></wt-combobox>
          <wt-input
            class="minutes"
            name="serviceStepMinutes"
            type="number"
            label=${t("venue.service_step_minutes")}
            hide-label
            required
            .value=${step.minutes}
            .error=${errors.minutes ?? ""}
            ?disabled=${this.disabled}
            @wt-change=${(event: CustomEvent<{ value: string }>) => {
              stop(event);
              this.#edit(step.key, { minutes: event.detail.value });
            }}
            ><span slot="end">${t("venue.service_step_min")}</span></wt-input
          >
        </div>
      </td>
      ${
        this.disabled
          ? nothing
          : html`<td class="actions-cell">
              <wt-row-actions align="end" label=${format("prep.row_actions", { name: step.name })}>
                <wt-button
                  align="start"
                  variant="ghost"
                  data-test=${`remove-${step.key}`}
                  @click=${(event: Event) => {
                    stop(event);
                    this.#remove(step.key);
                  }}
                  >${t("venue.delete")}</wt-button
                >
              </wt-row-actions>
            </td>`
      }
    </tr>`;
  }

  #table(): TemplateResult {
    const options = this.#startOptions();
    return html`<div
      class="table-wrap"
      tabindex="0"
      role="region"
      aria-label=${t("venue.service_steps")}
    >
      <table>
        <thead>
          <tr>
            ${
              this.disabled
                ? nothing
                : html`<th scope="col" class="handle-cell">
                    <span class="visually-hidden">${t("venue.reorder_service_step")}</span>
                  </th>`
            }
            <th scope="col">
              <div class="fields">
                <span class="name" data-head
                  >${t("venue.service_step")}<span class="required" aria-hidden="true"
                    >*</span
                  ></span
                >
                <span class="start" data-head
                  >${t("venue.service_step_starts")}<span class="required" aria-hidden="true"
                    >*</span
                  ></span
                >
                <span class="minutes" data-head>
                  <span class="visually-hidden">${t("venue.service_step_minutes")}</span>
                </span>
              </div>
            </th>
            ${
              this.disabled
                ? nothing
                : html`<th scope="col" class="actions-cell">
                    <span class="visually-hidden">${t("venue.actions")}</span>
                  </th>`
            }
          </tr>
        </thead>
        <tbody>
          ${repeat(
            this.steps,
            (step) => step.key,
            (step) => this.#row(step, options),
          )}
        </tbody>
      </table>
    </div>`;
  }

  override render(): TemplateResult {
    return html`<h4 data-test="service-steps-heading">${t("venue.service_steps")}</h4>
      ${this.disabled ? nothing : this.#reorder.liveRegion()}
      ${
        this.steps.length === 0
          ? html`<p class="empty" data-test="empty">${t("venue.no_service_steps")}</p>`
          : this.#table()
      }
      ${
        this.listError
          ? html`<p class="error" data-test="list-error" role="alert">${this.listError}</p>`
          : nothing
      }
      ${
        this.disabled
          ? nothing
          : html`<div>
              <wt-button
                variant="secondary"
                data-test="add-service-step"
                ?disabled=${this.steps.length >= MAX_SERVICE_STEPS}
                @click=${() => this.#add()}
                >${t("venue.add_service_step")}</wt-button
              >
            </div>`
      }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "department-service-steps": DepartmentServiceSteps;
  }
}
