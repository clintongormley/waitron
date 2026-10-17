import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import { DEPARTMENTS, holiday, monthModel } from "../testing/opening-hours-month-fixture.js";
import { emptyPageAtTop, resizeViewport } from "../testing/window-settled.js";
import type { CalendarDayBox } from "./calendar-day-box.js";
import "./calendar-day-box.js";
import "./opening-hours-month.js";
import "./opening-hours-week.js";

const HOLIDAY = "Fiesta Nacional de España";
const LONG_WORD = "Supercalifragilisticexpialidocious";

const hosts: HTMLElement[] = [];
afterEach(async () => {
  await emptyPageAtTop(() => {
    for (const host of hosts.splice(0)) host.remove();
  });
  setLocale("en");
  document.documentElement.removeAttribute("lang");
  await resizeViewport(1280, 800);
});

function model() {
  const base = monthModel();
  return {
    ...base,
    days: base.days.map((day) =>
      day.date === "2026-12-08"
        ? { ...day, holidays: [holiday(day.date, HOLIDAY)] }
        : day.date === "2026-12-14"
          ? { ...day, specialDay: { id: "company", name: LONG_WORD } }
          : day,
    ),
  };
}

async function mount<T extends HTMLElement & { updateComplete: Promise<boolean> }>(
  tag: string,
  props: object,
): Promise<T> {
  const el = document.createElement(tag) as T;
  Object.assign(el, props);
  applyTokens(el);
  document.body.append(el);
  hosts.push(el);
  await el.updateComplete;
  return el;
}

/** Each word of `name`'s text, with the tops of the line boxes it was drawn on. */
function wordLines(name: Element) {
  const words: { word: string; tops: number[] }[] = [];
  const walker = document.createTreeWalker(name, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    for (const match of node.textContent!.matchAll(/\S+/g)) {
      const range = document.createRange();
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);
      const tops = [...range.getClientRects()].map((rect) => Math.round(rect.top));
      words.push({ word: match[0], tops: [...new Set(tops)] });
    }
  }
  return words;
}

/** Holds every drawn name to whole words: none split across lines, and a word too wide for its
 *  place cut with an ellipsis while the name's title keeps it whole. Returns the cut words. */
function expectWholeWords(names: Element[]): string[] {
  expect(names.length).toBeGreaterThan(0);
  const cut: string[] = [];
  for (const name of names) {
    const words = wordLines(name);
    expect(words.length, name.textContent!).toBeGreaterThan(0);
    for (const { word, tops } of words) expect(tops, word).toHaveLength(1);
    for (const box of [name, ...name.querySelectorAll("*")]) {
      if (box.scrollWidth <= box.clientWidth) continue;
      expect(getComputedStyle(box).textOverflow, box.textContent!).toBe("ellipsis");
      expect(name.getAttribute("title")).toBe(name.textContent!.replace(/\s+/g, " ").trim());
      cut.push(box.textContent!.trim());
    }
  }
  return cut;
}

