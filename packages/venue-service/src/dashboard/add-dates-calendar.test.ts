import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { setLocale } from "@waitron/dashboard-kit";
import type { LocalDate } from "../hours-types.js";
import type { AddDatesCalendar } from "./add-dates-calendar.js";
import "./add-dates-calendar.js";

const hosts: HTMLElement[] = [];
beforeEach(() => setLocale("en"));
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
  setLocale("en");
});

async function mount(extra: Partial<AddDatesCalendar> = {}): Promise<AddDatesCalendar> {
  const el = document.createElement("add-dates-calendar");
  Object.assign(el, { month: "2026-12", ...extra });
  document.body.append(el);
  hosts.push(el);
  await el.updateComplete;
  return el;
}
const root = (el: AddDatesCalendar) => el.shadowRoot!;
const text = (node: Element | null | undefined) =>
  (node?.textContent ?? "").replace(/\s+/g, " ").trim();
const day = (el: AddDatesCalendar, date: LocalDate) =>
  root(el).querySelector<HTMLButtonElement>(`[data-date="${date}"] button`)!;
const testId = (el: AddDatesCalendar, id: string) =>
  root(el).querySelector<HTMLElement>(`[data-test="${id}"]`)!;
function added(el: AddDatesCalendar): LocalDate[][] {
  const sent: LocalDate[][] = [];
  el.addEventListener("add-dates", (event) =>
    sent.push((event as CustomEvent<{ dates: LocalDate[] }>).detail.dates),
  );
  return sent;
}
async function shiftClick(el: AddDatesCalendar, date: LocalDate) {
  day(el, date).dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
  await el.updateComplete;
}

