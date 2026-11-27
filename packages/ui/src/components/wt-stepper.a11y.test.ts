import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import { registerIcons } from "./wt-icon.js";
import "./wt-stepper.js";

afterEach(cleanup);

registerIcons({
  minus: "M2.5 7.25H13.5V8.75H2.5Z",
  plus: "M7.25 2.5H8.75V7.25H13.5V8.75H8.75V13.5H7.25V8.75H2.5V7.25H7.25Z",
});

describe.each(["light", "dark"] as const)("wt-stepper a11y (%s theme)", (theme) => {
  test("a plain stepper: the group and both buttons are named", async () => {
    await mountThemed('<wt-stepper label="Burger" value="2"></wt-stepper>', theme);
    await expectNoA11yViolations(host);
    await expect.element(page.getByRole("group", { name: "Burger" })).toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Decrease Burger" })).toBeEnabled();
    await expect.element(page.getByRole("button", { name: "Increase Burger" })).toBeEnabled();
  });

  test("at min", async () => {
    await mountThemed('<wt-stepper label="Burger" value="1" min="1"></wt-stepper>', theme);
    await expectNoA11yViolations(host);
    await expect.element(page.getByRole("button", { name: "Decrease Burger" })).toBeDisabled();
  });

  test("at max", async () => {
    await mountThemed('<wt-stepper label="Burger" value="5" max="5"></wt-stepper>', theme);
    await expectNoA11yViolations(host);
    await expect.element(page.getByRole("button", { name: "Increase Burger" })).toBeDisabled();
  });

  test("disabled", async () => {
    await mountThemed('<wt-stepper label="Burger" value="2" disabled></wt-stepper>', theme);
    await expectNoA11yViolations(host);
  });
});
