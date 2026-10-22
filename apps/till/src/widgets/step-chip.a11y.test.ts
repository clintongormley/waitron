import { afterEach, describe, expect, it } from "vitest";
import { LitElement, html } from "lit";
import type { ServiceStepDue } from "@waitron/shared";
import { stepChip, stepChipStyles } from "./step-chip.js";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "./test-helpers.js";

class StepChipA11yHost extends LitElement {
  static override styles = stepChipStyles;
  static override properties = { step: { attribute: false } };
  declare step: ServiceStepDue;
  override render() {
    return html`${stepChip(this.step, { onDone: () => {} })}`;
  }
}
customElements.define("step-chip-a11y-host", StepChipA11yHost);

afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("step chip a11y (%s theme)", (theme) => {
  it("the chip and its Done button have no violations", async () => {
    const { el, host } = await mountWidget<StepChipA11yHost>(
      "step-chip-a11y-host",
      {
        step: {
          stepId: "0b6f7c1e-4a43-4a65-9d0c-7c1f4f0f2a11",
          name: "Dessert?",
          dueAt: "2026-10-22T21:42:00.000Z",
        },
      },
      theme,
    );
    expect(el.shadowRoot!.querySelectorAll("button.step-done")).toHaveLength(1);
    await expectNoA11yViolations(host);
  });
});
