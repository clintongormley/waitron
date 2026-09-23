import { afterEach, expect, test } from "vitest";
import * as core from "@waitron/ui-core";
import * as legacy from "./index.js";
import { cleanup, mount } from "./test-helpers.js";
import * as button from "./components/wt-button.js";
import * as input from "./components/wt-input.js";
import * as card from "./components/wt-card.js";
import * as icon from "./components/wt-icon.js";
import * as spinner from "./components/wt-spinner.js";
import * as form_actions from "./components/wt-form-actions.js";
import * as form_error_summary from "./components/wt-form-error-summary.js";

afterEach(cleanup);

test("wt-button has one implementation across entry points", () => {
  expect(core.WtButton).toBe(legacy.WtButton);
  expect(core.WtButton).toBe(button.WtButton);
  expect(customElements.get("wt-button")).toBe(core.WtButton);
});
test("wt-input has one implementation across entry points", () => {
  expect(core.WtInput).toBe(legacy.WtInput);
  expect(core.WtInput).toBe(input.WtInput);
  expect(customElements.get("wt-input")).toBe(core.WtInput);
});
test("wt-card has one implementation across entry points", () => {
  expect(core.WtCard).toBe(legacy.WtCard);
  expect(core.WtCard).toBe(card.WtCard);
  expect(customElements.get("wt-card")).toBe(core.WtCard);
});
test("wt-icon has one implementation across entry points", () => {
  expect(core.WtIcon).toBe(legacy.WtIcon);
  expect(core.WtIcon).toBe(icon.WtIcon);
  expect(customElements.get("wt-icon")).toBe(core.WtIcon);
});
test("wt-spinner has one implementation across entry points", () => {
  expect(core.WtSpinner).toBe(legacy.WtSpinner);
  expect(core.WtSpinner).toBe(spinner.WtSpinner);
  expect(customElements.get("wt-spinner")).toBe(core.WtSpinner);
});
test("wt-form-actions has one implementation across entry points", () => {
  expect(core.WtFormActions).toBe(legacy.WtFormActions);
  expect(core.WtFormActions).toBe(form_actions.WtFormActions);
  expect(customElements.get("wt-form-actions")).toBe(core.WtFormActions);
});
test("wt-form-error-summary has one implementation across entry points", () => {
  expect(core.WtFormErrorSummary).toBe(legacy.WtFormErrorSummary);
  expect(core.WtFormErrorSummary).toBe(form_error_summary.WtFormErrorSummary);
  expect(customElements.get("wt-form-error-summary")).toBe(core.WtFormErrorSummary);
});

test("icons registered through core render through the facade", async () => {
  const path = "M1 1L8 8";
  core.registerIcons({ "compatibility-probe": path });
  const icon = await mount('<wt-icon name="compatibility-probe"></wt-icon>');
  expect(icon.shadowRoot!.querySelector("path")!.getAttribute("d")).toBe(path);
});

test("both entry points share identifier state and token installation", async () => {
  expect(core.uniqueId).toBe(legacy.uniqueId);
  const ids = [core.uniqueId("compat"), legacy.uniqueId("compat"), core.uniqueId("compat")];
  expect(new Set(ids).size).toBe(3);
  expect(core.applyTokens).toBe(legacy.applyTokens);
  const el = await mount("<div></div>");
  const count = document.adoptedStyleSheets.length;
  core.applyTokens(el);
  legacy.applyTokens(el);
  expect(document.adoptedStyleSheets).toHaveLength(count);
});
