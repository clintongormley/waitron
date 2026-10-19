import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { DepartmentServiceSteps } from "./department-service-steps.js";
import type { ServiceStepDraft } from "./service-step-draft.js";

import "./department-service-steps.js";

const STEPS: ServiceStepDraft[] = [
  { key: "s1", id: "s1", name: "Set up", start: "seated", courseId: null, minutes: "0" },
  { key: "s2", id: null, name: "", start: "course_served", courseId: "c1", minutes: "2.5" },
  { key: "s3", id: "s3", name: "Again?", start: "since_last_order", courseId: null, minutes: "20" },
];

afterEach(() => {
  cleanup();
  setLocale("en");
});

describe.each(["light", "dark"] as const)("service step list accessibility (%s)", (theme) => {
  it.each(["rows", "empty", "errors", "read-only"])("%s", async (state) => {
    setLocale("en");
    expect(customElements.get("department-service-steps")).toBeDefined();
    const el = (await mountThemed(
      "<department-service-steps></department-service-steps>",
      theme,
    )) as DepartmentServiceSteps;
    el.courses = [{ id: "c1", name: "Mains" }];
    el.steps = state === "empty" ? [] : STEPS.map((step) => ({ ...step }));
    el.disabled = state === "read-only";
    if (state === "errors") {
      el.errors = {
        s2: { name: "This field is required.", minutes: "Whole minutes, 0 to 120." },
        s3: { start: "That course was deleted. Choose another start." },
      };
      el.listError = "A step was changed elsewhere. Cancel and open it again to see the latest.";
    }
    await el.updateComplete;
    await Promise.all(
      [
        ...el.shadowRoot!.querySelectorAll<HTMLElement & { updateComplete: Promise<unknown> }>(
          "wt-input, wt-combobox, wt-button, wt-row-actions",
        ),
      ].map((control) => control.updateComplete),
    );
    await expectNoA11yViolations(host);
  });
});
