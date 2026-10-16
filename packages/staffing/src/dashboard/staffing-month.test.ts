import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { LiveData, setLocale } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import type { StaffingMonth } from "../staffing-types.js";
import type { StaffingApi } from "./client.js";
import type { StaffingMonthView } from "./staffing-month.js";
import "./staffing-month.js";
import { fakeApi, staffingMonth } from "../testing/staffing-month-fixture.js";

const frames: HTMLElement[] = [];
beforeEach(() => setLocale("en"));
afterEach(() => {
  for (const frame of frames.splice(0)) frame.remove();
  setLocale("en");
});

interface Options {
  month?: string;
  params?: Record<string, string>;
  api?: StaffingApi;
  width?: string;
  canWrite?: boolean;
  canOpenRota?: boolean;
}

async function mount(options: Options = {}) {
  const frame = document.createElement("div");
  if (options.width) frame.style.width = options.width;
  document.body.append(frame);
  applyTokens(frame);
  frames.push(frame);
  const el = document.createElement("staffing-month") as StaffingMonthView;
  const open = vi.fn();
  el.api = options.api ?? fakeApi().api;
  el.month = options.month ?? "2026-12";
  el.params = options.params ?? { month: el.month };
  el.open = open;
  el.canWrite = options.canWrite ?? false;
  el.canOpenRota = options.canOpenRota ?? false;
  frame.append(el);
  await settled(el);
  return { el, open };
}
async function settled(el: StaffingMonthView) {
  for (let i = 0; i < 3; i++) {
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve));
  }
}
const root = (el: StaffingMonthView) => el.shadowRoot!;
const cell = (el: StaffingMonthView, date: string) =>
  root(el).querySelector<HTMLElement>(`td[data-date="${date}"]`)!;
const lines = (el: StaffingMonthView, date: string) =>
  [...cell(el, date).querySelectorAll<HTMLElement>("[data-test=area-line]")].map((line) =>
    line.textContent!.replace(/\s+/g, " ").trim(),
  );
const barWidth = (el: StaffingMonthView, date: string, index: number) =>
  cell(el, date)
    .querySelectorAll<HTMLElement>("[data-test=bar]")
    [index]!.style.getPropertyValue("--share");
const picker = (el: StaffingMonthView) =>
  root(el).querySelector<HTMLElementTagNameMap["wt-combobox"]>("wt-combobox[name=area]")!;
const press = (el: StaffingMonthView, test: string) =>
  root(el).querySelector<HTMLElement>(`[data-test=${test}]`)!.click();
const dayButton = (el: StaffingMonthView, date: string) =>
  cell(el, date).querySelector<HTMLButtonElement>("button.day");
const dayBox = (el: StaffingMonthView) => root(el).querySelector("calendar-day-box");
const boxButtons = (el: StaffingMonthView) =>
  [...(dayBox(el)?.querySelectorAll<HTMLElement>("wt-button") ?? [])].map((button) =>
    button.textContent!.trim(),
  );
async function openBox(el: StaffingMonthView, date: string) {
  await userEvent.click(dayButton(el, date)!);
  await settled(el);
  const box = dayBox(el)!;
  await vi.waitFor(() => expect(box.shown).toBe(true));
  return box;
}
async function pressBoxButton(el: StaffingMonthView, label: string) {
  const button = [...dayBox(el)!.querySelectorAll<HTMLElement>("wt-button")].find(
    (candidate) => candidate.textContent!.trim() === label,
  )!;
  expect(button).toBeDefined();
  button.click();
  await settled(el);
}
async function useViewport(width: number, height: number) {
  const before = [innerWidth, innerHeight] as const;
  await page.viewport(width, height);
  await vi.waitFor(() => expect(innerWidth).toBe(width));
  onTestFinished(() => page.viewport(...before));
}

