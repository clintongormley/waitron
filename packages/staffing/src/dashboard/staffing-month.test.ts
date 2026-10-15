import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveData, setLocale } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import type { StaffingMonth } from "../staffing-types.js";
import type { StaffingApi } from "./client.js";
import type { StaffingMonthView } from "./staffing-month.js";
import "./staffing-month.js";
import { fakeApi, staffingMonth } from "../testing/staffing-month-fixture.js";

const frames: HTMLElement[] = [];
afterEach(() => {
  for (const frame of frames.splice(0)) frame.remove();
  setLocale("en");
});

interface Options {
  month?: string;
  params?: Record<string, string>;
  api?: StaffingApi;
  width?: string;
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

  it("shows the month's seasons as chips, in display only", async () => {
    const { el } = await mount();
    const chips = [...root(el).querySelectorAll<HTMLElement>("[data-test=season]")];
    expect(chips.map((chip) => chip.textContent!.replace(/\s+/g, " ").trim())).toEqual([
      "Autumn · 1 Sept – 30 Nov",
      "Winter · 1 Dec – 28 Feb",
    ]);
    expect(chips.map((chip) => chip.dataset.tint)).toEqual(["1", "2"]);
    expect(root(el).querySelector("[data-test=seasons] button")).toBeNull();
    expect(cell(el, "2026-11-30").dataset.tint).toBe("1");
    expect(cell(el, "2026-12-01").dataset.tint).toBe("2");
    expect(root(el).querySelector("td button")).toBeNull();
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

  it("reads the same whether or not the person may write", async () => {
    const { el } = await mount();
    const before = root(el).querySelector("table")!.outerHTML;
    el.canWrite = true;
    await settled(el);
    expect(root(el).querySelector("table")!.outerHTML).toBe(before);
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
    for (const part of root(el).querySelectorAll<HTMLElement>("table, .head, .sub, .day"))
      expect(part.getBoundingClientRect().right).toBeLessThanOrEqual(
        el.parentElement!.getBoundingClientRect().right + 0.5,
      );
  });

  it("wraps a long unbroken season name inside a phone's width, keeping the whole name", async () => {
    const name = "W".repeat(80);
    const { api } = fakeApi(async (month) => {
      const read = staffingMonth(month);
      read.seasons = [{ ...read.seasons[0]!, name }, ...read.seasons.slice(1)];
      return read;
    });
    const { el } = await mount({ api, width: "390px" });
    const chip = root(el).querySelector<HTMLElement>("[data-test=season]")!;
    expect(chip.textContent).toContain(name);
    expect(el.scrollWidth).toBeLessThanOrEqual(390);
    expect(chip.getBoundingClientRect().right).toBeLessThanOrEqual(
      el.parentElement!.getBoundingClientRect().right + 0.5,
    );
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
});
