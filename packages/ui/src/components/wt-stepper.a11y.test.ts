import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-stepper.js";

afterEach(cleanup);

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

describe.each(["light", "dark"] as const)("wt-stepper bin a11y (%s theme)", (theme) => {
  test("at min with a remove label: the bin is a named, enabled button", async () => {
    const el = (await mountThemed(
      '<wt-stepper label="Burger" value="1" min="1"></wt-stepper>',
      theme,
    )) as HTMLElementTagNameMap["wt-stepper"];
    el.removeLabel = (label) => `Remove ${label}`;
    await el.updateComplete;
    await expectNoA11yViolations(host);
    await expect.element(page.getByRole("button", { name: "Remove Burger" })).toBeEnabled();
  });

  test("the bin while disabled", async () => {
    const el = (await mountThemed(
      '<wt-stepper label="Burger" value="1" min="1" disabled></wt-stepper>',
      theme,
    )) as HTMLElementTagNameMap["wt-stepper"];
    el.removeLabel = (label) => `Remove ${label}`;
    await el.updateComplete;
    await expectNoA11yViolations(host);
    await expect.element(page.getByRole("button", { name: "Remove Burger" })).toBeDisabled();
  });
});

describe.each(["light", "dark"] as const)("wt-stepper round a11y (%s theme)", (theme) => {
  test("a round stepper: the group and both buttons are named", async () => {
    await mountThemed('<wt-stepper variant="round" label="Guests" value="3"></wt-stepper>', theme);
    await expectNoA11yViolations(host, { enable: ["target-size"] });
    await expect.element(page.getByRole("group", { name: "Guests" })).toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Decrease Guests" })).toBeEnabled();
    await expect.element(page.getByRole("button", { name: "Increase Guests" })).toBeEnabled();
  });

  test("a round stepper at min", async () => {
    await mountThemed(
      '<wt-stepper variant="round" label="Guests" value="1" min="1"></wt-stepper>',
      theme,
    );
    await expectNoA11yViolations(host);
    await expect.element(page.getByRole("button", { name: "Decrease Guests" })).toBeDisabled();
  });

  test("a round stepper while disabled", async () => {
    await mountThemed(
      '<wt-stepper variant="round" label="Guests" value="2" disabled></wt-stepper>',
      theme,
    );
    await expectNoA11yViolations(host);
  });
});
