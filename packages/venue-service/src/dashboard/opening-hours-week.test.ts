import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import type { OpeningHoursMonth } from "../opening-hours-calendar.js";
import type { LocalDate } from "../hours-types.js";
import { addDays, weekdayOf } from "../hours-rules.js";
import { DEPARTMENTS, monthModel } from "../testing/opening-hours-month-fixture.js";
import type { CalendarDayOpen } from "./opening-hours-month.js";
import { dayTitleCandidateDates, type OpeningHoursWeekView } from "./opening-hours-week.js";

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
const frames = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
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

  it("the ruler's labels never overlap, and the last stays inside the track", async () => {
    const el = await mount();
    for (const width of [1280, 1024, 768, 640, 560]) {
      await page.viewport(width, 800);
      expect(window.innerWidth).toBe(width);
      await frames();
      const scale = root(el).querySelector<HTMLElement>(".ruler .scale")!.getBoundingClientRect();
      const shown = [...root(el).querySelectorAll<HTMLElement>(".ruler .label")]
        .filter((label) => getComputedStyle(label).visibility !== "hidden")
        .map((label) => ({ text: text(label), box: label.getBoundingClientRect() }));
      expect(shown.length, `at ${width}px`).toBeGreaterThanOrEqual(3);
      expect(shown[0]!.text, `at ${width}px`).toBe("06:00");
      const overlaps = shown.slice(1).flatMap((label, i) => {
        const by = shown[i]!.box.right - label.box.left;
        return by > 0 ? [`${shown[i]!.text}|${label.text} by ${by.toFixed(1)}px`] : [];
      });
      expect(overlaps, `at ${width}px`).toEqual([]);
      expect(shown.at(-1)!.box.right, `at ${width}px`).toBeLessThanOrEqual(scale.right);
    }
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

/** The Week inside a box that scrolls, drawn in another element's shadow root below a banner
 *  `bannerHeight` tall, as the dashboard draws its pages. */
async function mountInScroller(
  bannerHeight: number,
): Promise<{ el: OpeningHoursWeekView; scroller: HTMLElement }> {
  const app = document.createElement("div");
  const shadow = app.attachShadow({ mode: "open" });
  const banner = document.createElement("div");
  banner.style.height = `${bannerHeight}px`;
  const scroller = document.createElement("div");
  scroller.style.height = "500px";
  scroller.style.overflow = "auto";
  const el = document.createElement("opening-hours-week");
  Object.assign(el, { model: sliverModel(), date: "2026-12-02", departments: DEPARTMENTS });
  const spacer = document.createElement("div");
  spacer.style.height = "3000px";
  scroller.append(el, spacer);
  shadow.append(banner, scroller);
  applyTokens(el);
  document.body.append(app);
  hosts.push(app);
  await el.updateComplete;
  return { el, scroller };
}

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
    const painted = getComputedStyle(tip(el));
    expect(painted.backgroundColor).toBe(resolved(el, "--wt-color-text"));
    expect(painted.color).toBe(resolved(el, "--wt-color-bg"));
    expect(painted.borderTopWidth).toBe("0px");
    expect(painted.boxShadow).toBe("none");
    await commands.parkPointer();
    await vi.waitFor(() => expect(open(el)).toBe(false));

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
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await userEvent.click(lunch);
      expect(open(el)).toBe(true);
      await commands.parkPointer();
      vi.advanceTimersByTime(1000);
      expect(open(el)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
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
    const prevented: boolean[] = [];
    const reader = (event: KeyboardEvent) => prevented.push(event.defaultPrevented);
    document.addEventListener("keydown", listener);
    window.addEventListener("keydown", reader, { capture: true });
    try {
      await userEvent.keyboard("{Escape}");
    } finally {
      document.removeEventListener("keydown", listener);
      window.removeEventListener("keydown", reader, { capture: true });
    }
    expect(open(el)).toBe(false);
    expect(seen).toEqual([]);
    expect(prevented).toEqual([true]);
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

  it("a scroll of a box the Week is drawn in, inside a shadow root, hides and unpins the tip", async () => {
    const { el, scroller } = await mountInScroller(0);
    await userEvent.click(block(el, "2026-12-02", "rest", 2));
    await commands.parkPointer();
    expect(open(el)).toBe(true);
    scroller.scrollBy(0, 40);
    await frames();
    expect(scroller.scrollTop).toBeGreaterThan(0);
    expect(open(el)).toBe(false);
    await userEvent.hover(block(el, "2026-12-03", "rest", 1));
    expect(open(el)).toBe(true);
    expect(text(tip(el))).toBe("Restaurant · Breakfast 08:00–11:00");
  });

  it("a block at the top of the box it scrolls in has its tip below", async () => {
    const { el, scroller } = await mountInScroller(200);
    const first = block(el, "2026-11-30", "rest", 1);
    scroller.scrollTop = first.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    await frames();
    const top = first.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    expect(Math.abs(top)).toBeLessThanOrEqual(1);
    expect(first.getBoundingClientRect().top).toBeGreaterThan(150);
    await userEvent.hover(first);
    expect(open(el)).toBe(true);
    expect(tip(el).dataset.side).toBe("below");
    expect(tip(el).getBoundingClientRect().top).toBeGreaterThan(
      first.getBoundingClientRect().bottom,
    );
  });

  it("moving the mouse onto the tip keeps it, above or below its block", async () => {
    const el = await mount({ model: sliverModel() });
    const tipSelector = 'opening-hours-week [data-test="block-tip"]';
    await commands.mouseMove([blockSelector("2026-12-02", "rest", 2), tipSelector], {
      steps: 20,
      keepX: true,
    });
    expect(tip(el).dataset.side).toBe("above");
    expect(open(el)).toBe(true);
    await commands.parkPointer();
    await vi.waitFor(() => expect(open(el)).toBe(false));

    const spacer = document.createElement("div");
    spacer.style.height = "3000px";
    document.body.append(spacer);
    hosts.push(spacer);
    const first = block(el, "2026-11-30", "rest", 1);
    window.scrollTo(0, first.getBoundingClientRect().top + window.scrollY);
    await frames();
    await commands.mouseMove([blockSelector("2026-11-30", "rest", 1), tipSelector], {
      steps: 20,
      keepX: true,
    });
    expect(tip(el).dataset.side).toBe("below");
    expect(open(el)).toBe(true);
  });

  it("a diagonal path from a wide block's centre to its tip's keeps the tip", async () => {
    const el = await mount({ departmentId: "bar" });
    const bar = block(el, "2026-12-02", "bar", 1);
    const tipSelector = 'opening-hours-week [data-test="block-tip"]';
    await userEvent.hover(bar);
    expect(bar.getBoundingClientRect().width).toBeGreaterThan(
      3 * tip(el).getBoundingClientRect().width,
    );
    await commands.parkPointer();
    const onto: (EventTarget | null)[] = [];
    bar.addEventListener("pointerleave", (event) => onto.push(event.relatedTarget));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await commands.mouseMove([blockSelector("2026-12-02", "bar", 1), tipSelector], { steps: 30 });
      expect(onto).toHaveLength(1);
      expect(onto[0]).not.toBe(tip(el));
      expect(open(el)).toBe(true);
      expect(text(tip(el))).toBe("Bar · All day 10:00–02:00");
      vi.advanceTimersByTime(1000);
      expect(open(el)).toBe(true);
      await commands.parkPointer();
      vi.advanceTimersByTime(1000);
      expect(open(el)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a diagonal path from a narrow block to a tip shifted left by its long label keeps the tip", async () => {
    const departments = structuredClone(DEPARTMENTS);
    departments[0]!.name =
      "Restaurant with a very long descriptive department name for the main dining room";
    const model = monthModel();
    const rest = model.days.find((d) => d.date === "2026-12-02")!.departments[0]!;
    rest.ranges = rest.ranges.map((r) =>
      r.periodId === "dinner" ? { ...r, startsAt: "04:30", endsAt: "05:00" } : r,
    );
    const el = await mount({ model, departments });
    const late = block(el, "2026-12-02", "rest", 3);
    const tipSelector = 'opening-hours-week [data-test="block-tip"]';
    await userEvent.hover(late);
    const shifted = tip(el).getBoundingClientRect();
    expect(shifted.left + shifted.width / 2).toBeLessThan(late.getBoundingClientRect().left);
    await commands.parkPointer();
    const onto: (EventTarget | null)[] = [];
    late.addEventListener("pointerleave", (event) => onto.push(event.relatedTarget));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await commands.mouseMove([blockSelector("2026-12-02", "rest", 3), tipSelector], {
        steps: 30,
      });
      expect(onto).toHaveLength(1);
      expect(onto[0]).toBe(track(el, "2026-12-02", "rest"));
      expect(open(el)).toBe(true);
      vi.advanceTimersByTime(1000);
      expect(open(el)).toBe(true);
      await commands.mouseMove([blockSelector("2026-12-02", "rest", 3)]);
      await commands.parkPointer();
      vi.advanceTimersByTime(1000);
      expect(open(el)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("moving from one block to another keeps the second block's tip after the first's hide delay", async () => {
    const el = await mount();
    await userEvent.hover(block(el, "2026-12-02", "rest", 3));
    expect(open(el)).toBe(true);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      await userEvent.hover(block(el, "2026-12-02", "rest", 1));
      vi.advanceTimersByTime(1000);
      expect(open(el)).toBe(true);
      expect(text(tip(el))).toBe("Restaurant · Breakfast 08:00–11:00");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a long unbroken label wraps inside the window", async () => {
    await page.viewport(1024, 800);
    expect(window.innerWidth).toBe(1024);
    const departments = structuredClone(DEPARTMENTS);
    departments[0]!.name = "W".repeat(100);
    const el = await mount({ departments });
    await userEvent.hover(block(el, "2026-12-02", "rest", 3));
    expect(open(el)).toBe(true);
    expect(text(tip(el))).toContain(departments[0]!.name);
    const pen = document.createElement("canvas").getContext("2d")!;
    pen.font = getComputedStyle(tip(el)).font;
    expect(pen.measureText(departments[0]!.name).width).toBeGreaterThan(1024);
    const words = document.createRange();
    words.selectNodeContents(tip(el));
    const box = words.getBoundingClientRect();
    expect(box.left).toBeGreaterThanOrEqual(8);
    expect(box.right).toBeLessThanOrEqual(1024 - 8);
    expect(tip(el).getBoundingClientRect().right).toBeLessThanOrEqual(1024 - 8);
  });

  it("a resize hides and unpins the tip", async () => {
    const el = await mount();
    await userEvent.click(block(el, "2026-12-02", "rest", 3));
    await commands.parkPointer();
    expect(open(el)).toBe(true);
    await page.viewport(900, 800);
    expect(window.innerWidth).toBe(900);
    await frames();
    expect(open(el)).toBe(false);
    await userEvent.hover(block(el, "2026-12-02", "rest", 1));
    expect(open(el)).toBe(true);
    expect(text(tip(el))).toBe("Restaurant · Breakfast 08:00–11:00");
  });

  it("a tip shown again is placed afresh in a narrow window", async () => {
    await page.viewport(600, 800);
    expect(window.innerWidth).toBe(600);
    const el = await mount();
    await userEvent.hover(block(el, "2026-12-02", "rest", 3));
    expect(open(el)).toBe(true);
    const breakfast = block(el, "2026-12-02", "rest", 1);
    await userEvent.hover(breakfast);
    expect(text(tip(el))).toBe("Restaurant · Breakfast 08:00–11:00");
    const gap = parseFloat(getComputedStyle(el).getPropertyValue("--wt-space-1"));
    expect(gap).toBeGreaterThan(0);
    const box = tip(el).getBoundingClientRect();
    expect(box.right).toBeLessThanOrEqual(600 - 8);
    expect(
      Math.abs(box.bottom - (breakfast.getBoundingClientRect().top - gap)),
    ).toBeLessThanOrEqual(0.5);
  });

  it("a change to what the Week shows hides the tip", async () => {
    const el = await mount({ model: sliverModel() });
    for (const change of [
      () => (el.date = "2026-12-09"),
      () => (el.model = monthModel()),
      () => (el.departmentId = "rest"),
    ]) {
      await userEvent.click(block(el, "2026-12-02", "rest", 2));
      expect(open(el)).toBe(true);
      change();
      await el.updateComplete;
      expect(open(el)).toBe(false);
      if (el.date !== "2026-12-02") {
        el.date = "2026-12-02";
        await el.updateComplete;
      }
    }
  });

  it("a faded zone piece names its zone", async () => {
    const el = await mount({ departmentId: "rest" });
    const faded = block(el, "2026-12-02", "terrace", 2);
    expect(faded.hasAttribute("data-faded")).toBe(true);
    await userEvent.hover(faded);
    expect(open(el)).toBe(true);
    expect(text(tip(el))).toBe("Terrace · Lunch 13:00–16:00");
  });

  it("stays inside a narrow window", async () => {
    await page.viewport(600, 800);
    expect(window.innerWidth).toBe(600);
    const el = await mount();
    const dinner = block(el, "2026-12-02", "rest", 3);
    await userEvent.hover(dinner);
    expect(open(el)).toBe(true);
    const box = tip(el).getBoundingClientRect();
    expect(box.right).toBeLessThanOrEqual(600 - 8);
    expect(box.left).toBeGreaterThanOrEqual(8);
    expect(box.left).toBeLessThan(dinner.getBoundingClientRect().left);
  });
});

describe("Opening hours week on a phone", () => {
  beforeEach(async () => {
    await page.viewport(390, 800);
    expect(window.innerWidth).toBe(390);
  });

  const card = (el: OpeningHoursWeekView) => testId(el, "day-card")!;
  const cardRow = (el: OpeningHoursWeekView, key: string) =>
    card(el).querySelector<HTMLElement>(`.row[data-row="${key}"]`)!;
  const bold = (node: Element) => Number(getComputedStyle(node).fontWeight) >= 600;

  it("below 560 px it shows the address's day alone", async () => {
    const el = await mount({ date: "2026-12-01", departmentId: "rest" });
    expect(root(el).querySelectorAll("section")).toHaveLength(0);
    expect(root(el).querySelectorAll('[data-test="day-name"]')).toHaveLength(1);
    expect(root(el).querySelector('[data-test="week"] [data-test="day-name"]')).not.toBeNull();
    expect(text(testId(el, "week"))).toBe("Tue 1 Dec");
    expect([...card(el).querySelectorAll<HTMLElement>(".row")].map((r) => r.dataset.row)).toEqual([
      "rest",
      "terrace",
    ]);
    const rest = cardRow(el, "rest");
    expect(text(rest.querySelector(".row-name"))).toBe("Restaurant");
    expect(bold(rest.querySelector(".row-name")!)).toBe(true);
    expect(text(rest.querySelector(".words"))).toBe(
      "Breakfast 08:00–11:00 · Lunch 13:00–16:00 · Dinner 20:00–23:00",
    );
    const terrace = cardRow(el, "terrace");
    expect(text(terrace.querySelector(".row-name"))).toBe("Terrace");
    expect(bold(terrace.querySelector(".row-name")!)).toBe(true);
    expect(text(terrace.querySelector(".words"))).toBe(
      "Breakfast 08:00–11:00 · Lunch 13:00–16:00 · Dinner 22:00–23:00 · closed 20:00–22:00",
    );
    const terraceTrack = terrace.querySelector<HTMLElement>(".track")!;
    expect(terraceTrack.getAttribute("aria-hidden")).toBe("true");
    const thin = parseFloat(getComputedStyle(el).getPropertyValue("--wt-space-2"));
    expect(thin).toBeGreaterThan(0);
    expect(terraceTrack.getBoundingClientRect().height).toBe(thin);
    expect(root(el).querySelector(".day-names")).toBeNull();
    const blocks = [...terraceTrack.querySelectorAll<HTMLElement>(".block")];
    expect(blocks.length).toBeGreaterThan(0);
    for (const b of blocks) expect(text(b)).toBe("");
    expect(terraceTrack.querySelectorAll(".block[data-faded]")).toHaveLength(2);
    expect(
      getComputedStyle(terraceTrack.querySelector('.block[data-kind="closed"]')!).backgroundImage,
    ).toContain("repeating-linear-gradient");
    expect(root(el).querySelector(".ruler")).toBeNull();
    expect(testId(el, "block-tip")).toBeNull();

    el.date = "2026-12-02";
    await el.updateComplete;
    const followed = cardRow(el, "terrace");
    expect(text(followed.querySelector(".words"))).toBe("as Restaurant");
    expect(bold(followed.querySelector(".row-name")!)).toBe(false);
  });

  it("a zone that follows its department has its words muted as its name is", async () => {
    const el = await mount({ date: "2026-12-02", departmentId: "rest" });
    const colour = (row: HTMLElement, part: string) =>
      getComputedStyle(row.querySelector(part)!).color;
    const followed = cardRow(el, "terrace");
    expect(text(followed.querySelector(".words"))).toBe("as Restaurant");
    expect(colour(followed, ".words")).toBe(colour(followed, ".row-name"));
    const rest = cardRow(el, "rest");
    expect(colour(rest, ".words")).not.toBe(colour(followed, ".words"));
  });

  it("decides on its content width when it is first drawn", async () => {
    await page.viewport(1280, 800);
    expect(window.innerWidth).toBe(1280);
    const el = document.createElement("opening-hours-week");
    Object.assign(el, { model: monthModel(), date: "2026-12-02", departments: DEPARTMENTS });
    Object.assign(el.style, { boxSizing: "border-box", width: "600px", paddingInline: "30px" });
    applyTokens(el);
    document.body.append(el);
    hosts.push(el);
    await el.updateComplete;
    expect(el.getBoundingClientRect().width).toBe(600);
    expect(testId(el, "day-card")).not.toBeNull();
  });

  it("names the day's special day or holiday under the head", async () => {
    const el = await mount({ date: "2026-12-08" });
    const underHead = () => root(el).querySelector<HTMLElement>(".head + .day-names");
    expect(text(underHead()?.querySelector(".name.holiday"))).toBe("Immaculate Conception");
    el.date = "2026-12-14";
    await el.updateComplete;
    expect(text(underHead()?.querySelector(".name.special"))).toBe("Company dinners");
  });

  it("‹ › step a day", async () => {
    const el = await mount({ date: "2026-12-01" });
    expect(testId(el, "previous-day")!.getAttribute("aria-label")).toBe("Previous day");
    expect(testId(el, "next-day")!.getAttribute("aria-label")).toBe("Next day");
    const sent = events<{ date: LocalDate }>(el, "week-change");
    testId(el, "next-day")!.click();
    testId(el, "previous-day")!.click();
    expect(sent).toEqual([{ date: "2026-12-02" }, { date: "2026-11-30" }]);
    expect(el.shownMonth).toBe("2026-12");

    await page.viewport(1280, 800);
    expect(window.innerWidth).toBe(1280);
    await vi.waitFor(() => expect(el.shownMonth).toBe("2026-11"));
    await page.viewport(390, 800);
    expect(window.innerWidth).toBe(390);
    await vi.waitFor(() => expect(testId(el, "next-day")).not.toBeNull());

    let monday = "0100-02-01";
    while (weekdayOf(monday) !== 1) monday = addDays(monday, 1);
    el.model = undefined;
    el.date = monday;
    await el.updateComplete;
    expect(testId(el, "previous-day")!.hasAttribute("disabled")).toBe(true);
    expect(testId(el, "next-day")!.hasAttribute("disabled")).toBe(false);
    await userEvent.click(testId(el, "previous-day")!, { force: true });
    expect(sent).toHaveLength(2);
  });

  it("the day's name opens the day box", async () => {
    const el = await mount({ date: "2026-12-01" });
    const name = testId(el, "day-name")!;
    expect(text(name)).toBe("Tue 1");
    const opened = events<CalendarDayOpen>(el, "calendar-day-open");
    await userEvent.click(name);
    expect(opened).toHaveLength(1);
    expect(opened[0]!.date).toBe("2026-12-01");
    expect(opened[0]!.returnTo()).toBe(name);
    const month = testId(el, "week-month")!;
    expect(text(month)).toBe("Dec");
    const monthSent = events<{ month: string }>(el, "week-month-open");
    await userEvent.click(month);
    expect(monthSent).toEqual([{ month: "2026-12" }]);
    expect(testId(el, "week-year")).toBeNull();
  });

  it("the day title keeps one width", async () => {
    const dates: LocalDate[] = [];
    for (let date = "2026-11-30"; date <= "2026-12-06"; date = addDays(date, 1)) dates.push(date);
    dates.push("2026-09-01", "2027-02-28");
    const lefts: [string, number][] = [];
    try {
      for (const locale of ["en", "es"] as const) {
        setLocale(locale);
        const el = await mount({ model: undefined });
        for (const date of dates) {
          el.date = date;
          await el.updateComplete;
          lefts.push([`${locale} ${date}`, testId(el, "next-day")!.getBoundingClientRect().left]);
        }
      }
    } finally {
      setLocale("en");
    }
    expect(lefts).toHaveLength(18);
    for (const [shown, left] of lefts)
      expect(Math.abs(left - lefts[0]![1]), shown).toBeLessThanOrEqual(0.5);
  });

  it("the day title is sized against every weekday in every month", () => {
    const pairs = new Set(
      dayTitleCandidateDates().map((date) => `${weekdayOf(date)} ${date.slice(5, 7)}`),
    );
    expect(pairs.size).toBe(7 * 12);
  });

  it("the day title starts with a capital", async () => {
    try {
      setLocale("es");
      const el = await mount({ model: undefined, date: "2026-12-01" });
      expect(text(testId(el, "day-name"))).toBe("Mar, 1");
      expect(text(testId(el, "week"))).toBe("Mar, 1 dic");
    } finally {
      setLocale("en");
    }
  });

  it("the title's links are big enough to tap and apart", async () => {
    const el = await mount({ date: "2026-12-01" });
    const day = testId(el, "day-name")!.getBoundingClientRect();
    const month = testId(el, "week-month")!.getBoundingClientRect();
    for (const box of [day, month]) {
      expect(box.width).toBeGreaterThanOrEqual(24);
      expect(box.height).toBeGreaterThanOrEqual(24);
    }
    const gap = parseFloat(getComputedStyle(el).getPropertyValue("--wt-space-1"));
    expect(gap).toBeGreaterThan(0);
    expect(month.left - day.right).toBeGreaterThanOrEqual(gap);
  });

  it("back above 560 px it shows the whole week again", async () => {
    const el = await mount({ date: "2026-12-01" });
    expect(card(el)).not.toBeNull();
    await page.viewport(1280, 800);
    expect(window.innerWidth).toBe(1280);
    await vi.waitFor(() => expect(root(el).querySelectorAll("section")).toHaveLength(7));
    expect(testId(el, "day-card")).toBeNull();
    expect(testId(el, "next-week")).not.toBeNull();
    expect(text(testId(el, "week"))).toBe("30 Nov – 6 Dec 2026");
  });

  it("turning narrow hides and unpins a shown tip", async () => {
    await page.viewport(1280, 800);
    expect(window.innerWidth).toBe(1280);
    const el = await mount();
    await userEvent.click(block(el, "2026-12-02", "rest", 3));
    await commands.parkPointer();
    expect(open(el)).toBe(true);
    const shown = tip(el);
    await page.viewport(390, 800);
    expect(window.innerWidth).toBe(390);
    await vi.waitFor(() => expect(testId(el, "day-card")).not.toBeNull());
    expect(shown.matches(":popover-open")).toBe(false);

    await page.viewport(1280, 800);
    expect(window.innerWidth).toBe(1280);
    await vi.waitFor(() => expect(root(el).querySelectorAll("section")).toHaveLength(7));
    await userEvent.hover(block(el, "2026-12-02", "rest", 1));
    expect(open(el)).toBe(true);
    expect(text(tip(el))).toBe("Restaurant · Breakfast 08:00–11:00");
  });

  it("pointing at or tapping a row's bar shows no tip", async () => {
    const el = await mount();
    const track = card(el).querySelector<HTMLElement>(".track")!;
    await userEvent.hover(track);
    expect(testId(el, "block-tip")).toBeNull();
    await userEvent.click(card(el).querySelector<HTMLElement>(".block")!);
    expect(testId(el, "block-tip")).toBeNull();
    await commands.touchGesture({
      at: 'opening-hours-week [data-test="day-card"] .row[data-row="rest"] .track',
    });
    expect(testId(el, "block-tip")).toBeNull();
  });

  const cardAt = 'opening-hours-week [data-test="day-card"]';

  it("a swipe left shows the next day", async () => {
    const el = await mount({ date: "2026-12-01" });
    const sent = events<{ date: LocalDate }>(el, "week-change");
    await commands.touchGesture({ at: cardAt, moveBy: { x: -150, y: 0 } });
    expect(sent).toEqual([{ date: "2026-12-02" }]);
    await commands.touchGesture({ at: cardAt, moveBy: { x: 150, y: 0 } });
    expect(sent).toEqual([{ date: "2026-12-02" }, { date: "2026-11-30" }]);
  });

  it("a finger moving down scrolls and steps nothing", async () => {
    const el = await mount({ date: "2026-12-01" });
    const tall = document.createElement("div");
    tall.style.height = "3000px";
    document.body.append(tall);
    hosts.push(tall);
    expect(document.documentElement.scrollHeight).toBeGreaterThan(window.innerHeight);
    expect(window.scrollY).toBe(0);
    const sent = events<{ date: LocalDate }>(el, "week-change");
    await commands.touchGesture({ at: cardAt, moveBy: { x: 0, y: -200 } });
    await vi.waitFor(() => expect(window.scrollY).toBeGreaterThan(0));
    expect(sent).toEqual([]);
  });

  it("a short or slanted move steps nothing", async () => {
    const el = await mount({ date: "2026-12-01" });
    const sent = events<{ date: LocalDate }>(el, "week-change");
    await commands.touchGesture({ at: cardAt, moveBy: { x: -30, y: 0 } });
    await commands.touchGesture({ at: cardAt, moveBy: { x: -60, y: -50 } });
    expect(sent).toEqual([]);
  });

  it("a mouse drag steps nothing", async () => {
    const el = await mount({ date: "2026-12-01" });
    const sent = events<{ date: LocalDate }>(el, "week-change");
    const blocks = `${cardAt} .row[data-row="rest"] .block`;
    const first = card(el).querySelector<HTMLElement>('.row[data-row="rest"] .block:first-child')!;
    const last = card(el).querySelector<HTMLElement>('.row[data-row="rest"] .block:last-child')!;
    expect(last.getBoundingClientRect().left - first.getBoundingClientRect().right).toBeGreaterThan(
      48,
    );
    await commands.mouseDrag([`${blocks}:first-child`, `${blocks}:last-child`]);
    expect(sent).toEqual([]);
  });

  it("two fingers held still step nothing", async () => {
    const el = await mount({ date: "2026-12-01" });
    const sent = events<{ date: LocalDate }>(el, "week-change");
    const y = card(el).getBoundingClientRect().top + 20;
    const finger = (type: string, pointerId: number, clientX: number) =>
      card(el).dispatchEvent(
        new PointerEvent(type, {
          pointerId,
          pointerType: "touch",
          isPrimary: pointerId === 1,
          clientX,
          clientY: y,
          bubbles: true,
          composed: true,
        }),
      );
    finger("pointerdown", 1, 106);
    finger("pointerdown", 2, 284);
    finger("pointerup", 1, 106);
    finger("pointerup", 2, 284);
    expect(sent).toEqual([]);
  });

  it("a cancelled scroll leaves nothing for a later press to finish", async () => {
    const el = await mount({ date: "2026-12-01" });
    const tall = document.createElement("div");
    tall.style.height = "3000px";
    document.body.append(tall);
    hosts.push(tall);
    const cancelled: PointerEvent[] = [];
    card(el).addEventListener("pointercancel", (event) => cancelled.push(event));
    const sent = events<{ date: LocalDate }>(el, "week-change");
    await commands.touchGesture({ at: cardAt, moveBy: { x: 0, y: -200 } });
    await vi.waitFor(() => expect(cancelled).toHaveLength(1));
    window.scrollTo(0, 0);
    await frames();
    await commands.mouseDrag([
      'opening-hours-week [data-test="day-name"]',
      `${cardAt} .row[data-row="rest"] .block:last-child`,
    ]);
    expect(sent).toEqual([]);
  });

  it("a tap on the day's name still opens the day box", async () => {
    const el = await mount({ date: "2026-12-01" });
    const opened = events<CalendarDayOpen>(el, "calendar-day-open");
    const sent = events<{ date: LocalDate }>(el, "week-change");
    await commands.touchGesture({ at: 'opening-hours-week [data-test="day-name"]' });
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0]!.date).toBe("2026-12-01");
    expect(sent).toEqual([]);
  });

  it("nothing runs off the side", async () => {
    const el = await mount({ date: "2026-12-01", departmentId: "rest" });
    await vi.waitFor(() => expect(root(el).querySelector("wt-combobox")).not.toBeNull());
    const head = root(el).querySelector<HTMLElement>(".head")!;
    const parts = [...head.children, ...card(el).querySelectorAll("*")];
    expect(parts.length).toBeGreaterThan(4);
    for (const part of parts)
      expect(part.getBoundingClientRect().right, part.className).toBeLessThanOrEqual(390);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
  });
});
