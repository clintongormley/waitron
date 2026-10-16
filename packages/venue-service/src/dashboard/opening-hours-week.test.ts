import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import type { OpeningHoursMonth } from "../opening-hours-calendar.js";
import type { LocalDate } from "../hours-types.js";
import { addDays, weekdayOf } from "../hours-rules.js";
import { DEPARTMENTS, monthModel } from "../testing/opening-hours-month-fixture.js";
import type { CalendarDayOpen } from "./opening-hours-month.js";
import type { OpeningHoursWeekView } from "./opening-hours-week.js";
import "./opening-hours-week.js";

const hosts: HTMLElement[] = [];
beforeEach(async () => {
  setLocale("en");
  await page.viewport(1280, 800);
  expect(window.innerWidth).toBe(1280);
});
afterEach(async () => {
  await commands.parkPointer();
  for (const host of hosts.splice(0)) host.remove();
  window.scrollTo(0, 0);
  setLocale("en");
});

async function mount(extra: Partial<OpeningHoursWeekView> = {}): Promise<OpeningHoursWeekView> {
  const el = document.createElement("opening-hours-week");
  Object.assign(el, {
    model: monthModel(),
    date: "2026-12-02",
    departments: DEPARTMENTS,
    ...extra,
  });
  applyTokens(el);
  document.body.append(el);
  hosts.push(el);
  await el.updateComplete;
  return el;
}