describe("the Staffing view's month", () => {
  it("lists each painted area on each day by name and number, its bar as wide as its share of the month's largest", async () => {
    const { el } = await mount();
    expect(lines(el, "2026-12-01")).toEqual(["Restaurant 6", "Bar 2", "Kitchen 4"]);
    expect(lines(el, "2026-12-04")).toEqual(["Restaurant 8", "Bar 2", "Kitchen 5"]);
    expect(barWidth(el, "2026-12-04", 0)).toBe("1");
    expect(barWidth(el, "2026-12-01", 0)).toBe("0.75");
    expect(barWidth(el, "2026-12-01", 1)).toBe("0.25");
  });

  it("titles the month and names the weekdays Monday first", async () => {
    const { el } = await mount();
    expect(root(el).querySelector("[data-test=month]")!.textContent!.trim()).toBe("December 2026");
    expect(
      [...root(el).querySelectorAll("th")].map((th) => th.textContent!.trim()).slice(0, 2),
    ).toEqual(["Mon", "Tue"]);
    expect(root(el).querySelectorAll("tbody tr")).toHaveLength(5);
  });

  it("dims the days outside the month and marks today", async () => {
    const { el } = await mount();
    expect(cell(el, "2026-11-30").hasAttribute("data-outside")).toBe(true);
    expect(cell(el, "2027-01-03").hasAttribute("data-outside")).toBe(true);
    expect(cell(el, "2026-12-01").hasAttribute("data-outside")).toBe(false);
    expect(cell(el, "2026-12-02").querySelector("[aria-current=date]")).not.toBeNull();
    expect(cell(el, "2026-12-02").textContent).toContain("Today");
    expect(cell(el, "2026-12-03").querySelector("[aria-current]")).toBeNull();
  });

  it("says a day closed all day is closed, and draws no lines on a day with no paint", async () => {
    const { el } = await mount();
    expect(cell(el, "2026-12-07").querySelector("[data-test=closed]")!.textContent).toBe("Closed");
    expect(lines(el, "2026-12-07")).toEqual([]);
    expect(cell(el, "2026-12-08").querySelector("[data-test=closed]")).toBeNull();
  });

  it("names a special day on its date", async () => {
    const { el } = await mount();
    expect(cell(el, "2026-12-24").querySelector("[data-test=special]")!.textContent).toBe(
      "Christmas Eve",
    );
    expect(cell(el, "2026-12-23").querySelector("[data-test=special]")).toBeNull();
  });

  it("draws no seasons row and no legend", async () => {
    const { el } = await mount();
    expect(root(el).querySelector("[data-test=seasons]")).toBeNull();
    expect(root(el).querySelector(".legend")).toBeNull();
    expect(cell(el, "2026-11-30").dataset.tint).toBe("1");
    expect(cell(el, "2026-12-01").dataset.tint).toBe("2");
  });

  it("filters the days to one area, kept in the address, and back to every area", async () => {
    const { el, open } = await mount({ params: { month: "2026-12", week: "2026-11-30" } });
    expect(picker(el).value).toBe("all");
    expect(picker(el).options.map((option) => option.label)).toEqual([
      "All areas",
      "Restaurant",
      "Bar",
      "Kitchen",
    ]);
    picker(el).dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "station:st-kitchen" },
        bubbles: true,
        composed: true,
      }),
    );
    expect(open).toHaveBeenCalledWith("staffing", {
      month: "2026-12",
      week: "2026-11-30",
      area: "station:st-kitchen",
    });

    el.params = { month: "2026-12", area: "station:st-kitchen" };
    await settled(el);
    expect(picker(el).value).toBe("station:st-kitchen");
    expect(lines(el, "2026-12-01")).toEqual(["Kitchen 4"]);
    expect(barWidth(el, "2026-12-01", 0)).toBe("0.5");

    picker(el).dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "all" }, bubbles: true, composed: true }),
    );
    expect(open).toHaveBeenLastCalledWith("staffing", { month: "2026-12" });
  });

  it("does not ask again for the area already shown", async () => {
    const { el, open } = await mount();
    picker(el).dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "all" }, bubbles: true, composed: true }),
    );
    expect(open).not.toHaveBeenCalled();
  });

  it("shows every area for an area the venue no longer has", async () => {
    const { el } = await mount({ params: { month: "2026-12", area: "station:gone" } });
    expect(picker(el).value).toBe("all");
    expect(lines(el, "2026-12-01")).toHaveLength(3);
  });

  it("steps to the previous and next month, keeping the address's other words", async () => {
    const { el, open } = await mount({
      params: { month: "2026-12", area: "department:dep-bar" },
    });
    press(el, "next-month");
    expect(open).toHaveBeenLastCalledWith("staffing", {
      month: "2027-01",
      area: "department:dep-bar",
    });
    press(el, "previous-month");
    expect(open).toHaveBeenLastCalledWith("staffing", {
      month: "2026-11",
      area: "department:dep-bar",
    });
  });

  it("goes no further than the months the read serves", async () => {
    const { el: first, open } = await mount({ month: "0100-02" });
    expect(
      root(first).querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=previous-month]")!
        .disabled,
    ).toBe(true);
    press(first, "previous-month");
    expect(open).not.toHaveBeenCalled();
    const { el: last } = await mount({ month: "9998-12" });
    expect(
      root(last).querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=next-month]")!
        .disabled,
    ).toBe(true);
  });

  it("reads the host's new month when it changes, titling it before the read answers", async () => {
    let answer: (month: StaffingMonth) => void = () => undefined;
    const { api, request } = fakeApi(async (month) =>
      month === "2026-12"
        ? staffingMonth(month)
        : new Promise<StaffingMonth>((resolve) => {
            answer = resolve;
          }),
    );
    const { el } = await mount({ api });
    el.month = "2027-01";
    await settled(el);
    expect(request).toHaveBeenCalledWith(
      "/management-api/staffing/month?month=2027-01",
      "GET",
      undefined,
      { passive: true },
    );
    expect(root(el).querySelector("[data-test=month]")!.textContent!.trim()).toBe("January 2027");
    expect(root(el).querySelector("table")).toBeNull();
    expect(root(el).querySelector("[data-test=loading]")).not.toBeNull();
    answer(staffingMonth("2027-01"));
    await settled(el);
    expect(cell(el, "2027-01-05")).not.toBeNull();
  });

  it("draws nothing and reads nothing until the host names a month", async () => {
    const { api, request } = fakeApi();
    const { el } = await mount({ api, month: "" });
    expect(root(el).children).toHaveLength(0);
    expect(request).not.toHaveBeenCalled();
  });

  it("reads the month again after being taken off the page and put back", async () => {
    const { api, request } = fakeApi();
    const { el } = await mount({ api });
    const frame = el.parentElement!;
    el.remove();
    frame.append(el);
    await settled(el);
    expect(request.mock.calls.filter(([path]) => path.includes("/month?"))).toHaveLength(2);
  });

  it("asks for the month alone on each read, the areas' names coming with it", async () => {
    const liveData = new LiveData();
    const { api, request } = fakeApi(undefined, liveData);
    const { el } = await mount({ api });
    const asked = [
      "/management-api/staffing/month?month=2026-12",
      "GET",
      undefined,
      { passive: true },
    ];
    expect(request.mock.calls).toEqual([asked]);
    liveData.invalidate([{ type: "staffing_blocks" }]);
    await vi.waitFor(() => expect(request.mock.calls).toEqual([asked, asked]));
    expect(lines(el, "2026-12-01")).toEqual(["Restaurant 6", "Bar 2", "Kitchen 4"]);
    liveData.clear();
  });

  it("offers an area the month does not paint", async () => {
    const terrace = { area: { kind: "department", id: "dep-terrace" } as const, name: "Terrace" };
    const { api } = fakeApi(async (month) => {
      const read = staffingMonth(month);
      return { ...read, areas: [...read.areas, terrace] };
    });
    const { el } = await mount({ api });
    expect(picker(el).options.map((option) => option.label)).toEqual([
      "All areas",
      "Restaurant",
      "Bar",
      "Kitchen",
      "Terrace",
    ]);
  });

  it("leaves a day no season holds untinted, and an area the month does not name unnamed", async () => {
    const { api } = fakeApi(async (month) => {
      const read = staffingMonth(month);
      read.days[1] = { ...read.days[1]!, seasonId: null };
      read.days[2] = {
        ...read.days[2]!,
        areas: [{ area: { kind: "station", id: "st-new" }, needed: 3, unfilled: null }],
      };
      return read;
    });
    const { el } = await mount({ api });
    expect(cell(el, "2026-12-01").hasAttribute("data-tint")).toBe(false);
    expect(lines(el, "2026-12-02")).toEqual(["3"]);
  });

  it("shows why the month could not be read", async () => {
    const { api } = fakeApi(() => Promise.reject({ code: "connection.failed" }));
    const { el } = await mount({ api });
    const alert = root(el).querySelector("[data-test=load-error]")!;
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain("Could not load the staffing");
    expect(root(el).querySelector("[data-test=loading]")).toBeNull();
  });

  it("keeps the month shown above a later read's failure, and clears it once a read succeeds", async () => {
    let fail = false;
    const liveData = new LiveData();
    const { api } = fakeApi(async (month) => {
      if (fail) throw { code: "connection.failed" };
      return staffingMonth(month);
    }, liveData);
    const { el } = await mount({ api });
    fail = true;
    liveData.invalidate([{ type: "staffing_blocks" }]);
    await vi.waitFor(() => expect(root(el).querySelector("[data-test=load-error]")).not.toBeNull());
    expect(cell(el, "2026-12-01")).not.toBeNull();
    fail = false;
    liveData.invalidate([{ type: "staff_roles" }]);
    await vi.waitFor(() => expect(root(el).querySelector("[data-test=load-error]")).toBeNull());
    liveData.clear();
  });

  it("reads the same whether or not the person may write, every day a button for both", async () => {
    const { el } = await mount();
    const markup = (node: Element, part: "outerHTML" | "innerHTML") =>
      node[part].replace(/<!--[^]*?-->/g, "");
    const drawn = () => {
      const table = root(el).querySelector("table")!;
      return {
        head: markup(table.querySelector("thead")!, "outerHTML"),
        cells: [...table.querySelectorAll("tbody td")].map((td) => {
          const day = td.querySelector<HTMLElement>(".day")!;
          return {
            attributes: [...td.attributes].map(({ name, value }) => `${name}=${value}`),
            label: day.getAttribute("aria-label"),
            current: day.getAttribute("aria-current"),
            body: markup(day, "innerHTML"),
            bars: [...day.querySelectorAll<HTMLElement>("[data-test=bar]")].map((bar) => [
              bar.style.getPropertyValue("--share"),
              bar.hasAttribute("data-none"),
            ]),
          };
        }),
      };
    };
    const before = drawn();
    expect(before.cells.some(({ current }) => current === "date")).toBe(true);
    expect(cell(el, "2026-12-02").querySelector("button.day")).not.toBeNull();
    el.canWrite = true;
    await settled(el);
    expect(cell(el, "2026-12-02").querySelector("button.day")).not.toBeNull();
    expect(drawn()).toEqual(before);
  });

  it("speaks Spanish", async () => {
    setLocale("es");
    const { el } = await mount();
    expect(root(el).querySelector("[data-test=month]")!.textContent!.trim()).toBe("diciembre 2026");
    expect(cell(el, "2026-12-07").querySelector("[data-test=closed]")!.textContent).toBe("Cerrado");
    expect(picker(el).options[0]!.label).toBe("Todas las áreas");
  });

  it("fits a phone's width without scrolling sideways", async () => {
    const { el } = await mount({ width: "390px" });
    expect(el.scrollWidth).toBeLessThanOrEqual(390);
    for (const part of root(el).querySelectorAll<HTMLElement>("table, .head, .day"))
      expect(part.getBoundingClientRect().right).toBeLessThanOrEqual(
        el.parentElement!.getBoundingClientRect().right + 0.5,
      );
  });

  it("the box wraps a long unbroken season name inside a phone's width", async () => {
    await useViewport(390, 800);
    const name = "W".repeat(80);
    const { api } = fakeApi(async (month) => {
      const read = staffingMonth(month);
      read.seasons = [...read.seasons.slice(0, 1), { ...read.seasons[1]!, name }];
      return read;
    });
    const { el } = await mount({ api, width: "390px", canWrite: true });
    const box = await openBox(el, "2026-12-03");
    expect(box.line).toBe(`${name} standard staffing`);
    const popup = box.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
    const placed = popup.getBoundingClientRect();
    expect(placed.left).toBeGreaterThanOrEqual(0);
    expect(placed.right).toBeLessThanOrEqual(390);
    expect(popup.scrollWidth).toBeLessThanOrEqual(popup.clientWidth);
    const line = box.shadowRoot!.querySelector<HTMLElement>("[data-test=line]")!;
    expect(line.textContent).toContain(name);
    expect(line.getBoundingClientRect().right).toBeLessThanOrEqual(placed.right);
    for (const button of box.querySelectorAll<HTMLElement>("wt-button"))
      expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(placed.right);
  });

  it("draws no bar for an area that needs nobody, beside its 0", async () => {
    const { api } = fakeApi(async (month) => {
      const read = staffingMonth(month);
      const day = read.days.findIndex(({ date }) => date === "2026-12-01");
      read.days[day] = {
        ...read.days[day]!,
        areas: read.days[day]!.areas.map((line, index) =>
          index === 0 ? { ...line, needed: 0 } : line,
        ),
      };
      return read;
    });
    for (const width of ["1280px", "390px"]) {
      const { el } = await mount({ api, width });
      expect(lines(el, "2026-12-01")[0]).toBe("Restaurant 0");
      const bars = cell(el, "2026-12-01").querySelectorAll<HTMLElement>("[data-test=bar]");
      expect(bars[0]!.getBoundingClientRect().width).toBe(0);
      expect(bars[1]!.getBoundingClientRect().width).toBeGreaterThan(0);
    }
  });

  it("puts each bar above its label on a phone, and beside it on a wide screen", async () => {
    const { el: wide } = await mount({ width: "1280px" });
    const wideLine = cell(wide, "2026-12-01").querySelector<HTMLElement>("[data-test=area-line]")!;
    const wideBar = wideLine.querySelector("[data-test=bar]")!.getBoundingClientRect();
    const wideLabel = wideLine.querySelector(".label")!.getBoundingClientRect();
    expect(wideBar.right).toBeLessThanOrEqual(wideLabel.left);
    expect(wideBar.bottom).toBeGreaterThan(wideLabel.top);

    const { el: phone } = await mount({ width: "390px" });
    const line = cell(phone, "2026-12-01").querySelector<HTMLElement>("[data-test=area-line]")!;
    const bar = line.querySelector("[data-test=bar]")!.getBoundingClientRect();
    const label = line.querySelector(".label")!.getBoundingClientRect();
    expect(getComputedStyle(line).flexDirection).toBe("column");
    expect(bar.bottom).toBeLessThanOrEqual(label.top);
  });

  it("keeps an area's and a special day's name on one line on a phone, the number always shown", async () => {
    const { el } = await mount({ width: "390px" });
    const day = cell(el, "2026-12-24");
    const dayBox = day.querySelector(".day")!.getBoundingClientRect();
    const lineHeight = day.querySelector<HTMLElement>(".date")!.getBoundingClientRect().height;
    for (const line of day.querySelectorAll<HTMLElement>("[data-test=area-line]")) {
      const name = line.querySelector<HTMLElement>("[data-test=area-name]")!;
      const count = line.querySelector<HTMLElement>("[data-test=area-count]")!;
      expect(name.title).toBe(name.textContent);
      expect(name.getBoundingClientRect().height).toBeLessThanOrEqual(lineHeight + 0.5);
      expect(count.getBoundingClientRect().width).toBeGreaterThan(0);
      expect(count.getBoundingClientRect().right).toBeLessThanOrEqual(dayBox.right + 0.5);
    }
    const special = day.querySelector<HTMLElement>("[data-test=special]")!;
    expect(special.title).toBe("Christmas Eve");
    expect(special.getBoundingClientRect().height).toBeLessThanOrEqual(lineHeight + 0.5);
  });

  it("keeps the area picker in place while the next month is read", async () => {
    let answer: (month: StaffingMonth) => void = () => undefined;
    const { api } = fakeApi(async (month) =>
      month === "2026-12"
        ? staffingMonth(month)
        : new Promise<StaffingMonth>((resolve) => {
            answer = resolve;
          }),
    );
    const { el } = await mount({ api });
    el.month = "2027-01";
    await settled(el);
    expect(root(el).querySelector("[data-test=loading]")).not.toBeNull();
    expect(picker(el).options.map((option) => option.label)).toEqual([
      "All areas",
      "Restaurant",
      "Bar",
      "Kitchen",
    ]);
    answer(staffingMonth("2027-01"));
    await settled(el);
    expect(picker(el)).not.toBeNull();
    expect(cell(el, "2027-01-05")).not.toBeNull();
  });

  describe("opening the season painter", () => {
    it("makes each season day a button for a person who may write, opening its season", async () => {
      const { el, open } = await mount({
        canWrite: true,
        params: { month: "2026-12", area: "department:dep-bar", week: "2026-11-30" },
      });
      const day = dayButton(el, "2026-12-04")!;
      expect(day.getAttribute("aria-label")).toBe("Friday 4 December, Bar 2");
      expect(lines(el, "2026-12-04")).toEqual(["Bar 2"]);
      await openBox(el, "2026-12-04");
      await pressBoxButton(el, "Edit Winter's standard week");
      expect(open).toHaveBeenCalledWith("staffing", {
        month: "2026-12",
        area: "department:dep-bar",
        painter: "season",
        season: "winter",
      });
      await openBox(el, "2026-11-30");
      await pressBoxButton(el, "Edit Autumn's standard week");
      expect(open).toHaveBeenLastCalledWith("staffing", {
        month: "2026-12",
        area: "department:dep-bar",
        painter: "season",
        season: "autumn",
      });
    });

    it("makes a day no season holds a button too, its box offering no week", async () => {
      const { api } = fakeApi(async (month) => {
        const read = staffingMonth(month);
        read.days[1] = { ...read.days[1]!, seasonId: null };
        return read;
      });
      const { el } = await mount({ api, canWrite: true });
      expect(dayButton(el, "2026-12-24")).not.toBeNull();
      expect(root(el).querySelector(".day[role=group]")).toBeNull();
      expect(dayButton(el, "2026-12-01")).not.toBeNull();
      expect(dayButton(el, "2026-12-02")).not.toBeNull();
      const box = await openBox(el, "2026-12-01");
      expect(box.line).toBe("");
      expect(boxButtons(el)).toEqual([]);
    });

    it("makes a special day a button for a person who may write, opening its special day, whatever season holds it", async () => {
      const { api } = fakeApi(async (month) => {
        const read = staffingMonth(month);
        const eve = read.days.findIndex(({ date }) => date === "2026-12-24");
        read.days[eve] = { ...read.days[eve]!, seasonId: null };
        return read;
      });
      const { el, open } = await mount({
        api,
        canWrite: true,
        params: { month: "2026-12", area: "department:dep-bar" },
      });
      const day = dayButton(el, "2026-12-24")!;
      expect(day.getAttribute("aria-label")).toBe("Thursday 24 December, Christmas Eve, Bar 2");
      expect(day.querySelector("[data-test=special]")!.textContent).toBe("Christmas Eve");
      await openBox(el, "2026-12-24");
      await pressBoxButton(el, "Edit Christmas Eve staffing");
      expect(open).toHaveBeenCalledWith("staffing", {
        month: "2026-12",
        area: "department:dep-bar",
        painter: "special-day",
        "special-day": "sd-eve",
      });
    });

    it("names a day button by its date, special day, closing, Today and each shown area's number", async () => {
      const { el } = await mount({
        canWrite: true,
        params: { month: "2026-12", area: "department:dep-bar" },
      });
      expect(dayButton(el, "2026-12-24")!.getAttribute("aria-label")).toBe(
        "Thursday 24 December, Christmas Eve, Bar 2",
      );
      expect(dayButton(el, "2026-12-02")!.getAttribute("aria-label")).toBe(
        "Wednesday 2 December, Today, Bar 2",
      );
      expect(dayButton(el, "2026-12-07")!.getAttribute("aria-label")).toBe(
        "Monday 7 December, Closed",
      );
      const { el: every } = await mount({ canWrite: true });
      expect(dayButton(every, "2026-12-24")!.getAttribute("aria-label")).toBe(
        "Thursday 24 December, Christmas Eve, Restaurant 6, Bar 2, Kitchen 4",
      );
    });

    it("names a day button in Spanish", async () => {
      setLocale("es");
      const { el } = await mount({
        canWrite: true,
        params: { month: "2026-12", area: "station:st-kitchen" },
      });
      expect(dayButton(el, "2026-12-02")!.getAttribute("aria-label")).toBe(
        "miércoles, 2 de diciembre, Hoy, Kitchen 4",
      );
      expect(dayButton(el, "2026-12-07")!.getAttribute("aria-label")).toBe(
        "lunes, 7 de diciembre, Cerrado",
      );
    });

    it("opens a special day without an area when the month shows every area", async () => {
      const { el, open } = await mount({ canWrite: true });
      await openBox(el, "2026-12-24");
      await pressBoxButton(el, "Edit Christmas Eve staffing");
      expect(open).toHaveBeenCalledWith("staffing", {
        month: "2026-12",
        painter: "special-day",
        "special-day": "sd-eve",
      });
    });

    it("draws every day as a button for a person who may only look", async () => {
      const { el } = await mount();
      expect(root(el).querySelectorAll("td button.day")).toHaveLength(35);
      expect(root(el).querySelector(".day[role=group]")).toBeNull();
    });

    it("opens a special day's staffing from its date for a person who may only look", async () => {
      const { el, open } = await mount({
        params: { month: "2026-12", area: "department:dep-bar" },
      });
      const day = dayButton(el, "2026-12-24")!;
      expect(day.getAttribute("aria-label")).toBe("Thursday 24 December, Christmas Eve, Bar 2");
      expect(day.tabIndex).toBe(-1);
      await openBox(el, "2026-12-24");
      await pressBoxButton(el, "Show Christmas Eve staffing");
      expect(open).toHaveBeenCalledWith("staffing", {
        month: "2026-12",
        area: "department:dep-bar",
        painter: "special-day",
        "special-day": "sd-eve",
      });
    });

    it("opens a season from a day's box, keeping the month and area", async () => {
      const { el, open } = await mount({
        canWrite: true,
        params: { month: "2026-12", area: "station:st-kitchen" },
      });
      await openBox(el, "2026-11-30");
      await pressBoxButton(el, "Edit Autumn's standard week");
      expect(open).toHaveBeenCalledWith("staffing", {
        month: "2026-12",
        area: "station:st-kitchen",
        painter: "season",
        season: "autumn",
      });
    });

    it("opens a season without an area when the month shows every area", async () => {
      const { el, open } = await mount({ canWrite: true });
      await openBox(el, "2026-11-30");
      await pressBoxButton(el, "Edit Autumn's standard week");
      expect(open).toHaveBeenCalledWith("staffing", {
        month: "2026-12",
        painter: "season",
        season: "autumn",
      });
    });

    it("gives the days one Tab stop, today, and moves it with the arrow keys one day at a time", async () => {
      const { api } = fakeApi(async (month) => {
        const read = staffingMonth(month);
        const day = read.days.findIndex(({ date }) => date === "2026-12-25");
        read.days[day] = { ...read.days[day]!, seasonId: null };
        return read;
      });
      const { el } = await mount({ api, canWrite: true });
      const stops = [...root(el).querySelectorAll<HTMLButtonElement>("button.day")].filter(
        (button) => button.tabIndex === 0,
      );
      expect(stops.map((button) => button.closest("td")!.dataset.date)).toEqual(["2026-12-02"]);
      const press = async (date: string, key: string) => {
        dayButton(el, date)!.focus();
        dayButton(el, date)!.dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true, composed: true }),
        );
        await settled(el);
        return el.shadowRoot!.activeElement?.closest("td")?.dataset.date;
      };
      expect(await press("2026-12-02", "ArrowRight")).toBe("2026-12-03");
      expect(dayButton(el, "2026-12-03")!.tabIndex).toBe(0);
      expect(dayButton(el, "2026-12-02")!.tabIndex).toBe(-1);
      expect(await press("2026-12-03", "ArrowLeft")).toBe("2026-12-02");
      expect(await press("2026-12-02", "ArrowDown")).toBe("2026-12-09");
      expect(await press("2026-12-09", "ArrowUp")).toBe("2026-12-02");
      expect(await press("2026-12-23", "ArrowRight")).toBe("2026-12-24");
      expect(await press("2026-12-24", "ArrowRight")).toBe("2026-12-25");
      expect(await press("2026-12-17", "ArrowDown")).toBe("2026-12-24");
      expect(await press("2026-12-18", "ArrowDown")).toBe("2026-12-25");
      expect(await press("2027-01-03", "ArrowRight")).toBe("2027-01-03");
      expect(await press("2026-11-30", "ArrowUp")).toBe("2026-11-30");
      expect(await press("2026-12-02", "Enter")).toBe("2026-12-02");
    });

    it("puts the Tab stop on the month's first day when today is not shown", async () => {
      const { api } = fakeApi(async (month) => ({ ...staffingMonth(month), today: null }));
      const { el } = await mount({ api, canWrite: true });
      expect(
        root(el).querySelector<HTMLButtonElement>("button.day[tabindex='0']")!.closest("td")!
          .dataset.date,
      ).toBe("2026-12-01");
    });

    it("puts a person who may only look's Tab stop on today, or the month's first day without one", async () => {
      const stops = (el: StaffingMonthView) =>
        [...root(el).querySelectorAll<HTMLButtonElement>("button.day")]
          .filter((button) => button.tabIndex === 0)
          .map((button) => button.closest("td")!.dataset.date);
      const { el } = await mount();
      expect(stops(el)).toEqual(["2026-12-02"]);
      const { api } = fakeApi(async (month) => ({ ...staffingMonth(month), today: null }));
      const { el: noToday } = await mount({ api });
      expect(stops(noToday)).toEqual(["2026-12-01"]);
    });

    it("leaves the painter's words behind when the month or area changes", async () => {
      const { el, open } = await mount({
        canWrite: true,
        params: {
          month: "2026-12",
          area: "department:dep-bar",
          painter: "season",
          season: "winter",
          "special-day": "sd-eve",
        },
      });
      press(el, "next-month");
      expect(open).toHaveBeenLastCalledWith("staffing", {
        month: "2027-01",
        area: "department:dep-bar",
      });
      picker(el).dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "all" }, bubbles: true, composed: true }),
      );
      expect(open).toHaveBeenLastCalledWith("staffing", { month: "2026-12" });
    });

    it("fits a phone's width with its day buttons", async () => {
      const { el } = await mount({ width: "390px", canWrite: true });
      expect(el.scrollWidth).toBeLessThanOrEqual(390);
      for (const part of root(el).querySelectorAll<HTMLElement>("table, .head, .day"))
        expect(part.getBoundingClientRect().right).toBeLessThanOrEqual(
          el.parentElement!.getBoundingClientRect().right + 0.5,
        );
      const button = dayButton(el, "2026-12-02")!.getBoundingClientRect();
      const td = cell(el, "2026-12-02").getBoundingClientRect();
      expect(button.width).toBeCloseTo(td.width, 0);
    });
  });
});

