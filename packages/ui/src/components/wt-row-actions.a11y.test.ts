import axe from "axe-core";
import { afterEach, describe, expect, test } from "vitest";
import { userEvent } from "@vitest/browser/context";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-row-actions.js";
import "./wt-button.js";

afterEach(cleanup);

describe.each(["light", "dark"] as const)("wt-row-actions a11y (%s theme)", (theme) => {
  test("names the hamburger and its open create, edit and delete actions", async () => {
    const el = await mountThemed(
      `<wt-row-actions label="Department actions">
      <wt-button>Create department</wt-button><wt-button>Edit</wt-button>
      <wt-button variant="danger">Delete</wt-button>
    </wt-row-actions>`,
      theme,
    );
    await expectNoA11yViolations(host);
    await userEvent.click(el.shadowRoot!.querySelector("button")!);
    await expectNoA11yViolations(host);
  });

  test("detects a missing accessible name on the hamburger", async () => {
    const el = await mountThemed(
      '<wt-row-actions label="Department actions"></wt-row-actions>',
      theme,
    );
    el.shadowRoot!.querySelector("button")!.removeAttribute("aria-label");
    const result = await axe.run(host);
    expect(result.violations.map(({ id }) => id)).toContain("button-name");
  });
});