const root = (el: OpeningHoursWeekView) => el.shadowRoot!;
const text = (node: Element | null | undefined) =>
  (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const testId = (el: OpeningHoursWeekView, id: string) =>
  root(el).querySelector<HTMLElement>(`[data-test="${id}"]`);
const section = (el: OpeningHoursWeekView, date: LocalDate) =>
  root(el)
    .querySelector<HTMLElement>(`[data-test="day-name"][data-date="${date}"]`)!
    .closest("section")!;
const row = (el: OpeningHoursWeekView, date: LocalDate, key: string) =>
  section(el, date).querySelector<HTMLElement>(`.row[data-row="${key}"]`)!;
const track = (el: OpeningHoursWeekView, date: LocalDate, key: string) =>
  row(el, date, key).querySelector<HTMLElement>(".track")!;
function events<T>(el: OpeningHoursWeekView, name: string): T[] {
  const sent: T[] = [];
  el.addEventListener(name, (event) => sent.push((event as CustomEvent<T>).detail));
  return sent;
}
/** A token's colour as the browser paints it. */
function resolved(el: HTMLElement, token: string): string {
  const probe = document.createElement("div");
  probe.style.background = `var(${token})`;
  applyTokens(probe);
  el.after(probe);
  const colour = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return colour;
}

describe("Opening hours week", () => {
  it("draws the week holding its date, a day per section", async () => {
    const el = await mount();
    const names = [...root(el).querySelectorAll('[data-test="day-name"]')].map(text);
    expect(names).toEqual([
      "Mon 30 Nov",
      "Tue 1 Dec",
      "Wed 2 Dec",
      "Thu 3 Dec",
      "Fri 4 Dec",
      "Sat 5 Dec",
      "Sun 6 Dec",
    ]);
    const sections = [...root(el).querySelectorAll("section")];
    expect(sections).toHaveLength(7);
    for (const s of sections)
      expect([...s.querySelectorAll<HTMLElement>(".row")].map((r) => r.dataset.row)).toEqual([
        "rest",
        "bar",
      ]);
  });

  it("draws the chosen department and its zones, a zone faded where it follows", async () => {
    const el = await mount({ departmentId: "rest" });
    const terrace = track(el, "2026-12-01", "terrace");
    const faded = [...terrace.querySelectorAll<HTMLElement>(".block[data-faded]")];
    expect(faded).toHaveLength(2);
    const disabled = Number(getComputedStyle(el).getPropertyValue("--wt-opacity-disabled").trim());
    expect(disabled).toBeLessThan(1);
    for (const block of faded) {
      expect(text(block)).toBe("");
      expect(Number(getComputedStyle(block).opacity)).toBeCloseTo(disabled, 5);
    }
    const blocks = [...terrace.querySelectorAll<HTMLElement>(".block")];
    const dinner = blocks.find((b) => text(b) === "Dinner 22:00–23:00")!;
    const width = terrace.getBoundingClientRect().width;
    const left = dinner.getBoundingClientRect().left - terrace.getBoundingClientRect().left;
    expect(Math.abs((left / width) * 100 - 66.67)).toBeLessThan(0.1);
    const closed = terrace.querySelector<HTMLElement>('.block[data-kind="closed"]')!;
    expect(getComputedStyle(closed).backgroundImage).toContain("repeating-linear-gradient");
  });

  it("names a special day and a holiday; only a date closed all day says so in its track", async () => {
    const el = await mount({ date: "2026-12-08" });
    expect(text(section(el, "2026-12-08").querySelector(".name.holiday"))).toBe(
      "Immaculate Conception",
    );
    const sunday = track(el, "2026-12-13", "rest");
    expect(sunday.textContent!.trim()).toBe("");
    expect(getComputedStyle(sunday).backgroundColor).toBe(resolved(el, "--wt-color-border"));

    el.date = "2026-12-14";
    await el.updateComplete;
    expect(text(section(el, "2026-12-14").querySelector(".name.special"))).toBe("Company dinners");

    el.date = "2026-12-25";
    await el.updateComplete;
    const christmas = section(el, "2026-12-25");
    expect(text(christmas).split("Christmas Day")).toHaveLength(2);
    expect(text(track(el, "2026-12-25", "rest"))).toBe("Closed all day");

    el.date = "2026-12-02";
    await el.updateComplete;
    const sixth = track(el, "2026-12-06", "rest");
    expect(sixth.textContent!.trim()).toBe("");
    expect(getComputedStyle(sixth).backgroundColor).toBe(resolved(el, "--wt-color-border"));
  });

  it("speaks each row whole", async () => {
    const el = await mount({ departmentId: "rest" });
    expect(text(row(el, "2026-12-01", "terrace").querySelector(".spoken"))).toBe(
      "Terrace: Breakfast 08:00–11:00 · Lunch 13:00–16:00 · Dinner 22:00–23:00 · closed 20:00–22:00",
    );
    expect(text(row(el, "2026-12-06", "rest").querySelector(".spoken"))).toBe("Restaurant: Closed");
    const tracks = [...root(el).querySelectorAll(".track")];
    expect(tracks.length).toBeGreaterThan(0);
    for (const t of tracks) expect(t.getAttribute("aria-hidden")).toBe("true");
  });

  it("steps a week each way", async () => {
    const el = await mount();
    const sent = events<{ date: LocalDate }>(el, "week-change");
    testId(el, "next-week")!.click();
    testId(el, "previous-week")!.click();
    expect(sent).toEqual([{ date: "2026-12-09" }, { date: "2026-11-25" }]);

    let monday = "0100-02-01";
    while (weekdayOf(monday) !== 1) monday = addDays(monday, 1);
    expect(monday.slice(0, 7)).toBe("0100-02");
    expect(weekdayOf(monday)).toBe(1);
    el.model = undefined;
    el.date = monday;
    await el.updateComplete;
    expect(testId(el, "previous-week")!.hasAttribute("disabled")).toBe(true);
    expect(testId(el, "next-week")!.hasAttribute("disabled")).toBe(false);
    await userEvent.click(testId(el, "previous-week")!, { force: true });
    testId(el, "previous-week")!.click();
    expect(sent).toHaveLength(2);
  });

  it("the title links to its months and years", async () => {
    const el = await mount({ model: undefined, date: "2027-01-02" });
    expect(text(testId(el, "week"))).toBe("28 Dec 2026 – 3 Jan 2027");
    const months = [...root(el).querySelectorAll<HTMLElement>('[data-test="week-month"]')];
    const years = [...root(el).querySelectorAll<HTMLElement>('[data-test="week-year"]')];
    expect(months.map((m) => [text(m), m.dataset.month])).toEqual([
      ["Dec", "2026-12"],
      ["Jan", "2027-01"],
    ]);
    expect(years.map((y) => [text(y), y.dataset.year])).toEqual([
      ["2026", "2026"],
      ["2027", "2027"],
    ]);
    const monthSent = events<{ month: string }>(el, "week-month-open");
    const yearSent = events<{ year: number }>(el, "week-year-open");
    await userEvent.click(months[1]!);
    await userEvent.click(years[0]!);
    expect(monthSent).toEqual([{ month: "2027-01" }]);
    expect(yearSent).toEqual([{ year: 2026 }]);

    el.date = "2026-10-14";
    await el.updateComplete;
    const oneMonth = [...root(el).querySelectorAll<HTMLElement>('[data-test="week-month"]')];
    const oneYear = [...root(el).querySelectorAll<HTMLElement>('[data-test="week-year"]')];
    expect(oneMonth.map((m) => m.dataset.month)).toEqual(["2026-10"]);
    expect(oneYear.map((y) => y.dataset.year)).toEqual(["2026"]);
    await userEvent.click(oneMonth[0]!);
    await userEvent.click(oneYear[0]!);
    expect(monthSent.at(-1)).toEqual({ month: "2026-10" });
    expect(yearSent.at(-1)).toEqual({ year: 2026 });
    for (const link of [...oneMonth, ...oneYear]) {
      const hint = root(el).getElementById(link.getAttribute("aria-describedby")!);
      expect(text(hint)).toBe(link === oneMonth[0] ? "Whole month" : "Whole year");
    }
  });

  it("the title keeps one width", async () => {
    let monday = "2026-01-01";
    while (weekdayOf(monday) !== 1) monday = addDays(monday, 1);
    const mondays: LocalDate[] = [];
    for (; monday < "2027-01-01"; monday = addDays(monday, 7)) mondays.push(monday);
    expect(mondays).toHaveLength(52);
    const dates = [...mondays, "2011-05-02", "2088-05-03"];
    const lefts: [string, number][] = [];
    try {
      for (const locale of ["en", "es"] as const) {
        setLocale(locale);
        const el = await mount({ model: undefined });
        for (const date of dates) {
          el.date = date;
          await el.updateComplete;
          lefts.push([`${locale} ${date}`, testId(el, "next-week")!.getBoundingClientRect().left]);
        }
      }
    } finally {
      setLocale("en");
    }
    for (const [shown, left] of lefts)
      expect(Math.abs(left - lefts[0]![1]), shown).toBeLessThanOrEqual(0.5);
  });

  it("a day's name sends calendar-day-open", async () => {
    const el = await mount({ date: "2026-12-09" });
    const sent = events<CalendarDayOpen>(el, "calendar-day-open");
    const name = root(el).querySelector<HTMLElement>(
      '[data-test="day-name"][data-date="2026-12-09"]',
    )!;
    await userEvent.click(name);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.date).toBe("2026-12-09");
    expect(sent[0]!.returnTo()).toBe(name);
  });

  it("Show changes the department", async () => {
    const el = await mount();
    const sent = events<{ departmentId: string }>(el, "week-department-change");
    const show = () => root(el).querySelector("wt-combobox")!;
    const choose = (value: string) =>
      show().dispatchEvent(
        new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
      );
    choose("bar");
    el.departmentId = "bar";
    await el.updateComplete;
    choose("all");
    expect(sent).toEqual([{ departmentId: "bar" }, { departmentId: "" }]);

    el.departmentId = "gone";
    await el.updateComplete;
    expect(show().value).toBe("all");
    expect(
      [...section(el, "2026-12-02").querySelectorAll<HTMLElement>(".row")].map(
        (r) => r.dataset.row,
      ),
    ).toEqual(["rest", "bar"]);
  });

  it("draws only the head until its week's read arrives", async () => {
    const el = await mount({ model: undefined });
    expect(testId(el, "previous-week")).not.toBeNull();
    expect(testId(el, "week")).not.toBeNull();
    expect(testId(el, "next-week")).not.toBeNull();
    expect(root(el).querySelector("section")).toBeNull();
  });

  it("a 25-hour day's bars and the ruler share one scale", async () => {
    const model: OpeningHoursMonth = monthModel();
    model.days = model.days.map((d) =>
      d.date === "2026-12-02"
        ? {
            ...d,
            endMinute: 1500,
            departments: d.departments.map((dep) =>
              dep.departmentId === "bar"
                ? { ...dep, ranges: [{ periodId: "allday", startsAt: "10:00", endsAt: "07:00" }] }
                : dep,
            ),
          }
        : d,
    );
    const el = await mount({ model, departmentId: "bar" });
    const long = track(el, "2026-12-02", "bar");
    const longBlock = long.querySelector<HTMLElement>(".block")!.getBoundingClientRect();
    expect(Math.abs(longBlock.right - long.getBoundingClientRect().right)).toBeLessThanOrEqual(1);

    const labels = [...root(el).querySelectorAll<HTMLElement>(".ruler .label")];
    const ten = labels.find((label) => text(label) === "10:00")!;
    const block = track(el, "2026-12-03", "bar").querySelector<HTMLElement>(".block")!;
    const centre = (box: DOMRect) => box.left + box.width / 2;
    expect(
      Math.abs(block.getBoundingClientRect().left - centre(ten.getBoundingClientRect())),
    ).toBeLessThanOrEqual(2);

    const ruler = root(el).querySelector<HTMLElement>(".ruler .scale")!.getBoundingClientRect();
    const last = labels.at(-1)!.getBoundingClientRect();
    expect(Math.abs(centre(last) - ruler.left - (ruler.width * 1440) / 1500)).toBeLessThanOrEqual(
      1,
    );
    expect(root(el).querySelector(".ruler")!.getAttribute("aria-hidden")).toBe("true");

    el.model = monthModel();
    await el.updateComplete;
    const atEnd = [...root(el).querySelectorAll<HTMLElement>(".ruler .label")].at(-1)!;
    expect(text(atEnd)).toBe("06:00");
    expect(atEnd.getBoundingClientRect().right).toBeLessThanOrEqual(
      el.getBoundingClientRect().right,
    );
  });
});

