import { afterEach, expect, test } from "vitest";
import { cleanup, mount } from "../test-helpers.js";
import "./wt-help-tooltip.js";

afterEach(cleanup);

test("opens explanatory content from an accessible question-mark button", async () => {
  const el = await mount(
    '<wt-help-tooltip aria-label="About email addresses">Use the address this person checks.</wt-help-tooltip>',
  );
  const button = el.shadowRoot!.querySelector("button")!;
  expect(button.textContent?.trim()).toBe("?");
  expect(button.getAttribute("aria-label")).toBe("About email addresses");
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(el.shadowRoot!.querySelector("[role=tooltip]")).toBeNull();

  button.click();
  await (el as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  const tooltip = el.shadowRoot!.querySelector<HTMLElement>("[role=tooltip]")!;
  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(button.getAttribute("aria-describedby")).toBe(tooltip.id);
  const content = tooltip
    .querySelector("slot")!
    .assignedNodes()
    .map((node) => node.textContent)
    .join("")
    .trim();
  expect(content).toBe("Use the address this person checks.");
});

test("closes when the user clicks anywhere outside it", async () => {
  const el = await mount('<wt-help-tooltip aria-label="Help">Explanation</wt-help-tooltip>');
  el.shadowRoot!.querySelector("button")!.click();
  await (el as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;

  document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
  await (el as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  expect(el.shadowRoot!.querySelector("[role=tooltip]")).toBeNull();
});

test("a click inside the tooltip does not close it", async () => {
  const el = await mount('<wt-help-tooltip aria-label="Help">Explanation</wt-help-tooltip>');
  el.shadowRoot!.querySelector("button")!.click();
  await (el as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;

  el.shadowRoot!.querySelector("[role=tooltip]")!.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, composed: true }),
  );
  await (el as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  expect(el.shadowRoot!.querySelector("[role=tooltip]")).not.toBeNull();
});

test("Escape closes it and returns focus to its button", async () => {
  const el = await mount('<wt-help-tooltip aria-label="Help">Explanation</wt-help-tooltip>');
  const button = el.shadowRoot!.querySelector("button")!;
  button.click();
  await (el as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;

  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await (el as HTMLElement & { updateComplete: Promise<unknown> }).updateComplete;
  expect(el.shadowRoot!.querySelector("[role=tooltip]")).toBeNull();
  expect(el.shadowRoot!.activeElement).toBe(button);
});

test("the question-mark button meets the minimum tap target", async () => {
  const el = await mount('<wt-help-tooltip aria-label="Help">Explanation</wt-help-tooltip>');
  const rect = el.shadowRoot!.querySelector("button")!.getBoundingClientRect();
  expect(rect.width).toBeGreaterThanOrEqual(44);
  expect(rect.height).toBeGreaterThanOrEqual(44);
});
