import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { ReorderController, baseStyles, visuallyHiddenStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import type { ServiceStepStart } from "@waitron/db";
import { MAX_SERVICE_STEPS } from "../service-step-limits.js";
import {
  dependentStepKeys,
  placeServiceSteps,
  type ServiceStepDraft,
} from "./service-step-draft.js";
import { format } from "./hours-view.js";
import { t } from "./strings.js";

export type ServiceStepField = "name" | "start" | "minutes";
export type ServiceStepErrors = Record<string, Partial<Record<ServiceStepField, string>>>;

const COURSE = "course_served:";
const STEP = "after_step:";

const startValue = (step: ServiceStepDraft) =>
  step.start === "course_served"
    ? `${COURSE}${step.courseId}`
    : step.start === "after_step"
      ? `${STEP}${step.afterStepKey}`
      : step.start;

@customElement("department-service-steps")
export class DepartmentServiceSteps extends LitElement {
  static override styles = [
    baseStyles,
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
      tbody td:first-child {
        border-inline-start: var(--wt-space-1) solid var(--wt-color-primary);
      }
      h4 wt-icon {
        color: var(--wt-color-primary-text);
        margin-inline-end: var(--wt-space-2);
      }
      tbody td {
        vertical-align: top;
      }
      td.actions-cell,
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
        flex: 1 1 100%;
        min-width: 0;
      }
      /* Where the fields are narrower than nine tap widths the second term outgrows them, so the
         start takes a line of its own rather than be cut short beside the minutes. Not a
         container query, which cannot read --wt-tap-min. */
      .start {
        flex: 4 1 max(calc(var(--wt-tap-min) * 3), calc((var(--wt-tap-min) * 9 - 100%) * 999));
        min-width: 0;
      }
      .minutes {
        flex: 0 0 calc(var(--wt-tap-min) * 2 + var(--wt-space-6));
        min-width: 0;
      }
      .empty {
        color: var(--wt-color-text-muted);
      }
      .visually-hidden {
        ${visuallyHiddenStyles}
      }
      .required {
        color: var(--wt-color-danger);
        margin-inline-start: var(--wt-space-1);
      }
    `,
  ];

  @property({ attribute: false }) steps: ServiceStepDraft[] = [];
  @property({ attribute: false }) courses: { id: string; name: string }[] = [];
  @property({ attribute: false }) errors: ServiceStepErrors = {};
  @property({ type: Boolean }) disabled = false;

  #send(steps: ServiceStepDraft[], place = false): void {
    if (place)
      steps = placeServiceSteps(
        steps,
        this.courses.map((course) => course.id),
      );
    this.steps = steps;
    this.dispatchEvent(
      new CustomEvent("steps-change", { detail: { steps }, bubbles: true, composed: true }),
    );
  }

  #edit(key: string, change: Partial<ServiceStepDraft>): void {
    this.#send(
      this.steps.map((step) => (step.key === key ? { ...step, ...change } : step)),
      change.start !== undefined,
    );
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
        start: this.steps.length === 0 ? "seated" : "after_step",
        afterStepKey: this.steps.at(-1)?.key ?? null,
        courseId: null,
        minutes: "0",
      },
    ]);
    void this.#focus(this.#nameSelector(key));
  }

  #remove(key: string): void {
    const at = this.steps.findIndex((step) => step.key === key);
    const removed = dependentStepKeys(this.steps, key);
    const next = this.steps.slice(at + 1).find((step) => !removed.has(step.key))?.key;
    this.#send(this.steps.filter((step) => !removed.has(step.key)));
    void this.#focus(
      next === undefined ? '[data-test="add-service-step"]' : this.#nameSelector(next),
    );
  }

  #chooseStart(key: string, value: string): void {
    if (value.startsWith(COURSE))
      this.#edit(key, {
        start: "course_served",
        courseId: value.slice(COURSE.length),
        afterStepKey: null,
      });
    else if (value.startsWith(STEP))
      this.#edit(key, {
        start: "after_step",
        afterStepKey: value.slice(STEP.length),
        courseId: null,
      });
    else this.#edit(key, { start: value as ServiceStepStart, courseId: null, afterStepKey: null });
    void this.#focus(`tr[data-step="${key}"] wt-combobox[name="serviceStepStart"]`);
  }

  #startOptions(step: ServiceStepDraft) {
    const descendants = dependentStepKeys(this.steps, step.key);
    return [
      { value: "seated", label: t("venue.service_step_start.seated") },
      ...this.steps
        .filter((row) => !descendants.has(row.key))
        .map((row) => ({
          value: `${STEP}${row.key}`,
          label: format("venue.service_step_start.after_step", { step: row.name }),
        })),
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
            ?preserve-order=${true}
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
                  data-action="delete"
                  aria-label=${`${t("venue.delete")}: ${step.name}`}
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
    return html`<div
      class="table-wrap"
      tabindex="0"
      role="region"
      aria-label=${t("venue.service_steps")}
    >
      <table>
        <thead>
          <tr>
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
                <span class="minutes" data-head
                  >${t("venue.service_step_minutes")}<span class="required" aria-hidden="true"
                    >*</span
                  ></span
                >
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
            (step) => this.#row(step, this.#startOptions(step)),
          )}
        </tbody>
      </table>
    </div>`;
  }

  override render(): TemplateResult {
    return html`<h4 data-test="service-steps-heading">
        <wt-icon name="floor-step"></wt-icon>${t("venue.service_steps")}
      </h4>
      ${
        this.steps.length === 0
          ? html`<p class="empty" data-test="empty">${t("venue.no_service_steps")}</p>`
          : this.#table()
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
