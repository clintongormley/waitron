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

describe("laying out a title, the mark and an action", () => {
  const title = "Sharing plates · marchado hace 8 min";
  const rect = (el: Element) => el.getBoundingClientRect();
  const titleBox = (el: Element) => heading(el).querySelector<HTMLElement>(".title")!;
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
  async function settled(el: Element) {
    for (let frame = 0; frame < 2; frame++)
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    await (el as WtCourseHeading).updateComplete;
  }
  async function laidOut(width: number, words = title) {
    const el = await mount(
      `<wt-course-heading mark="sent" mark-label="Enviado" style="width: ${width}px">${words}<wt-button slot="end">Servir todo</wt-button></wt-course-heading>`,
    );
    await (el.querySelector("wt-button") as HTMLElement & { updateComplete: Promise<unknown> })
      .updateComplete;
    await settled(el);
    return el;
  }
  /** The title's width on one line, and the width the mark, the gap and the action take. */
  async function widths() {
    const el = await laidOut(2000);
    const { title: words, mark: pill, button } = parts(el);
    return { line: lines(el)[0]!, words: words.width, end: button.right - pill.left };
  }
  const apart = (a: DOMRect, b: DOMRect) =>
    a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top;
  const sameLine = (a: DOMRect, b: DOMRect) => a.top < b.bottom && b.top < a.bottom;

  it("keeps everything on one line, the mark just before the action, when there is room", async () => {
    const el = await laidOut(900);
    el.style.setProperty("--wt-space-2", "8px");
    const { title: words, mark: pill, button, left, right } = parts(el);
    expect(el.hasAttribute("stacked")).toBe(false);
    expect(lines(el)).toHaveLength(1);
    expect(words.left).toBeCloseTo(left, 0);
    expect(sameLine(words, pill)).toBe(true);
    expect(sameLine(pill, button)).toBe(true);
    expect(button.left - pill.right).toBeCloseTo(8, 0);
    expect(button.right).toBeCloseTo(right, 0);
  });

  it("wraps the title onto two balanced lines before moving the mark and action", async () => {
    const { line, end } = await widths();
    const el = await laidOut(Math.ceil(line * 0.85 + end + 8 + 32));
    const { title: words, mark: pill, button, right } = parts(el);
    const drawn = lines(el);
    expect(el.hasAttribute("stacked")).toBe(false);
    expect(drawn).toHaveLength(2);
    expect(Math.min(...drawn) / Math.max(...drawn)).toBeGreaterThan(0.6);
    expect(sameLine(words, pill)).toBe(true);
    expect(sameLine(pill, button)).toBe(true);
    expect(pill.top).toBeLessThan(words.bottom);
    expect(button.right).toBeCloseTo(right, 0);
    expect(apart(words, pill)).toBe(true);
  });

  it("moves the mark and action together under the title, at the right, when the title would need a third line", async () => {
    const { line, end } = await widths();
    const el = await laidOut(Math.floor(line * 0.4 + end + 8 + 32));
    el.style.setProperty("--wt-space-2", "8px");
    const { title: words, mark: pill, button, left, right } = parts(el);
    expect(el.hasAttribute("stacked")).toBe(true);
    expect(lines(el).length).toBeLessThanOrEqual(2);
    expect(words.left).toBeCloseTo(left, 0);
    expect(words.right).toBeCloseTo(right, 0);
    expect(pill.top).toBeGreaterThanOrEqual(words.bottom);
    expect(button.top).toBeGreaterThanOrEqual(words.bottom);
    expect(sameLine(pill, button)).toBe(true);
    expect(button.left - pill.right).toBeCloseTo(8, 0);
    expect(button.right).toBeCloseTo(right, 0);
  });

  it("moves the mark and action back beside the title when the heading widens", async () => {
    const el = await laidOut(240);
    expect(el.hasAttribute("stacked")).toBe(true);
    (el as HTMLElement).style.width = "900px";
    await settled(el);
    expect(el.hasAttribute("stacked")).toBe(false);
    const { title: words, button } = parts(el);
    expect(sameLine(words, button)).toBe(true);
  });

  it("moves the mark and action under the title when its words grow past two lines", async () => {
    const el = await laidOut(390, "Drinks");
    expect(el.hasAttribute("stacked")).toBe(false);
    el.firstChild!.textContent = `${title} · ${title}`;
    await settled(el);
    expect(el.hasAttribute("stacked")).toBe(true);
    expect(parts(el).button.top).toBeGreaterThanOrEqual(parts(el).title.bottom);
  });

  it.each([300, 390, 480, 600])(
    "never overlaps the title, the mark and the action, and never draws three title lines beside them, at %ipx",
    async (width) => {
      const el = await laidOut(width);
      const { title: words, mark: pill, button, right } = parts(el);
      expect(apart(pill, button)).toBe(true);
      expect(apart(words, button)).toBe(true);
      expect(apart(words, pill)).toBe(true);
      expect(sameLine(pill, button)).toBe(true);
      expect(Math.max(pill.right, button.right, words.right)).toBeLessThanOrEqual(right + 0.5);
      expect(button.right).toBeCloseTo(right, 0);
      if (el.hasAttribute("stacked")) expect(pill.top).toBeGreaterThanOrEqual(words.bottom);
      else expect(lines(el).length).toBeLessThanOrEqual(2);
    },
  );

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

  describe.each([
    "Drinks\u00a0· Fired\u00a05\u00a0min\u00a0ago",
    "Drinks\u00a0· Marchado\u00a0hace\u00a06\u00a0min",
  ])("with a time phrase that cannot break, %j", (words) => {
    it.each(Array.from({ length: 26 }, (_, step) => 250 + step * 10))(
      "draws the title's letters clear of the mark and the action, inside the heading, at %ipx",
      async (width) => {
        const el = await laidOut(width, words);
        const { title: box, mark: pill, button, left, right } = parts(el);
        const ink = inked(el);
        expect(apart(ink, pill)).toBe(true);
        expect(apart(ink, button)).toBe(true);
        expect(apart(pill, button)).toBe(true);
        expect(sameLine(pill, button)).toBe(true);
        expect(ink.left).toBeGreaterThanOrEqual(left - 0.5);
        expect(ink.right - drawn(el).blank).toBeLessThanOrEqual(Math.min(box.right, right) + 0.5);
        expect(button.right).toBeCloseTo(right, 0);
        expect(lines(el).length).toBeLessThanOrEqual(2);
      },
    );

    /** Where the time phrase's last letter's ink ends, and the blank after it to the end of the
     * phrase's box: the letter-spacing and the letter's side bearing. */
    function drawn(el: Element) {
      const style = getComputedStyle(heading(el));
      const pen = document.createElement("canvas").getContext("2d")!;
      pen.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      pen.letterSpacing = style.letterSpacing;
      const phrase = pen.measureText(words.split(" ").at(-1)!.toUpperCase());
      return {
        right: phrase.actualBoundingBoxRight,
        blank: phrase.width - phrase.actualBoundingBoxRight,
      };
    }
    /** The heading width at which the phrase's letters just fit beside the mark and the action. */
    async function fit() {
      const el = await laidOut(2000, words);
      expect(drawn(el).blank).toBeGreaterThan(0.6);
      return 2000 - parts(el).title.width + drawn(el).right;
    }
    function besideOnTwoLines(el: Element) {
      const { title: box, mark: pill, button } = parts(el);
      const ink = inked(el);
      expect(el.hasAttribute("stacked")).toBe(false);
      expect(lines(el)).toHaveLength(2);
      expect(sameLine(box, pill)).toBe(true);
      expect(sameLine(pill, button)).toBe(true);
      expect(pill.top).toBeLessThan(box.bottom);
      expect(apart(ink, pill)).toBe(true);
      expect(apart(ink, button)).toBe(true);
    }

    it("keeps the mark and the action beside a two-line title when the phrase's letters just fit", async () => {
      besideOnTwoLines(await laidOut((await fit()) + 0.1, words));
      besideOnTwoLines(await laidOut((await fit()) + 6, words));
    });

    it("moves the mark and the action down when the phrase's letters do not fit", async () => {
      const el = await laidOut((await fit()) - 1.5, words);
      expect(el.hasAttribute("stacked")).toBe(true);
      expect(parts(el).mark.top).toBeGreaterThanOrEqual(parts(el).title.bottom);
    });

    it("moves the mark and the action down when the phrase's letters do not fit, though white space follows them", async () => {
      const el = await laidOut((await fit()) - 1.5, `${words}\n    `);
      expect(el.hasAttribute("stacked")).toBe(true);
    });

    it("moves the mark and the action back beside the title when widened to where it fits, and down again when narrowed", async () => {
      const just = await fit();
      const el = await laidOut(just - 40, words);
      expect(el.hasAttribute("stacked")).toBe(true);
      (el as HTMLElement).style.width = `${just + 0.1}px`;
      await settled(el);
      besideOnTwoLines(el);
      (el as HTMLElement).style.width = `${just - 1.5}px`;
      await settled(el);
      expect(el.hasAttribute("stacked")).toBe(true);
    });
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
