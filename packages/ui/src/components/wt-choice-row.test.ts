import { afterEach, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { cleanup, host, mount } from "../test-helpers.js";
import type { WtChoiceRow } from "./wt-choice-row.js";
import "./wt-choice-row.js";

afterEach(cleanup);

const DEMO =
  '<wt-choice-row heading="Demo">A practice server. Nothing is filed to AEAT.</wt-choice-row>';

const button = (el: WtChoiceRow) => el.shadowRoot!.querySelector("button")!;

test("is one native button holding the heading and the slotted description", async () => {
  const el = (await mount(DEMO)) as WtChoiceRow;
  const inner = button(el);
  expect(inner.querySelector("[part=heading]")!.textContent).toBe("Demo");
  const slot = inner.querySelector("slot")!;
  expect(
    slot
      .assignedNodes()
      .map((n) => n.textContent)
      .join(""),
  ).toBe("A practice server. Nothing is filed to AEAT.");
  expect(el.shadowRoot!.querySelectorAll("button")).toHaveLength(1);
});

test("a click anywhere on the row reaches a listener on the element", async () => {
  const el = (await mount(DEMO)) as WtChoiceRow;
  let clicks = 0;
  el.addEventListener("click", () => clicks++);
  await userEvent.click(el.shadowRoot!.querySelector("[part=heading]")!);
  await userEvent.click(el);
  expect(clicks).toBe(2);
});

test("Enter and Space on the focused row choose it", async () => {
  const el = (await mount(DEMO)) as WtChoiceRow;
  let clicks = 0;
  el.addEventListener("click", () => clicks++);
  el.focus();
  expect(el.shadowRoot!.activeElement).toBe(button(el));
  await userEvent.keyboard("{Enter}");
  await userEvent.keyboard(" ");
  expect(clicks).toBe(2);
});

test("is at least the tap-target height", async () => {
  const el = (await mount(DEMO)) as WtChoiceRow;
  el.style.setProperty("--wt-tap-min", "123px");
  expect(button(el).getBoundingClientRect().height).toBeGreaterThanOrEqual(123);
});

test("paints its border, heading and description from tokens", async () => {
  const el = (await mount(DEMO)) as WtChoiceRow;
  host.style.setProperty("--wt-color-border", "rgb(1, 2, 3)");
  host.style.setProperty("--wt-color-text", "rgb(4, 5, 6)");
  host.style.setProperty("--wt-color-text-muted", "rgb(7, 8, 9)");
  const inner = button(el);
  expect(getComputedStyle(inner).borderTopColor).toBe("rgb(1, 2, 3)");
  expect(getComputedStyle(inner.querySelector("[part=heading]")!).color).toBe("rgb(4, 5, 6)");
  expect(getComputedStyle(inner.querySelector("[part=description]")!).color).toBe("rgb(7, 8, 9)");
  expect(getComputedStyle(inner.querySelector("[part=arrow]")!).color).toBe("rgb(7, 8, 9)");
});

test("takes the lifted surface while the pointer is over it", async () => {
  const el = (await mount(DEMO)) as WtChoiceRow;
  host.style.setProperty("--wt-color-surface", "rgb(10, 11, 12)");
  host.style.setProperty("--wt-color-surface-lifted", "rgb(13, 14, 15)");
  expect(getComputedStyle(button(el)).backgroundColor).toBe("rgb(10, 11, 12)");
  await userEvent.hover(button(el));
  expect(getComputedStyle(button(el)).backgroundColor).toBe("rgb(13, 14, 15)");
});

test("takes the whole width it is given", async () => {
  const el = (await mount(DEMO)) as WtChoiceRow;
  host.style.width = "400px";
  expect(button(el).getBoundingClientRect().width).toBe(400);
});
