import { afterEach, expect, test } from "vitest";
import { cleanup, host, mount } from "../test-helpers.js";
import { WtFormErrorSummary } from "./wt-form-error-summary.js";

afterEach(cleanup);

test("renders nothing when the form has no errors", async () => {
  const el = (await mount(
    '<wt-form-error-summary heading="There is a problem with this form"></wt-form-error-summary>',
  )) as WtFormErrorSummary;
  expect(el.shadowRoot!.querySelector("[role=alert]")).toBeNull();
});

test("announces the generic heading and every explanatory field error", async () => {
  const el = (await mount(
    '<wt-form-error-summary heading="There is a problem with this form"></wt-form-error-summary>',
  )) as WtFormErrorSummary;
  el.errors = ["Enter your email address", "Enter a valid PIN"];
  await el.updateComplete;

  const alert = el.shadowRoot!.querySelector("[role=alert]")!;
  const heading = el.shadowRoot!.querySelector<HTMLElement>("[data-heading]")!;
  expect(alert.getAttribute("aria-labelledby")).toBe(heading.id);
  expect(heading.textContent).toBe("There is a problem with this form");
  expect([...el.shadowRoot!.querySelectorAll("li")].map((item) => item.textContent)).toEqual([
    "Enter your email address",
    "Enter a valid PIN",
  ]);
});

test("shows an empty heading when the form supplies none", async () => {
  const el = (await mount("<wt-form-error-summary></wt-form-error-summary>")) as WtFormErrorSummary;
  el.errors = ["Enter your email address"];
  await el.updateComplete;

  expect(el.shadowRoot!.querySelector<HTMLElement>("[data-heading]")!.textContent).toBe("");
});

test("gives each summary's heading its own id, named for the component", async () => {
  const first = (await mount(
    '<wt-form-error-summary heading="There is a problem with this form"></wt-form-error-summary>',
  )) as WtFormErrorSummary;
  const second = (await mount(
    '<wt-form-error-summary heading="There is a problem with this form"></wt-form-error-summary>',
  )) as WtFormErrorSummary;
  first.errors = ["Enter your email address"];
  second.errors = ["Enter a valid PIN"];
  await Promise.all([first.updateComplete, second.updateComplete]);

  const idOf = (el: WtFormErrorSummary) =>
    el.shadowRoot!.querySelector<HTMLElement>("[data-heading]")!.id;
  expect(idOf(first)).toMatch(/^wt-form-error-heading-\d+$/);
  expect(idOf(second)).toMatch(/^wt-form-error-heading-\d+$/);
  expect(idOf(first)).not.toBe(idOf(second));
});

test("paints the alert from the danger and raised-surface tokens, as its own block", async () => {
  const el = (await mount(
    '<wt-form-error-summary heading="There is a problem with this form"></wt-form-error-summary>',
  )) as WtFormErrorSummary;
  el.errors = ["Enter your email address"];
  await el.updateComplete;
  host.style.setProperty("--wt-color-danger", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-surface-raised", "rgb(4, 5, 6)");

  const summary = getComputedStyle(el.shadowRoot!.querySelector<HTMLElement>(".summary")!);
  const heading = getComputedStyle(el.shadowRoot!.querySelector<HTMLElement>("[data-heading]")!);
  expect(summary.backgroundColor).toBe("rgb(4, 5, 6)");
  expect(summary.borderInlineStartColor).toBe("rgb(1, 2, 3)");
  expect(parseFloat(summary.borderInlineStartWidth)).toBeGreaterThan(0);
  expect(heading.color).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(el).display).toBe("block");
});
