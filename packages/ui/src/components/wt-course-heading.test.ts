import { afterEach, expect, it } from "vitest";
import { cleanup, mount } from "../test-helpers.js";
import type { WtCourseHeading } from "./wt-course-heading.js";
import "./wt-course-heading.js";

afterEach(cleanup);

const heading = (el: Element) => el.shadowRoot!.querySelector<HTMLElement>('[role="heading"]')!;
const mark = (el: Element) => el.shadowRoot!.querySelector<HTMLElement>('[part="mark"]');

it("reads as a level 3 heading holding its title", async () => {
  const el = await mount("<wt-course-heading>Drinks · fired 12 min ago</wt-course-heading>");
  expect(heading(el).getAttribute("aria-level")).toBe("3");
  const slot = heading(el).querySelector<HTMLSlotElement>("slot:not([name])")!;
  expect(slot.assignedNodes()[0]!.textContent).toBe("Drinks · fired 12 min ago");
});

it("takes the heading level it is given", async () => {
  const el = (await mount(
    '<wt-course-heading level="4">Mains</wt-course-heading>',
  )) as WtCourseHeading;
  expect(heading(el).getAttribute("aria-level")).toBe("4");
  el.level = 2;
  await el.updateComplete;
  expect(heading(el).getAttribute("aria-level")).toBe("2");
});

it("draws no mark until it is given one", async () => {
  const el = await mount('<wt-course-heading mark-label="Sent">Mains</wt-course-heading>');
  expect(mark(el)).toBeNull();
});

it("draws the sent mark as a tick before its word, inside the heading", async () => {
  const el = await mount(
    '<wt-course-heading mark="sent" mark-label="Sent">Drinks</wt-course-heading>',
  );
  const pill = mark(el)!;
  expect(heading(el).contains(pill)).toBe(true);
  const icon = pill.querySelector("wt-icon")!;
  expect(icon.getAttribute("name")).toBe("check");
  expect(icon.getAttribute("aria-hidden")).toBe("true");
  expect(pill.textContent!.trim()).toBe("Sent");
  expect(icon.compareDocumentPosition(pill.querySelector("span")!)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
});

it("puts the end slot outside the heading, after the mark", async () => {
  const el = await mount(
    '<wt-course-heading mark="sent" mark-label="Sent">Drinks<button slot="end">Serve all</button></wt-course-heading>',
  );
  const end = el.shadowRoot!.querySelector<HTMLSlotElement>('slot[name="end"]')!;
  expect(end.assignedElements()[0]!.textContent).toBe("Serve all");
  expect(heading(el).contains(end)).toBe(false);
  const button = el.querySelector("button")!.getBoundingClientRect();
  expect(button.left).toBeGreaterThanOrEqual(mark(el)!.getBoundingClientRect().right);
});

it("paints the heading from tokens: small capitals, bold, letter-spaced, muted, on the page", async () => {
  const el = await mount("<wt-course-heading>Mains</wt-course-heading>");
  el.style.setProperty("--wt-color-bg", "rgb(1, 2, 3)");
  el.style.setProperty("--wt-color-text-muted", "rgb(4, 5, 6)");
  el.style.setProperty("--wt-font-size-sm", "11px");
  el.style.setProperty("--wt-font-weight-bold", "700");
  el.style.setProperty("--wt-letter-spacing-caps", "0.5em");
  el.style.setProperty("--wt-course-heading-padding-bottom", "2px");
  el.style.setProperty("--wt-space-3", "3px");
  el.style.setProperty("--wt-space-4", "4px");
  const box = getComputedStyle(el);
  expect(box.backgroundColor).toBe("rgb(1, 2, 3)");
  expect([box.paddingTop, box.paddingRight, box.paddingBottom, box.paddingLeft]).toEqual([
    "3px",
    "4px",
    "2px",
    "4px",
  ]);
  const text = getComputedStyle(heading(el));
  expect(text.color).toBe("rgb(4, 5, 6)");
  expect(text.fontSize).toBe("11px");
  expect(text.fontWeight).toBe("700");
  expect(text.letterSpacing).toBe("5.5px");
  expect(text.textTransform).toBe("uppercase");
});

it("paints the sent mark from tokens, in plain upright letters", async () => {
  const el = await mount(
    '<wt-course-heading mark="sent" mark-label="Sent">Drinks</wt-course-heading>',
  );
  el.style.setProperty("--wt-color-tab-ready-tint", "rgb(7, 8, 9)");
  el.style.setProperty("--wt-color-text", "rgb(10, 11, 12)");
  el.style.setProperty("--wt-color-success", "rgb(13, 14, 15)");
  el.style.setProperty("--wt-font-size-sm", "11px");
  el.style.setProperty("--wt-radius-full", "77px");
  el.style.setProperty("--wt-space-1", "1px");
  el.style.setProperty("--wt-space-2", "2px");
  const pill = getComputedStyle(mark(el)!);
  expect(pill.backgroundColor).toBe("rgb(7, 8, 9)");
  expect(pill.color).toBe("rgb(10, 11, 12)");
  expect(pill.fontSize).toBe("11px");
  expect(pill.borderTopLeftRadius).toBe("77px");
  expect([pill.paddingTop, pill.paddingRight]).toEqual(["1px", "2px"]);
  expect(pill.textTransform).toBe("none");
  expect(pill.letterSpacing).toBe("normal");
  expect(getComputedStyle(mark(el)!.querySelector("wt-icon")!).color).toBe("rgb(13, 14, 15)");
});
