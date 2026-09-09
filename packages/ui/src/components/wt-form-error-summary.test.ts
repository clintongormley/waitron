import { afterEach, expect, test } from "vitest";
import { cleanup, mount } from "../test-helpers.js";
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
