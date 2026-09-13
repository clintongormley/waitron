import { afterEach, describe, test } from "vitest";
import { userEvent } from "@vitest/browser/context";
import { cleanup, host } from "../test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "../a11y-helpers.js";
import "./wt-combobox.js";
import type { WtCombobox } from "./wt-combobox.js";

afterEach(cleanup);

const TAGS = [
  { value: "gluten-free", label: "Gluten-free" },
  { value: "vegan", label: "Vegan" },
  { value: "vegetarian", label: "Vegetarian" },
];

describe.each(["light", "dark"] as const)("wt-combobox a11y (%s theme)", (theme) => {
  test("closed, empty", async () => {
    await mountThemed('<wt-combobox label="Dietary tags"></wt-combobox>', theme);
    await expectNoA11yViolations(host);
  });

  // No visible `label` — the accessible name has to come from the forwarded aria-label fallback.
  test("closed, named via aria-label", async () => {
    await mountThemed('<wt-combobox aria-label="Dietary tags"></wt-combobox>', theme);
    await expectNoA11yViolations(host);
  });

  test("open with results", async () => {
    const el = (await mountThemed(
      '<wt-combobox label="Dietary tags"></wt-combobox>',
      theme,
    )) as WtCombobox;
    el.options = TAGS;
    await el.updateComplete;
    await userEvent.click(el.shadowRoot!.querySelector(".trigger")!);
    await expectNoA11yViolations(host);
  });

  test("open with the add row showing", async () => {
    const el = (await mountThemed(
      '<wt-combobox label="Dietary tags" allow-add></wt-combobox>',
      theme,
    )) as WtCombobox;
    el.options = TAGS;
    await el.updateComplete;
    await userEvent.click(el.shadowRoot!.querySelector(".trigger")!);
    await userEvent.type(el.shadowRoot!.querySelector<HTMLInputElement>(".search")!, "kosher");
    await expectNoA11yViolations(host);
  });

  test("open with no matches and allowAdd off", async () => {
    const el = (await mountThemed(
      '<wt-combobox label="Dietary tags"></wt-combobox>',
      theme,
    )) as WtCombobox;
    el.options = TAGS;
    await el.updateComplete;
    await userEvent.click(el.shadowRoot!.querySelector(".trigger")!);
    await userEvent.type(el.shadowRoot!.querySelector<HTMLInputElement>(".search")!, "kosher");
    await expectNoA11yViolations(host);
  });

  test("multiple, with a selection", async () => {
    const el = (await mountThemed(
      '<wt-combobox label="Dietary tags" multiple></wt-combobox>',
      theme,
    )) as WtCombobox;
    el.options = TAGS;
    el.values = ["vegan"];
    await el.updateComplete;
    await userEvent.click(el.shadowRoot!.querySelector(".trigger")!);
    await expectNoA11yViolations(host);
  });

  test("invalid, with an error message", async () => {
    await mountThemed(
      '<wt-combobox label="Dietary tags" invalid error="Choose at least one tag"></wt-combobox>',
      theme,
    );
    await expectNoA11yViolations(host);
  });

  test("disabled", async () => {
    await mountThemed('<wt-combobox label="Dietary tags" disabled></wt-combobox>', theme);
    await expectNoA11yViolations(host);
  });

  test("required", async () => {
    await mountThemed('<wt-combobox label="Dietary tags" required></wt-combobox>', theme);
    await expectNoA11yViolations(host);
  });
});
