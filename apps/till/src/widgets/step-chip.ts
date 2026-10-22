import { css, html, type TemplateResult } from "lit";
import "@waitron/ui";
import type { ServiceStepDue } from "@waitron/shared";
import { t } from "../i18n/t.js";

/** Done's label names the step, so two Done buttons on one screen are told apart. */
export function stepChip(step: ServiceStepDue, options: { onDone: () => void }): TemplateResult {
  return html`<span class="step-chip" data-chip="service-step" data-step=${step.stepId}
    ><span class="step-name"><wt-icon name="floor-step" size="sm"></wt-icon>${step.name}</span
    ><button
      type="button"
      class="step-done"
      data-step-done=${step.stepId}
      aria-label=${t("floor.step_done_label").replace("{step}", step.name)}
      @click=${(event: Event) => {
        event.stopPropagation();
        options.onDone();
      }}
    >
      ${t("floor.step_done")}
    </button></span
  >`;
}

export const stepChipStyles = css`
  .step-chip {
    display: inline-flex;
    align-items: stretch;
    max-width: 100%;
    border: 1px solid var(--wt-color-primary);
    border-radius: var(--wt-radius-sm);
  }

  .step-name,
  .step-done {
    font-size: var(--wt-font-size-sm);
    font-weight: var(--wt-font-weight-bold);
  }

  .step-name {
    display: inline-flex;
    align-items: center;
    gap: var(--wt-space-1);
    min-width: 0;
    padding: var(--wt-space-1) var(--wt-space-2);
    border-radius: inherit;
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
    background: var(--wt-color-primary);
    color: var(--wt-color-on-primary);
    overflow-wrap: anywhere;
  }

  .step-name wt-icon {
    flex: none;
    color: inherit;
  }

  .step-done {
    flex: none;
    min-width: var(--wt-tap-min);
    min-height: var(--wt-tap-min);
    margin: 0;
    padding: 0 var(--wt-space-3);
    border: none;
    border-left: 1px solid var(--wt-color-primary);
    border-radius: inherit;
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
    background: var(--wt-color-surface-raised);
    color: var(--wt-color-text);
    font-family: inherit;
    cursor: pointer;
  }

  .step-done:focus-visible {
    outline: var(--wt-focus-ring);
    outline-offset: var(--wt-focus-offset);
  }
`;
