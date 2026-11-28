import { afterEach, describe, expect, it } from "vitest";
import { cdp } from "vitest/browser";
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

it("draws the sent mark as a tick before its word, and reads its word as part of the heading", async () => {
  const el = await mount(
    '<wt-course-heading mark="sent" mark-label="Sent">Drinks</wt-course-heading>',
  );
  const pill = mark(el)!;
  expect(pill.getAttribute("aria-hidden")).toBe("true");
  expect(heading(el).textContent!.trim()).toBe("Sent");
  expect(heading(el).querySelector(".visually-hidden")!.textContent).toBe("Sent");
  const icon = pill.querySelector("wt-icon")!;
  expect(icon.getAttribute("name")).toBe("check");
  expect(icon.getAttribute("aria-hidden")).toBe("true");
  expect(pill.textContent!.trim()).toBe("Sent");
  expect(icon.compareDocumentPosition(pill.querySelector("span")!)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
});

it("is named by its title and then the mark's word, as the browser reads it", async () => {
  await mount(
    '<wt-course-heading mark="sent" mark-label="Sent">Drinks<button slot="end">Serve all</button></wt-course-heading>',
  );
  const session = cdp();
  const frames = (await session.send("Page.getFrameTree" as never)) as {
    frameTree: { childFrames: { frame: { id: string } }[] };
  };
  const tree = (await session.send(
    "Accessibility.getFullAXTree" as never,
    { frameId: frames.frameTree.childFrames[0]!.frame.id } as never,
  )) as { nodes: { role?: { value: string }; name?: { value: string } }[] };
  const names = tree.nodes
    .filter((node) => node.role?.value === "heading")
    .map((node) => node.name?.value);
  expect(names).toEqual(["DRINKS Sent"]);
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
  el.style.setProperty("--wt-font-weight-bold", "800");
  el.style.setProperty("--wt-radius-full", "77px");
  el.style.setProperty("--wt-space-1", "1px");
  el.style.setProperty("--wt-space-2", "2px");
  const pill = getComputedStyle(mark(el)!);
  expect(pill.backgroundColor).toBe("rgb(7, 8, 9)");
  expect(pill.color).toBe("rgb(10, 11, 12)");
  expect(pill.fontSize).toBe("11px");
  expect(pill.fontWeight).toBe("800");
  expect(pill.borderTopLeftRadius).toBe("77px");
  expect([pill.paddingTop, pill.paddingRight]).toEqual(["1px", "2px"]);
  expect(pill.textTransform).toBe("none");
  expect(pill.letterSpacing).toBe("normal");
  expect(getComputedStyle(mark(el)!.querySelector("wt-icon")!).color).toBe("rgb(13, 14, 15)");
});

describe("laying out a title, the mark and an action", () => {
  const title = "Sharing plates · fired\u00a08\u00a0minutes\u00a0ago";
  const rect = (el: Element) => el.getBoundingClientRect();
  const titleBox = (el: Element) => heading(el);
  const parts = (el: Element) => {
    const style = getComputedStyle(el);
    return {
      title: rect(titleBox(el)),
      mark: rect(mark(el)!),
      button: rect(el.querySelector("wt-button")!),
      left: rect(el).left + parseFloat(style.paddingLeft),
      right: rect(el).right - parseFloat(style.paddingRight),
    };
  };
  /** The title's text, line by line: each line's width, by the text's own boxes. */
  function lines(el: Element): number[] {
    const words = document.createRange();
    words.selectNodeContents(el.firstChild!);
    const tops: { top: number; width: number }[] = [];
    for (const box of words.getClientRects()) {
      if (box.width === 0) continue;
      const line = tops.find((each) => Math.abs(each.top - box.top) < 2);
      if (line) line.width += box.width;
      else tops.push({ top: box.top, width: box.width });
    }
    return tops.map((line) => line.width);
  }
  /** Where the title's letters are drawn, which is wider than its box when they overflow it. */
  function inked(el: Element): DOMRect {
    const words = document.createRange();
    words.selectNodeContents(el.firstChild!);
    const boxes = [...words.getClientRects()].filter((box) => box.width > 0);
    const left = Math.min(...boxes.map((box) => box.left));
    const top = Math.min(...boxes.map((box) => box.top));
    const right = Math.max(...boxes.map((box) => box.right));
    const bottom = Math.max(...boxes.map((box) => box.bottom));
    return new DOMRect(left, top, right - left, bottom - top);
  }
  async function laidOut(width: number, words = title) {
    const el = await mount(
      `<wt-course-heading mark="sent" mark-label="Ordered" style="width: ${width}px">${words}<wt-button slot="end">Serve course</wt-button></wt-course-heading>`,
    );
    await (el.querySelector("wt-button") as HTMLElement & { updateComplete: Promise<unknown> })
      .updateComplete;
    for (let frame = 0; frame < 2; frame++)
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    return el;
  }
  const apart = (a: DOMRect, b: DOMRect) =>
    a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
  const sameLine = (a: DOMRect, b: DOMRect) => a.top < b.bottom && b.top < a.bottom;

  it("keeps everything on one line, the mark just before the action at the right, when there is room", async () => {
    const el = await laidOut(900);
    el.style.setProperty("--wt-space-2", "8px");
    const { title: words, mark: pill, button, left, right } = parts(el);
    expect(lines(el)).toHaveLength(1);
    expect(words.left).toBeCloseTo(left, 0);
    expect(sameLine(words, pill)).toBe(true);
    expect(sameLine(pill, button)).toBe(true);
    expect(button.left - pill.right).toBeCloseTo(8, 0);
    expect(button.right).toBeCloseTo(right, 0);
  });

  it("moves the mark and action together onto their own line under the title, at the right, when they do not fit beside it", async () => {
    // 300, not narrower: CI's fonts draw this mark and action about 4px wider than a Mac's.
    const el = await laidOut(300);
    el.style.setProperty("--wt-space-2", "8px");
    el.style.setProperty("--wt-space-3", "12px");
    const { title: words, mark: pill, button, left, right } = parts(el);
    expect(words.left).toBeCloseTo(left, 0);
    expect(words.right).toBeCloseTo(right, 0);
    expect(pill.top).toBeGreaterThanOrEqual(words.bottom);
    expect(button.top).toBeGreaterThanOrEqual(words.bottom);
    expect(sameLine(pill, button)).toBe(true);
    expect(button.left - pill.right).toBeCloseTo(8, 0);
    expect(button.right).toBeCloseTo(right, 0);
    const end = rect(el.shadowRoot!.querySelector(".end")!);
    expect(end.top - words.bottom).toBeCloseTo(12, 0);
  });

  it("balances a title that takes two lines of its own", async () => {
    const el = await laidOut(270);
    const drawn = lines(el);
    expect(drawn).toHaveLength(2);
    expect(Math.min(...drawn) / Math.max(...drawn)).toBeGreaterThan(0.6);
  });

  it("moves the mark and action back beside the title when the heading widens", async () => {
    const el = (await laidOut(240)) as HTMLElement;
    expect(parts(el).button.top).toBeGreaterThanOrEqual(parts(el).title.bottom);
    el.style.width = "900px";
    const { title: words, button } = parts(el);
    expect(sameLine(words, button)).toBe(true);
  });

  it.each([300, 390, 480, 600])(
    "never overlaps the title, the mark and the action, or draws past the heading, at %ipx",
    async (width) => {
      const el = await laidOut(width);
      const { title: words, mark: pill, button, left, right } = parts(el);
      const ink = inked(el);
      expect(apart(pill, button)).toBe(true);
      expect(apart(ink, button)).toBe(true);
      expect(apart(ink, pill)).toBe(true);
      expect(sameLine(pill, button)).toBe(true);
      expect(ink.left).toBeGreaterThanOrEqual(left - 0.5);
      expect(Math.max(pill.right, button.right, words.right)).toBeLessThanOrEqual(right + 0.5);
      expect(button.right).toBeCloseTo(right, 0);
    },
  );

  describe.each([
    "Drinks\u00a0· Fired\u00a05\u00a0min\u00a0ago",
    "Sharing plates · fired\u00a08\u00a0minutes\u00a0ago",
  ])("with a time phrase that cannot break, %j", (words) => {
    it.each([200, 250, 300, 390, 480])("keeps the phrase on one line at %ipx", async (width) => {
      const el = await laidOut(width, words);
      const phrase = document.createRange();
      phrase.setStart(el.firstChild!, words.lastIndexOf(" ") + 1);
      phrase.setEnd(el.firstChild!, words.length);
      const tops = new Set(
        [...phrase.getClientRects()]
          .filter((box) => box.width > 0)
          .map((box) => Math.round(box.top)),
      );
      expect(tops.size).toBe(1);
    });
  });

  it("breaks a name too long for the whole row, keeping its letters inside the heading", async () => {
    const el = await laidOut(250, "Charcuterieandcheeseboards · fired 8 min ago");
    const { title: words, button, left, right } = parts(el);
    const ink = inked(el);
    expect(button.top).toBeGreaterThanOrEqual(words.bottom);
    expect(ink.left).toBeGreaterThanOrEqual(left - 0.5);
    expect(ink.right).toBeLessThanOrEqual(right + 0.5);
  });

  it("is as tall as the mark and its own padding on one line with no action", async () => {
    const el = await mount(
      '<wt-course-heading mark="sent" mark-label="Sent" style="width: 600px">Drinks · fired 12 min ago</wt-course-heading>',
    );
    el.style.setProperty("--wt-space-3", "12px");
    el.style.setProperty("--wt-course-heading-padding-bottom", "6px");
    expect(rect(el).height).toBeCloseTo(12 + rect(mark(el)!).height + 6, 0);
  });

  it("balances the title's lines", async () => {
    const el = await mount("<wt-course-heading>Mains</wt-course-heading>");
    expect(getComputedStyle(titleBox(el)).textWrapStyle).toBe("balance");
  });

  it("puts the mark at the end of the line when there is no action", async () => {
    const el = await mount(
      '<wt-course-heading mark="sent" mark-label="Sent" style="width: 600px">Drinks</wt-course-heading>',
    );
    const right = rect(el).right - parseFloat(getComputedStyle(el).paddingRight);
    expect(rect(mark(el)!).right).toBeCloseTo(right, 0);
  });

  it("puts the action at the end of the line when there is no mark", async () => {
    const el = await mount(
      '<wt-course-heading style="width: 600px">Mains · Held<wt-button slot="end">Fire</wt-button></wt-course-heading>',
    );
    const right = rect(el).right - parseFloat(getComputedStyle(el).paddingRight);
    const button = rect(el.querySelector("wt-button")!);
    expect(button.right).toBeCloseTo(right, 0);
    expect(sameLine(rect(titleBox(el)), button)).toBe(true);
  });
});