/** December's model with the Restaurant's Lunch on 2 December moved to 16:00–17:00. */
function sliverModel(): OpeningHoursMonth {
  const model = monthModel();
  model.days = model.days.map((d) =>
    d.date === "2026-12-02"
      ? {
          ...d,
          departments: d.departments.map((dep) =>
            dep.departmentId === "rest"
              ? {
                  ...dep,
                  ranges: dep.ranges.map((r) =>
                    r.periodId === "lunch" ? { ...r, startsAt: "16:00", endsAt: "17:00" } : r,
                  ),
                }
              : dep,
          ),
        }
      : d,
  );
  return model;
}

const blockSelector = (date: LocalDate, key: string, nth: number) =>
  `opening-hours-week section[data-date="${date}"] .row[data-row="${key}"] .block:nth-child(${nth})`;
const block = (el: OpeningHoursWeekView, date: LocalDate, key: string, nth: number) =>
  track(el, date, key).querySelector<HTMLElement>(`.block:nth-child(${nth})`)!;
const tip = (el: OpeningHoursWeekView) => testId(el, "block-tip")!;
const open = (el: OpeningHoursWeekView) => tip(el).matches(":popover-open");
const frames = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

describe("Opening hours week: a block's label", () => {
  it("a sliver's label shows whole when pointed at, above it", async () => {
    const el = await mount({ model: sliverModel() });
    const lunch = block(el, "2026-12-02", "rest", 2);
    expect(text(lunch)).toBe("Lunch 16:00–17:00");
    const words = lunch.querySelector<HTMLElement>(".text")!;
    expect(words.scrollWidth).toBeGreaterThan(words.clientWidth);
    expect(open(el)).toBe(false);
    await userEvent.hover(lunch);
    expect(open(el)).toBe(true);
    expect(text(tip(el))).toBe("Restaurant · Lunch 16:00–17:00");
    expect(tip(el).getBoundingClientRect().bottom).toBeLessThan(lunch.getBoundingClientRect().top);
    await commands.parkPointer();
    expect(open(el)).toBe(false);

    const spacer = document.createElement("div");
    spacer.style.height = "3000px";
    document.body.append(spacer);
    hosts.push(spacer);
    const first = block(el, "2026-11-30", "rest", 1);
    window.scrollTo(0, first.getBoundingClientRect().top + window.scrollY);
    await frames();
    expect(Math.abs(first.getBoundingClientRect().top)).toBeLessThanOrEqual(1);
    await userEvent.hover(first);
    expect(open(el)).toBe(true);
    expect(text(tip(el))).toBe("Restaurant · Breakfast 08:00–11:00");
    expect(tip(el).getBoundingClientRect().top).toBeGreaterThan(
      first.getBoundingClientRect().bottom,
    );
  });

  it("a click pins it, and leaving does not hide a pinned tip", async () => {
    const el = await mount({ model: sliverModel() });
    const lunch = block(el, "2026-12-02", "rest", 2);
    await userEvent.click(lunch);
    expect(open(el)).toBe(true);
    await commands.parkPointer();
    expect(open(el)).toBe(true);
    await userEvent.click(lunch);
    expect(open(el)).toBe(false);
  });

  it("a click elsewhere hides a pinned tip", async () => {
    const el = await mount({ model: sliverModel() });
    await userEvent.click(block(el, "2026-12-02", "rest", 2));
    await commands.parkPointer();
    expect(open(el)).toBe(true);
    await userEvent.click(testId(el, "week-month")!);
    expect(open(el)).toBe(false);
  });

  it("Escape hides it and goes no further", async () => {
    const el = await mount({ model: sliverModel() });
    await userEvent.click(block(el, "2026-12-02", "rest", 2));
    expect(open(el)).toBe(true);
    const seen: string[] = [];
    const listener = (event: KeyboardEvent) => seen.push(event.key);
    document.addEventListener("keydown", listener);
    try {
      await userEvent.keyboard("{Escape}");
    } finally {
      document.removeEventListener("keydown", listener);
    }
    expect(open(el)).toBe(false);
    expect(seen).toEqual([]);
  });

  it("a tap shows it and it stays after the tap's own pointerleave", async () => {
    const el = await mount({ model: sliverModel() });
    const lunch = block(el, "2026-12-02", "rest", 2);
    const order: string[] = [];
    for (const type of ["pointerenter", "pointerdown", "pointerup", "pointerleave", "click"])
      lunch.addEventListener(type, () => order.push(type));
    await commands.touchGesture({ at: blockSelector("2026-12-02", "rest", 2) });
    await frames();
    expect(order).toEqual(["pointerenter", "pointerdown", "pointerup", "pointerleave", "click"]);
    expect(open(el)).toBe(true);
    expect(text(tip(el))).toBe("Restaurant · Lunch 16:00–17:00");
    await commands.touchGesture({ at: blockSelector("2026-12-02", "rest", 2) });
    await frames();
    expect(open(el)).toBe(false);
    await commands.touchGesture({ at: blockSelector("2026-12-02", "rest", 2) });
    await frames();
    expect(open(el)).toBe(true);
    await commands.touchGesture({
      at: 'opening-hours-week [data-test="week-month"][data-month="2026-12"]',
    });
    await frames();
    expect(open(el)).toBe(false);
  });

  it("a scroll hides a pinned tip", async () => {
    const el = await mount({ model: sliverModel() });
    const spacer = document.createElement("div");
    spacer.style.height = "3000px";
    document.body.append(spacer);
    hosts.push(spacer);
    await userEvent.click(block(el, "2026-12-02", "rest", 2));
    await commands.parkPointer();
    expect(open(el)).toBe(true);
    window.scrollBy(0, 40);
    await frames();
    expect(window.scrollY).toBeGreaterThan(0);
    expect(open(el)).toBe(false);
  });

  it("a faded zone piece names its zone", async () => {
    const el = await mount({ departmentId: "rest" });
    const faded = block(el, "2026-12-02", "terrace", 2);
    expect(faded.hasAttribute("data-faded")).toBe(true);
    await userEvent.hover(faded);
    expect(open(el)).toBe(true);
    expect(text(tip(el))).toBe("Terrace · Lunch 13:00–16:00");
  });

  it("stays on a phone's screen", async () => {
    await page.viewport(390, 800);
    expect(window.innerWidth).toBe(390);
    const el = await mount();
    const dinner = block(el, "2026-12-02", "rest", 3);
    await userEvent.hover(dinner);
    expect(open(el)).toBe(true);
    const box = tip(el).getBoundingClientRect();
    expect(box.right).toBeLessThanOrEqual(390 - 8);
    expect(box.left).toBeGreaterThanOrEqual(8);
    expect(box.left).toBeLessThan(dinner.getBoundingClientRect().left);
  });
});
