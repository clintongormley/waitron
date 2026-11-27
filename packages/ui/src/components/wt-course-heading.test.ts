import { afterEach, describe, expect, it } from "vitest";
import { cleanup, mount } from "../test-helpers.js";
import type { WtCourseHeading } from "./wt-course-heading.js";
import "./wt-course-heading.js";
import "./wt-button.js";

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

it.each(["0", "-1", "1.5", "7", "abc", ""])(
  "draws level 3 when its level attribute is %j",
  async (value) => {
    const el = await mount(`<wt-course-heading level="${value}">Mains</wt-course-heading>`);
    expect(heading(el).getAttribute("aria-level")).toBe("3");
  },
);

it.each([0, -1, 1.5, 7, Number.NaN, Number.POSITIVE_INFINITY])(
  "draws level 3 when its level property is %s",
  async (value) => {
    const el = (await mount("<wt-course-heading>Mains</wt-course-heading>")) as WtCourseHeading;
    el.level = value;
    await el.updateComplete;
    expect(heading(el).getAttribute("aria-level")).toBe("3");
  },
);

it("takes each whole level from 1 to 6", async () => {
  const el = (await mount("<wt-course-heading>Mains</wt-course-heading>")) as WtCourseHeading;
  for (const level of [1, 2, 3, 4, 5, 6]) {
    el.level = level;
    await el.updateComplete;
    expect(heading(el).getAttribute("aria-level")).toBe(String(level));
  }
});

it("goes back to level 3 when its level attribute is removed", async () => {
  const el = await mount('<wt-course-heading level="2">Mains</wt-course-heading>');
  expect(heading(el).getAttribute("aria-level")).toBe("2");
  el.removeAttribute("level");
  await (el as WtCourseHeading).updateComplete;
  expect(heading(el).getAttribute("aria-level")).toBe("3");
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

it("paints the heading from tokens: uppercase, bold, letter-spaced, muted, on the page", async () => {
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

describe("laying out a title, the mark and an action that cannot all share one line", () => {
  const title = "Sharing plates · marchado hace 8 min";
  const rect = (el: Element) => el.getBoundingClientRect();
  const parts = (el: Element) => ({
    title: rect(heading(el).querySelector("span")!),
    mark: rect(mark(el)!),
    button: rect(el.querySelector("wt-button")!),
    right: rect(el).right - parseFloat(getComputedStyle(el).paddingRight),
  });
  async function laidOut(width: number, words = title) {
    const el = await mount(
      `<wt-course-heading mark="sent" mark-label="Enviado" style="width: ${width}px">${words}<wt-button slot="end">Servir todo</wt-button></wt-course-heading>`,
    );
    await (el.querySelector("wt-button") as HTMLElement & { updateComplete: Promise<unknown> })
      .updateComplete;
    return el;
  }
  async function oneLineTitle() {
    const lone = await mount(
      `<wt-course-heading style="width: 2000px">${title}</wt-course-heading>`,
    );
    const words = document.createRange();
    words.selectNodeContents(lone);
    const box = words.getBoundingClientRect();
    return { width: box.width, height: rect(heading(lone).querySelector("span")!).height };
  }
  const apart = (a: DOMRect, b: DOMRect) =>
    a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;

  it("keeps everything on one line, the mark just before the action, when there is room", async () => {
    const el = await laidOut(900);
    const { title: words, mark: pill, button, right } = parts(el);
    expect(button.top).toBeLessThan(words.bottom);
    expect(pill.right).toBeLessThanOrEqual(button.left);
    expect(button.left - pill.right).toBeLessThan(12);
    expect(button.right).toBeCloseTo(right, 0);
  });

  it("moves the action under the title, at the end, before it squeezes the title", async () => {
    const line = await oneLineTitle();
    const pill = rect(mark(await laidOut(900))!).width;
    const el = await laidOut(Math.ceil(line.width + pill + 32 + 16));
    const { title: words, mark: drawn, button, right } = parts(el);
    expect(words.height).toBeCloseTo(line.height, 0);
    expect(drawn.top).toBeLessThan(words.bottom);
    expect(drawn.right).toBeCloseTo(right, 0);
    expect(button.top).toBeGreaterThanOrEqual(words.bottom);
    expect(button.right).toBeCloseTo(right, 0);
    expect(button.height).toBeGreaterThanOrEqual(44);
    expect(apart(drawn, button)).toBe(true);
  });

  it("in a narrow column keeps the mark beside the title, which keeps at least half the width", async () => {
    const el = await laidOut(317);
    const { title: words, mark: pill, button, right } = parts(el);
    const content = 317 - 32;
    expect(pill.top).toBeLessThan(words.bottom);
    expect(pill.right).toBeCloseTo(right, 0);
    expect(words.width).toBeGreaterThanOrEqual(content / 2);
    expect(button.top).toBeGreaterThanOrEqual(Math.max(words.bottom, pill.bottom));
    expect(button.right).toBeCloseTo(right, 0);
  });

  it("keeps the title at least --wt-course-heading-title-min-width wide, moving the mark under it", async () => {
    const el = await laidOut(317);
    const before = parts(el);
    expect(before.mark.top).toBeLessThan(before.title.bottom);
    expect(before.title.width).toBeLessThan(250);
    el.style.setProperty("--wt-course-heading-title-min-width", "250px");
    const { title: words, mark: pill } = parts(el);
    expect(words.width).toBeGreaterThanOrEqual(250);
    expect(pill.top).toBeGreaterThanOrEqual(words.bottom);
  });

  it("gives a title too long for one line the whole width, with the mark and action under it", async () => {
    const el = await laidOut(220);
    const { title: words, mark: pill, button, right } = parts(el);
    expect(words.right).toBeLessThanOrEqual(right + 0.5);
    expect(right - words.left).toBeGreaterThan(220 - 32 - 1);
    expect(pill.top).toBeGreaterThanOrEqual(words.bottom);
    expect(pill.right).toBeLessThanOrEqual(right + 0.5);
    expect(button.right).toBeLessThanOrEqual(right + 0.5);
    expect(apart(pill, button)).toBe(true);
    expect(apart(words, button)).toBe(true);
  });

  it.each([300, 390, 480, 600])(
    "never lets the action cover the mark or the title at %ipx",
    async (width) => {
      const el = await laidOut(width);
      const { title: words, mark: pill, button, right } = parts(el);
      expect(apart(pill, button)).toBe(true);
      expect(apart(words, button)).toBe(true);
      expect(apart(words, pill)).toBe(true);
      expect(Math.max(pill.right, button.right, words.right)).toBeLessThanOrEqual(right + 0.5);
    },
  );

  it("puts the mark at the end of the line when there is no action", async () => {
    const el = await mount(
      '<wt-course-heading mark="sent" mark-label="Sent" style="width: 600px">Drinks</wt-course-heading>',
    );
    const right = rect(el).right - parseFloat(getComputedStyle(el).paddingRight);
    expect(rect(mark(el)!).right).toBeCloseTo(right, 0);
  });
});