describe.each(["en", "es"] as const)("a day's name at a phone's width (%s)", (locale) => {
  async function phone() {
    setLocale(locale);
    // With the page's language declared, Chromium hyphenates where it has that language's
    // dictionary (local macOS headless Chromium, measured: Spanish yes, English no), so a rule
    // letting a name hyphenate can show here.
    document.documentElement.lang = locale;
    await resizeViewport(390, 800);
    expect(window.innerWidth).toBe(390);
  }

  it("the Month breaks a name only between words, cutting a word too wide for its date", async () => {
    await phone();
    const el = await mount("opening-hours-month", { model: model(), departments: DEPARTMENTS });
    const name = (date: string) =>
      el.shadowRoot!.querySelector(`[data-date="${date}"] [data-test="name"]`)!;
    expect(name("2026-12-08").textContent!.replace(/\s+/g, " ").trim()).toBe(HOLIDAY);
    const cut = expectWholeWords([...el.shadowRoot!.querySelectorAll('[data-test="name"]')]);
    expect(cut).toContain(LONG_WORD);
    expect(name("2026-12-14").getAttribute("title")).toBe(LONG_WORD);
    expect(name("2026-12-08").getAttribute("title")).toBe(HOLIDAY);
  });

  it("the Week's day on a phone breaks its names only between words", async () => {
    await phone();
    for (const date of ["2026-12-08", "2026-12-14"]) {
      const el = await mount("opening-hours-week", {
        model: model(),
        date,
        departments: DEPARTMENTS,
      });
      const names = [...el.shadowRoot!.querySelectorAll(".day-names .name")];
      expect(names.map((n) => n.textContent!.replace(/\s+/g, " ").trim())).toEqual([
        date === "2026-12-08" ? HOLIDAY : LONG_WORD,
      ]);
      expectWholeWords(names);
      el.remove();
    }
  });

  it("the day box breaks its name only between words", async () => {
    await phone();
    const anchor = document.createElement("button");
    anchor.textContent = "12";
    document.body.append(anchor);
    hosts.push(anchor);
    for (const name of [HOLIDAY, LONG_WORD]) {
      const box = await mount<CalendarDayBox>("calendar-day-box", {
        heading: locale === "es" ? "sáb, 12 oct 2026" : "Sat, 12 Oct 2026",
        name,
        nameKind: "holiday",
      });
      box.show(anchor);
      expectWholeWords([box.shadowRoot!.querySelector('[data-test="name"]')!]);
      box.remove();
    }
  });
});

describe("a word wider than its place", () => {
  function weekWith(word: string) {
    const base = model();
    return mount("opening-hours-week", {
      model: {
        ...base,
        days: base.days.map((day) =>
          day.date === "2026-12-14" ? { ...day, specialDay: { id: "company", name: word } } : day,
        ),
      },
      date: "2026-12-14",
      departments: DEPARTMENTS,
    });
  }

  it("in the Week's phone day is cut with an ellipsis and kept whole in the name's title", async () => {
    await resizeViewport(390, 800);
    const word = LONG_WORD.repeat(3);
    const el = await weekWith(word);
    const names = [...el.shadowRoot!.querySelectorAll(".day-names .name")];
    expect(expectWholeWords(names)).toEqual([word]);
    expect(names[0]!.getBoundingClientRect().right).toBeLessThanOrEqual(390);
  });

  it("in the wide Week's day heading is cut with an ellipsis and kept whole in the name's title", async () => {
    await resizeViewport(1280, 800);
    expect(window.innerWidth).toBe(1280);
    const word = LONG_WORD.repeat(8);
    const el = await weekWith(word);
    const names = [...el.shadowRoot!.querySelectorAll('section[data-date="2026-12-14"] h3 .name')];
    expect(expectWholeWords(names)).toEqual([word]);
    expect(names[0]!.getAttribute("title")).toBe(word);
  });

  it("is shown whole in the day box, carried onto as many lines as it needs", async () => {
    await resizeViewport(390, 800);
    const word = LONG_WORD.repeat(3);
    const anchor = document.createElement("button");
    anchor.textContent = "14";
    document.body.append(anchor);
    hosts.push(anchor);
    const box = await mount<CalendarDayBox>("calendar-day-box", {
      heading: "Mon, 14 Dec 2026",
      name: word,
      nameKind: "special",
    });
    box.show(anchor);
    const popover = box.shadowRoot!.querySelector("[popover]")!;
    const name = box.shadowRoot!.querySelector('[data-test="name"]')!;
    expect(name.textContent!.trim()).toBe(word);
    for (const el of [name, ...name.querySelectorAll("*")])
      expect(el.scrollWidth, el.textContent!).toBeLessThanOrEqual(el.clientWidth || el.scrollWidth);
    const [{ tops }] = wordLines(name);
    expect(tops.length).toBeGreaterThan(1);
    const edge =
      popover.getBoundingClientRect().right - parseFloat(getComputedStyle(popover).paddingRight);
    const range = document.createRange();
    range.selectNodeContents(name);
    for (const rect of range.getClientRects()) expect(rect.right).toBeLessThanOrEqual(edge + 0.5);
  });
});