describe("Add-dates calendar", () => {
  it("draws the month's dates under weekday headings from Monday, in English and Spanish", async () => {
    const el = await mount();
    expect(text(testId(el, "month"))).toBe("December 2026");
    expect([...root(el).querySelectorAll('[data-test="weekday"]')].map(text)).toEqual([
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
      "Sat",
      "Sun",
    ]);
    const dates = [...root(el).querySelectorAll<HTMLElement>("[data-date]")].map(
      (cell) => cell.dataset.date,
    );
    expect(dates[0]).toBe("2026-12-01");
    expect(dates.at(-1)).toBe("2026-12-31");
    expect(dates).toHaveLength(31);
    // 1 December 2026 is a Tuesday: one empty cell before it.
    const firstRow = root(el).querySelector("tbody tr")!;
    expect(firstRow.children[0]!.hasAttribute("data-date")).toBe(false);
    expect((firstRow.children[1] as HTMLElement).dataset.date).toBe("2026-12-01");
    expect(day(el, "2026-12-09").getAttribute("aria-label")).toBe("Wednesday, 9 December 2026");
    setLocale("es");
    el.requestUpdate();
    await el.updateComplete;
    expect(text(testId(el, "month")).toLowerCase()).toBe("diciembre 2026");
    expect(text(testId(el, "range"))).toBe("Intervalo");
  });

  it("draws nothing until it has a month", async () => {
    const el = await mount({ month: "" });
    expect(root(el).querySelector("table")).toBeNull();
  });

  it("adds one date on a click", async () => {
    const el = await mount();
    const sent = added(el);
    await userEvent.click(day(el, "2026-12-09"));
    expect(sent).toEqual([["2026-12-09"]]);
  });

  it("sends the event bubbling out of the shadow root", async () => {
    const el = await mount();
    const outer: Event[] = [];
    document.body.addEventListener("add-dates", (event) => outer.push(event), { once: true });
    day(el, "2026-12-09").click();
    expect(outer).toHaveLength(1);
  });

  it("adds the whole range from the last click on a shift-click, forwards and backwards", async () => {
    const el = await mount();
    const sent = added(el);
    day(el, "2026-12-09").click();
    await shiftClick(el, "2026-12-12");
    expect(sent).toEqual([
      ["2026-12-09"],
      ["2026-12-09", "2026-12-10", "2026-12-11", "2026-12-12"],
    ]);
    sent.length = 0;
    day(el, "2026-12-20").click();
    await shiftClick(el, "2026-12-18");
    expect(sent).toEqual([["2026-12-20"], ["2026-12-18", "2026-12-19", "2026-12-20"]]);
  });

  it("treats a shift-click with no earlier click as one date", async () => {
    const el = await mount();
    const sent = added(el);
    await shiftClick(el, "2026-12-05");
    expect(sent).toEqual([["2026-12-05"]]);
  });

  it("carries a range across months", async () => {
    const el = await mount();
    const sent = added(el);
    day(el, "2026-12-30").click();
    testId(el, "next-month").click();
    await el.updateComplete;
    await shiftClick(el, "2027-01-02");
    expect(sent.at(-1)).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  });

  it("makes the next two clicks a range while Range is on, then turns it off", async () => {
    const el = await mount();
    const sent = added(el);
    const range = testId(el, "range");
    expect(range.getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(range);
    expect(range.getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(day(el, "2026-12-14"));
    expect(sent).toEqual([]);
    expect(day(el, "2026-12-14").closest("td")!.hasAttribute("data-anchor")).toBe(true);
    expect(text(testId(el, "message"))).toBe("Choose the last date.");
    await userEvent.click(day(el, "2026-12-12"));
    expect(sent).toEqual([["2026-12-12", "2026-12-13", "2026-12-14"]]);
    expect(range.getAttribute("aria-pressed")).toBe("false");
    expect(text(testId(el, "message"))).toBe("");
    await userEvent.click(day(el, "2026-12-20"));
    expect(sent.at(-1)).toEqual(["2026-12-20"]);
  });

  it("turning Range off before the second click forgets its first", async () => {
    const el = await mount();
    const sent = added(el);
    testId(el, "range").click();
    await el.updateComplete;
    day(el, "2026-12-14").click();
    await el.updateComplete;
    testId(el, "range").click();
    await el.updateComplete;
    expect(text(testId(el, "message"))).toBe("");
    expect(root(el).querySelector("[data-anchor]")).toBeNull();
    day(el, "2026-12-16").click();
    expect(sent).toEqual([["2026-12-16"]]);
  });

  it("draws chosen dates pressed and sends nothing for them, leaving them out of a range", async () => {
    const el = await mount({ selected: ["2026-12-10", "2026-12-11"] });
    const sent = added(el);
    expect(day(el, "2026-12-10").getAttribute("aria-pressed")).toBe("true");
    expect(day(el, "2026-12-09").getAttribute("aria-pressed")).toBe("false");
    await userEvent.click(day(el, "2026-12-10"));
    expect(sent).toEqual([]);
    await shiftClick(el, "2026-12-12");
    expect(sent).toEqual([["2026-12-12"]]);
    sent.length = 0;
    day(el, "2026-12-09").click();
    await shiftClick(el, "2026-12-11");
    expect(sent).toEqual([["2026-12-09"], ["2026-12-09"]]);
  });

  it("marks a date another special day holds with its name, and still adds it", async () => {
    const el = await mount({ taken: new Map([["2026-12-25", "Christmas"]]) });
    const sent = added(el);
    const taken = day(el, "2026-12-25");
    expect(taken.closest("td")!.hasAttribute("data-taken")).toBe(true);
    expect(day(el, "2026-12-24").closest("td")!.hasAttribute("data-taken")).toBe(false);
    expect(taken.getAttribute("aria-label")).toBe("Friday, 25 December 2026, Christmas");
    expect(taken.title).toBe("Christmas");
    expect(taken.disabled).toBe(false);
    await userEvent.click(taken);
    expect(sent).toEqual([["2026-12-25"]]);
  });

  it("a real shift-click range in a modal dialog leaves no text selected", async () => {
    // Inside a modal dialog, as the painter shows it, Chromium leaves a caret on the first date.
    const dialog = document.createElement("dialog");
    document.body.append(dialog);
    hosts.push(dialog);
    dialog.showModal();
    const el = await mount();
    dialog.append(el);
    const sent = added(el);
    await userEvent.click(day(el, "2026-12-01"));
    await userEvent.keyboard("{Shift>}");
    await userEvent.click(day(el, "2026-12-04"));
    await userEvent.keyboard("{/Shift}");
    expect(sent.at(-1)).toEqual(["2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04"]);
    expect(document.getSelection()!.toString()).toBe("");
  });

  it.each([
    ["en", "Held by another special day", "Christmas holds this date."],
    ["es", "Ocupada por otro día especial", "Christmas ya tiene esta fecha."],
  ] as const)(
    "explains the mark on a held date in a legend, and names the holder when it is picked (%s)",
    async (locale, legend, holds) => {
      setLocale(locale);
      const el = await mount({ taken: new Map([["2026-12-25", "Christmas"]]) });
      expect(text(testId(el, "legend"))).toBe(legend);
      expect(text(testId(el, "held"))).toBe("");
      await userEvent.click(day(el, "2026-12-25"));
      expect(text(testId(el, "held"))).toBe(holds);
      await userEvent.click(day(el, "2026-12-24"));
      expect(text(testId(el, "held"))).toBe("");
    },
  );

  it("names the holder of a held date reached with the arrow keys, and drops it on leaving the month", async () => {
    const el = await mount({ taken: new Map([["2026-12-25", "Christmas"]]) });
    day(el, "2026-12-24").focus();
    await userEvent.keyboard("{ArrowRight}");
    await el.updateComplete;
    expect(text(testId(el, "held"))).toBe("Christmas holds this date.");
    testId(el, "next-month").click();
    await el.updateComplete;
    expect(text(testId(el, "held"))).toBe("");
    expect(root(el).querySelector('[data-test="legend"]')).toBeNull();
  });

  it("shows no legend in a month with no held date", async () => {
    const el = await mount({ taken: new Map([["2027-01-06", "Reyes"]]) });
    expect(root(el).querySelector('[data-test="legend"]')).toBeNull();
  });

  it("steps months with ‹ ›, sending month-change and drawing the new month", async () => {
    const el = await mount();
    const months: string[] = [];
    el.addEventListener("month-change", (event) =>
      months.push((event as CustomEvent<{ month: string }>).detail.month),
    );
    const sent = added(el);
    testId(el, "next-month").click();
    await el.updateComplete;
    expect(months).toEqual(["2027-01"]);
    expect(el.month).toBe("2027-01");
    expect(text(testId(el, "month"))).toBe("January 2027");
    expect(day(el, "2027-01-31")).not.toBeNull();
    testId(el, "previous-month").click();
    testId(el, "previous-month").click();
    await el.updateComplete;
    expect(months).toEqual(["2027-01", "2026-12", "2026-11"]);
    expect(text(testId(el, "month"))).toBe("November 2026");
    expect(sent).toEqual([]);
  });

  it("refuses a range over 366 dates with a short message, and the next add clears it", async () => {
    const el = await mount({ month: "2027-01" });
    const sent = added(el);
    day(el, "2027-01-01").click();
    el.month = "2028-01";
    await el.updateComplete;
    await shiftClick(el, "2028-01-02");
    expect(sent).toEqual([["2027-01-01"]]);
    expect(text(testId(el, "message"))).toBe("Choose at most 366 dates.");
    // The refused range kept its first date; 2027-01-01 to 2028-01-01 is 366 dates.
    await shiftClick(el, "2028-01-01");
    expect(sent.at(-1)).toHaveLength(366);
    expect(sent.at(-1)![0]).toBe("2027-01-01");
    expect(text(testId(el, "message"))).toBe("");
  });

  it("keeps Range on with its first date when its range is too long", async () => {
    const el = await mount({ month: "2027-01" });
    const sent = added(el);
    testId(el, "range").click();
    await el.updateComplete;
    day(el, "2027-01-01").click();
    el.month = "2028-01";
    await el.updateComplete;
    day(el, "2028-01-02").click();
    await el.updateComplete;
    expect(sent).toEqual([]);
    expect(text(testId(el, "message"))).toBe("Choose at most 366 dates.");
    expect(testId(el, "range").getAttribute("aria-pressed")).toBe("true");
    day(el, "2028-01-01").click();
    await el.updateComplete;
    expect(sent.map((dates) => dates.length)).toEqual([366]);
    expect(testId(el, "range").getAttribute("aria-pressed")).toBe("false");
  });

  it("moves focus between dates with the arrow keys, one Tab stop in the month", async () => {
    const el = await mount();
    const stops = [...root(el).querySelectorAll<HTMLButtonElement>("[data-date] button")].filter(
      (button) => button.tabIndex === 0,
    );
    expect(stops.map((button) => button.closest("td")!.dataset.date)).toEqual(["2026-12-01"]);
    day(el, "2026-12-09").focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(root(el).activeElement).toBe(day(el, "2026-12-10"));
    await userEvent.keyboard("{ArrowDown}");
    expect(root(el).activeElement).toBe(day(el, "2026-12-17"));
    await userEvent.keyboard("{ArrowUp}{ArrowLeft}");
    expect(root(el).activeElement).toBe(day(el, "2026-12-09"));
    await el.updateComplete;
    expect(day(el, "2026-12-09").tabIndex).toBe(0);
    expect(day(el, "2026-12-01").tabIndex).toBe(-1);
    day(el, "2026-12-31").focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(root(el).activeElement).toBe(day(el, "2026-12-31"));
    await userEvent.keyboard("a");
    expect(root(el).activeElement).toBe(day(el, "2026-12-31"));
  });

  it("keeps ‹ › inside the months the month read serves", async () => {
    const el = await mount({ month: "9998-12" });
    const months: string[] = [];
    el.addEventListener("month-change", (event) =>
      months.push((event as CustomEvent<{ month: string }>).detail.month),
    );
    expect(testId(el, "next-month").hasAttribute("disabled")).toBe(true);
    testId(el, "next-month").click();
    el.month = "0100-02";
    await el.updateComplete;
    expect(testId(el, "previous-month").hasAttribute("disabled")).toBe(true);
    testId(el, "previous-month").click();
    expect(months).toEqual([]);
  });
});