describe("the day box", () => {
  it("a writer's season day opens its box with Edit Winter's standard week, which opens the season painter keeping month and area", async () => {
    const { el, open } = await mount({
      canWrite: true,
      params: { month: "2026-12", area: "department:dep-bar", week: "2026-11-30" },
    });
    const box = await openBox(el, "2026-12-04");
    expect(box.heading).toBe("Fri, 4 Dec 2026");
    expect(boxButtons(el)).toEqual(["Edit Winter's standard week"]);
    expect(open).not.toHaveBeenCalled();
    await pressBoxButton(el, "Edit Winter's standard week");
    expect(open).toHaveBeenCalledWith("staffing", {
      month: "2026-12",
      area: "department:dep-bar",
      painter: "season",
      season: "winter",
    });
    expect(box.shown).toBe(false);
  });

  it("a writer's special day offers Edit Christmas Eve staffing", async () => {
    const { api } = fakeApi(async (month) => {
      const read = staffingMonth(month);
      const eve = read.days.findIndex(({ date }) => date === "2026-12-24");
      read.days[eve] = { ...read.days[eve]!, seasonId: null };
      return read;
    });
    const { el, open } = await mount({
      api,
      canWrite: true,
      params: { month: "2026-12", area: "department:dep-bar" },
    });
    const box = await openBox(el, "2026-12-24");
    expect(box.name).toBe("Christmas Eve");
    expect(box.nameKind).toBe("special");
    expect(boxButtons(el)).toEqual(["Edit Christmas Eve staffing"]);
    await pressBoxButton(el, "Edit Christmas Eve staffing");
    expect(open).toHaveBeenCalledWith("staffing", {
      month: "2026-12",
      area: "department:dep-bar",
      painter: "special-day",
      "special-day": "sd-eve",
    });
  });

  it("a writer's special day a season holds offers no Edit Winter's standard week", async () => {
    const { el } = await mount({ canWrite: true });
    const box = await openBox(el, "2026-12-24");
    expect(box.line).toBe("Special day — replaces Winter's standard staffing");
    expect(boxButtons(el)).toEqual(["Edit Christmas Eve staffing"]);
  });

  it("a viewer's box offers Show Christmas Eve staffing and Show Winter's standard week", async () => {
    const { el, open } = await mount({ params: { month: "2026-12", area: "department:dep-bar" } });
    await openBox(el, "2026-12-24");
    expect(boxButtons(el)).toEqual(["Show Christmas Eve staffing", "Show Winter's standard week"]);
    await pressBoxButton(el, "Show Christmas Eve staffing");
    expect(open).toHaveBeenLastCalledWith("staffing", {
      month: "2026-12",
      area: "department:dep-bar",
      painter: "special-day",
      "special-day": "sd-eve",
    });
    await openBox(el, "2026-12-24");
    await pressBoxButton(el, "Show Winter's standard week");
    expect(open).toHaveBeenLastCalledWith("staffing", {
      month: "2026-12",
      area: "department:dep-bar",
      painter: "season",
      season: "winter",
    });
    await openBox(el, "2026-12-03");
    expect(boxButtons(el)).toEqual(["Show Winter's standard week"]);
  });

  it("every day of the grid is a button, and the arrows move one day at a time", async () => {
    const { el } = await mount();
    const days = [...root(el).querySelectorAll("tbody td")];
    expect(days).toHaveLength(35);
    for (const day of days) expect(day.querySelector("button.day")).not.toBeNull();
    dayButton(el, "2026-12-02")!.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(root(el).activeElement?.closest("td")?.dataset.date).toBe("2026-12-03");
    await userEvent.keyboard("{ArrowDown}");
    expect(root(el).activeElement?.closest("td")?.dataset.date).toBe("2026-12-10");
    await userEvent.keyboard("{ArrowLeft}");
    expect(root(el).activeElement?.closest("td")?.dataset.date).toBe("2026-12-09");
  });

  it("the box names the season it follows and each shown area's number", async () => {
    const { el } = await mount({ params: { month: "2026-12", area: "department:dep-bar" } });
    const box = await openBox(el, "2026-12-03");
    expect(box.line).toBe("Winter standard staffing");
    expect(box.name).toBe("");
    expect(box.rows).toEqual([{ name: "Bar", text: "2" }]);
    await openBox(el, "2026-12-24");
    expect(box.line).toBe("Special day — replaces Winter's standard staffing");
    await openBox(el, "2026-12-07");
    expect(box.rows).toEqual([]);
    expect(box.message).toBe("Closed");
    const { el: every } = await mount();
    const all = await openBox(every, "2026-12-03");
    expect(all.rows).toEqual([
      { name: "Restaurant", text: "6" },
      { name: "Bar", text: "2" },
      { name: "Kitchen", text: "4" },
    ]);
  });

  it("the box rows carry each area's unfilled count", async () => {
    const { api } = fakeApi(async (month) => {
      const read = staffingMonth(month);
      read.days.find((day) => day.date === "2026-12-01")!.areas[1]!.unfilled = 1;
      return read;
    });
    const { el } = await mount({ api });
    const box = await openBox(el, "2026-12-01");
    expect(box.rows).toEqual([
      { name: "Restaurant", text: "6" },
      { name: "Bar", text: "2, 1 unfilled" },
      { name: "Kitchen", text: "4" },
    ]);
  });

  it("offers Rota for this week on any day, opening its row's Monday, last after the painter buttons", async () => {
    const { el, open } = await mount({
      canWrite: true,
      canOpenRota: true,
      params: { month: "2026-12", area: "department:dep-restaurant" },
    });
    await openBox(el, "2026-12-03");
    expect(boxButtons(el)).toEqual(["Edit Winter's standard week", "Rota for this week"]);
    await pressBoxButton(el, "Rota for this week");
    expect(open).toHaveBeenCalledWith("rota", {
      week: "2026-11-30",
      area: "department:dep-restaurant",
    });
    const { el: every, open: openEvery } = await mount({ canOpenRota: true });
    await openBox(every, "2026-12-13");
    await pressBoxButton(every, "Rota for this week");
    expect(openEvery).toHaveBeenCalledWith("rota", { week: "2026-12-07" });
  });

  describe("kept inside the window once its buttons and rows have drawn", () => {
    const manyAreas = () =>
      fakeApi(async (month) => {
        const read = staffingMonth(month);
        const extra = Array.from({ length: 6 }, (_, index) => ({
          area: { kind: "department" as const, id: `dep-extra-${index}` },
          name: `Terrace and private dining room ${index + 1}`,
        }));
        read.areas = [...read.areas, ...extra];
        for (const day of read.days)
          if (!day.closedAllDay)
            day.areas = [
              ...day.areas,
              ...extra.map(({ area }) => ({ area, needed: 3, unfilled: null })),
            ];
        return read;
      }).api;
    // Where the box sits, read against the window and against the day it opened from.
    const placement = (box: HTMLElementTagNameMap["calendar-day-box"], day: HTMLElement) => {
      const placed = box.shadowRoot!.querySelector("[popover]")!.getBoundingClientRect();
      const date = day.getBoundingClientRect();
      return {
        left: placed.left >= -0.5,
        right: placed.right <= innerWidth + 0.5,
        top: placed.top >= -0.5,
        bottom: placed.bottom <= innerHeight + 0.5,
        clearOfTheDay: placed.bottom <= date.top + 0.5 || placed.top >= date.bottom - 0.5,
      };
    };
    const kept = { left: true, right: true, top: true, bottom: true, clearOfTheDay: true };

    it("on a Sunday at the right edge of a wide window", async () => {
      await useViewport(1280, 800);
      const { el } = await mount({ api: manyAreas(), canWrite: true, canOpenRota: true });
      const box = await openBox(el, "2026-12-06");
      expect(boxButtons(el)).toEqual(["Edit Winter's standard week", "Rota for this week"]);
      expect(placement(box, dayButton(el, "2026-12-06")!)).toEqual(kept);
    });

    it("above a day in the bottom row of a phone, when below it does not fit", async () => {
      await useViewport(390, 800);
      const { el } = await mount({
        api: manyAreas(),
        width: "390px",
        canWrite: true,
        canOpenRota: true,
      });
      const day = dayButton(el, "2026-12-30")!;
      el.parentElement!.style.paddingTop = `${innerHeight - 40 - day.getBoundingClientRect().bottom}px`;
      const box = await openBox(el, "2026-12-30");
      expect(boxButtons(el)).toEqual(["Edit Winter's standard week", "Rota for this week"]);
      expect(placement(box, day)).toEqual(kept);
    });

    it("when a new read makes it bigger while it is open", async () => {
      await useViewport(390, 800);
      let special = false;
      const liveData = new LiveData();
      onTestFinished(() => liveData.clear());
      const name = "Private dinner for the restaurant's twentieth anniversary with the whole team";
      const { api } = fakeApi(async (month) => {
        const read = staffingMonth(month);
        const day = read.days.find(({ date }) => date === "2026-12-30")!;
        if (special) day.specialDay = { id: "sd-party", name };
        return read;
      }, liveData);
      const { el } = await mount({ api, width: "390px", canWrite: true, canOpenRota: true });
      const day = dayButton(el, "2026-12-30")!;
      el.parentElement!.style.paddingTop = `${innerHeight - 40 - day.getBoundingClientRect().bottom}px`;
      const box = await openBox(el, "2026-12-30");
      expect(placement(box, day)).toEqual(kept);
      const before = box.shadowRoot!.querySelector("[popover]")!.getBoundingClientRect().height;
      special = true;
      liveData.invalidate([{ type: "staffing_blocks" }]);
      await vi.waitFor(() => expect(box.name).toBe(name));
      await settled(el);
      expect(
        box.shadowRoot!.querySelector("[popover]")!.getBoundingClientRect().height,
      ).toBeGreaterThan(before);
      expect(box.shown).toBe(true);
      expect(placement(box, day)).toEqual(kept);
    });
  });

  it("offers no Rota for this week to a person who may not open the rota", async () => {
    const { el } = await mount({ canWrite: true });
    await openBox(el, "2026-12-03");
    expect(boxButtons(el)).toEqual(["Edit Winter's standard week"]);
  });

  it("closes the box when the month changes, and leaves it closed on the month's return", async () => {
    const { el } = await mount();
    await openBox(el, "2026-12-03");
    el.month = "2027-01";
    await settled(el);
    expect(dayBox(el)).toBeNull();
    el.month = "2026-12";
    await settled(el);
    expect(dayBox(el)).toBeNull();
    const box = await openBox(el, "2026-12-03");
    expect(box.line).toBe("Winter standard staffing");
  });

  it("a box button closes the box, focus back on its day, before it acts", async () => {
    const { el, open } = await mount({ canWrite: true });
    const seen: { focused: Element | null; shown: boolean }[] = [];
    open.mockImplementation(() => {
      seen.push({ focused: root(el).activeElement, shown: dayBox(el)!.shown });
    });
    await openBox(el, "2026-12-03");
    await pressBoxButton(el, "Edit Winter's standard week");
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(seen).toEqual([{ focused: dayButton(el, "2026-12-03"), shown: false }]);
  });

  it("acts once and stays closed when a new read arrives as a box button closes it", async () => {
    const { el, open } = await mount({ canWrite: true });
    await openBox(el, "2026-12-03");
    dayBox(el)!.querySelector<HTMLElement>("wt-button")!.click();
    const view = el as unknown as { read: StaffingMonth };
    view.read = { ...view.read };
    await settled(el);
    expect(open).toHaveBeenCalledTimes(1);
    expect(dayBox(el)).toBeNull();
  });

  it("acts on no close a button did not ask for, nor on one pressed before the box was shown", async () => {
    const { el, open } = await mount({ canWrite: true });
    await openBox(el, "2026-12-03");
    await userEvent.keyboard("{Escape}");
    await settled(el);
    expect(dayBox(el)).toBeNull();
    dayButton(el, "2026-12-04")!.click();
    await el.updateComplete;
    const box = dayBox(el)!;
    expect(box.shown).toBe(false);
    box.querySelector<HTMLElement>("wt-button")!.click();
    await settled(el);
    await vi.waitFor(() => expect(box.shown).toBe(true));
    await userEvent.keyboard("{Escape}");
    await settled(el);
    expect(dayBox(el)).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it("does not act on a box button pressed as the month changes", async () => {
    const { el, open } = await mount({ canWrite: true });
    await openBox(el, "2026-12-03");
    dayBox(el)!.querySelector<HTMLElement>("wt-button")!.click();
    el.month = "2027-01";
    await settled(el);
    expect(dayBox(el)).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it("does not act on a box button pressed as the month is taken off the page", async () => {
    const { el, open } = await mount({ canWrite: true });
    await openBox(el, "2026-12-03");
    dayBox(el)!.querySelector<HTMLElement>("wt-button")!.click();
    el.remove();
    await settled(el);
    expect(open).not.toHaveBeenCalled();
  });

  it("keeps its close to itself", async () => {
    const { el } = await mount();
    const heard = vi.fn();
    el.parentElement!.addEventListener("calendar-day-box-close", heard);
    await openBox(el, "2026-12-03");
    await userEvent.keyboard("{Escape}");
    await settled(el);
    expect(dayBox(el)).toBeNull();
    expect(heard).not.toHaveBeenCalled();
  });

  it("names a special day no season holds", async () => {
    const { api } = fakeApi(async (month) => {
      const read = staffingMonth(month);
      const eve = read.days.findIndex(({ date }) => date === "2026-12-24");
      read.days[eve] = { ...read.days[eve]!, seasonId: null };
      return read;
    });
    const { el } = await mount({ api });
    expect((await openBox(el, "2026-12-24")).line).toBe("Special day");
    await userEvent.keyboard("{Escape}");
    await settled(el);
    setLocale("es");
    el.requestUpdate();
    await settled(el);
    expect((await openBox(el, "2026-12-24")).line).toBe("Día especial");
  });

  it("moves focus into the box as it opens, and back to its day when it closes", async () => {
    const { el } = await mount({ canWrite: true });
    const box = await openBox(el, "2026-12-03");
    expect(box.shadowRoot!.activeElement?.id).toBe("heading");
    await userEvent.keyboard("{Escape}");
    await settled(el);
    expect(dayBox(el)).toBeNull();
    expect(root(el).activeElement).toBe(dayButton(el, "2026-12-03"));
  });

  it("opens no box for a day clicked as the month is taken off the page", async () => {
    const { el } = await mount();
    dayButton(el, "2026-12-03")!.click();
    await el.updateComplete;
    el.remove();
    await settled(el);
    expect(dayBox(el)!.shown).toBe(false);
  });

  it("opens no box for a day clicked as the month changes", async () => {
    const { el } = await mount();
    dayButton(el, "2026-12-03")!.click();
    await el.updateComplete;
    el.month = "2027-01";
    await settled(el);
    expect(dayBox(el)).toBeNull();
  });

  it("names the season in Spanish", async () => {
    setLocale("es");
    const { el } = await mount();
    const box = await openBox(el, "2026-12-03");
    expect(box.line).toBe("Personal habitual de Winter");
    await openBox(el, "2026-12-24");
    expect(box.line).toBe("Día especial: sustituye el personal habitual de Winter");
  });
});

describe("the month opens its rota week", () => {
  it("opens the Monday's rota retaining the selected area and lists unfilled counts", async () => {
    const client = fakeApi(async (month) => {
      const r = staffingMonth(month);
      r.days.find((d) => d.date === "2026-12-01")!.areas[0]!.unfilled = 2;
      return r;
    });
    const { el, open } = await mount({
      api: client.api,
      params: { area: "department:dep-restaurant" },
    });
    (el as StaffingMonthView & { canOpenRota: boolean }).canOpenRota = true;
    await el.updateComplete;
    const link = root(el).querySelector<HTMLElement>("[data-rota-week='2026-11-30']");
    expect(link).not.toBeNull();
    link!.click();
    expect(open).toHaveBeenCalledWith("rota", {
      week: "2026-11-30",
      area: "department:dep-restaurant",
    });
    expect(cell(el, "2026-12-01").textContent).toContain("2 unfilled");
  });
});

describe("week links stay within their month cells", () => {
  it.each(["390px", "1280px"])("fits the link below its day at %s", async (width) => {
    const { el } = await mount({ width });
    el.canOpenRota = true;
    await el.updateComplete;
    for (const link of root(el).querySelectorAll<HTMLElement>("[data-rota-week]")) {
      const td = link.closest("td")!;
      const box = td.querySelector<HTMLElement>(".day")!.getBoundingClientRect();
      expect(box.bottom).toBeLessThanOrEqual(link.getBoundingClientRect().top + 0.5);
      expect(link.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        td.getBoundingClientRect().bottom + 0.5,
      );
    }
    expect(el.scrollWidth).toBeLessThanOrEqual(parseInt(width));
  });
});

describe("week link labels fit narrow month columns", () => {
  it.each(["en", "es"] as const)("keeps the %s label inside a phone column", async (locale) => {
    setLocale(locale);
    const { el } = await mount({ width: "310px" });
    el.canOpenRota = true;
    await settled(el);
    for (const link of root(el).querySelectorAll<HTMLElement>("[data-rota-week]")) {
      const button = link.shadowRoot?.querySelector<HTMLButtonElement>("button") ?? link;
      const td = link.closest("td")!.getBoundingClientRect();
      expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(td.right + 0.5);
      expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth);
    }
  });
});

it("A710 uses the theme focus ring outside the day, independently of today's inset frame", async () => {
  const { el } = await mount({ canWrite: true });
  el.style.setProperty("--wt-focus-ring", "4px dashed rgb(90, 80, 70)");
  const today = cell(el, "2026-12-02").querySelector<HTMLButtonElement>("button.day")!;
  today.focus();
  await userEvent.keyboard("{ArrowRight}{ArrowLeft}");
  const style = getComputedStyle(today);
  expect(today.matches(":focus-visible")).toBe(true);
  expect(style.outlineStyle).toBe("dashed");
  expect(style.outlineWidth).toBe("4px");
  expect(style.outlineColor).toBe("rgb(90, 80, 70)");
  expect(parseFloat(style.outlineOffset)).toBeGreaterThan(0);
  expect(style.boxShadow).toBe("none");
  expect(today.querySelector(".today")?.textContent).toBe("Today");
});

for (const theme of ["light", "dark"] as const)
  it(`keeps today's badge distinct from the default keyboard-focus frame in ${theme}`, async () => {
    const { el } = await mount({ canWrite: true });
    el.parentElement!.setAttribute("data-theme", theme);
    const today = cell(el, "2026-12-02").querySelector<HTMLButtonElement>("button.day")!;
    today.focus();
    await userEvent.keyboard("{ArrowRight}");
    const focused = cell(el, "2026-12-03").querySelector<HTMLButtonElement>("button.day")!;
    expect(focused.matches(":focus-visible")).toBe(true);
    expect(getComputedStyle(focused).outlineStyle).toBe("solid");
    expect(getComputedStyle(focused).outlineWidth).toBe("2px");
    expect(getComputedStyle(today).boxShadow).toBe("none");
    expect(today.getAttribute("aria-current")).toBe("date");
    expect(getComputedStyle(today.querySelector(".today")!).backgroundColor).not.toBe(
      "rgba(0, 0, 0, 0)",
    );
    expect(focused.hasAttribute("aria-current")).toBe(false);
  });
