import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { LiveConnection, LiveData, setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import { chooseOption, formMessageOf } from "@waitron/ui/src/test-helpers.js";
import type { WtFormActions } from "@waitron/ui";
import type { LocalHolidayModel } from "../holiday-types.js";
import type {
  CalendarDay,
  HourPeriod,
  HoursModel,
  HoursModelSubject,
  WeekCell,
  WeekDay,
} from "../hours-types.js";
import { clockChangeAfter, minutesAfter } from "../testing/clock-change.js";
import { HoursApi } from "./hours-client.js";
import { formatDate, type HoursScreen } from "./hours-screen.js";

const hosts: HTMLElement[] = [];
const originalUrl = location.href;
beforeEach(() => {
  setLocale("en");
  history.replaceState(null, "", "/manage/hours");
});
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
  setLocale("en");
  history.replaceState(null, "", originalUrl);
});

const P = (id: string, opensAt: string, closesAt: string): HourPeriod => ({
  id,
  opensAt,
  closesAt,
});
const CLOSED: WeekCell = { mode: "closed", periods: [] };
const UNSET: WeekCell = { mode: "not_set", periods: [] };
const ALL_DAY: WeekCell = { mode: "all_day", periods: [] };
const week = (cell: (weekday: number) => WeekCell): WeekDay[] =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, cell: cell(weekday) }));

const restaurantWeek = week((d) =>
  d < 2
    ? CLOSED
    : { mode: "periods", periods: [P(`r${d}a`, "12:00", "16:00"), P(`r${d}b`, "20:00", "23:30")] },
);
const barWeek = week((d) =>
  d === 0
    ? CLOSED
    : d < 5
      ? { mode: "periods", periods: [P(`b${d}`, "17:00", "23:00")] }
      : { mode: "periods", periods: [P(`b${d}`, "18:00", "02:00")] },
);

const subject = (
  kind: "department" | "station",
  id: string,
  name: string,
  extra: Partial<HoursModelSubject> = {},
): HoursModelSubject => ({ kind, id, name, active: true, isDefault: false, ...extra });

const FIESTA = {
  id: "fiesta",
  date: "2026-10-12",
  name: "Fiesta Nacional",
  colour: "red" as const,
  closeWholeVenue: false,
};
const STAFF = {
  id: "staff",
  date: "2026-10-13",
  name: "Staff day off",
  colour: "grey" as const,
  closeWholeVenue: true,
};

function model(): HoursModel {
  const day = (date: string, specialDate: CalendarDay["specialDate"]): CalendarDay => ({
    date,
    specialDate,
    holidays: [],
    tone: specialDate?.colour ?? "standard",
  });
  return {
    timeZone: "Europe/Madrid",
    dayCutover: "06:00",
    civilDate: "2026-10-07",
    clockReadable: true,
    subjects: [
      subject("department", "restaurant", "Restaurant", { isDefault: true }),
      subject("department", "deli", "Deli"),
      subject("department", "terrace", "Terrace", { active: false }),
      subject("station", "kitchen", "Kitchen", { isDefault: true }),
      subject("station", "bar", "Bar"),
    ],
    week: [
      { subject: { kind: "department", id: "restaurant" }, days: restaurantWeek },
      { subject: { kind: "department", id: "deli" }, days: week(() => UNSET) },
      { subject: { kind: "department", id: "terrace" }, days: week(() => ALL_DAY) },
      { subject: { kind: "station", id: "kitchen" }, days: week(() => UNSET) },
      { subject: { kind: "station", id: "bar" }, days: barWeek },
    ],
    days: [day("2026-10-07", null), day("2026-10-12", FIESTA), day("2026-10-13", STAFF)],
    specialDates: [FIESTA, STAFF],
    holidayCoverage: [],
    holidaySources: [],
    specialCells: [
      {
        specialDateId: "fiesta",
        cells: [
          {
            subject: { kind: "department", id: "restaurant" },
            cell: { mode: "periods", periods: [P("f1", "12:00", "23:00")] },
          },
          { subject: { kind: "department", id: "deli" }, cell: { mode: "closed", periods: [] } },
          {
            subject: { kind: "department", id: "terrace" },
            cell: { mode: "closed", periods: [] },
          },
        ],
      },
    ],
  };
}

/** A value to answer with, a promise of one, or `{ reject }` to refuse with. */
type Answer = unknown;

function localModel(): LocalHolidayModel {
  const geography = {
    id: "g-sevilla",
    country: "ES",
    provinceCode: "41",
    city: "Sevilla",
    areaKey: null,
    matchesVenue: true,
  };
  return {
    venue: { country: "ES", provinceCode: "41", city: "Sevilla" },
    localEntryLimit: 2,
    areaOptions: [],
    areaRequired: false,
    geographies: [geography],
    entries: [{ id: "e1", geographyId: geography.id, date: "2026-10-15", name: "Feria" }],
  };
}

/**
 * A request stub: Hours reads answer the current model (or a queued failure), local holiday reads
 * the current local model (or their own queue); writes answer their queue.
 */
function server(liveData?: LiveData) {
  const state = {
    model: model(),
    local: localModel(),
    reads: [] as Answer[],
    localReads: [] as Answer[],
    writes: [] as Answer[],
  };
  const request = vi.fn<
    (
      path: string,
      method: string,
      body?: unknown,
      options?: { passive?: boolean },
    ) => Promise<unknown>
  >(async (path, method) => {
    const local = method === "GET" && path.endsWith("/local-holidays");
    const queue = local ? state.localReads : method === "GET" ? state.reads : state.writes;
    const answer = local ? state.local : method === "GET" ? state.model : undefined;
    const next = queue.length > 0 ? queue.shift() : answer;
    const value = await next;
    if (typeof value === "object" && value !== null && "reject" in value)
      throw (value as { reject: unknown }).reject;
    return structuredClone(value);
  });
  const api = new HoursApi(request as unknown as DashboardRequest, liveData);
  const calls = (method: string) =>
    request.mock.calls.filter((call) => call[1] === method).map((call) => [call[0], call[2]]);
  return { state, request, api, calls };
}

async function settle(el: HTMLElement & { updateComplete: Promise<unknown> }) {
  for (let turn = 0; turn < 3; turn++) {
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  await el.updateComplete;
}

async function mount(api: HoursApi, readOnly = false): Promise<HoursScreen> {
  const host = document.createElement("div");
  applyTokens(host);
  document.body.append(host);
  hosts.push(host);
  const el = document.createElement("dashboard-hours-screen");
  el.api = api;
  el.readOnly = readOnly;
  host.append(el);
  await settle(el);
  return el;
}

/** Searches the screen's shadow root and every shadow root under it. */
function findAll<T extends Element = HTMLElement>(el: Element, selector: string): T[] {
  const found: T[] = [];
  const search = (root: ParentNode) => {
    found.push(...root.querySelectorAll<T>(selector));
    for (const child of root.querySelectorAll("*")) if (child.shadowRoot) search(child.shadowRoot);
  };
  search(el.shadowRoot!);
  return found;
}
const find = <T extends Element = HTMLElement>(el: Element, selector: string): T | null =>
  findAll<T>(el, selector)[0] ?? null;

type Field = HTMLElement & {
  value: string;
  error: string;
  disabled: boolean;
  label: string;
  updateComplete: Promise<unknown>;
};
const field = (el: Element, name: string) => find<Field>(el, `[name="${name}"]`);

async function setField(el: HoursScreen, name: string, value: string) {
  const target = field(el, name)!;
  expect(target, name).not.toBeNull();
  target.value = value;
  target.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await settle(el);
}
async function choose(el: HoursScreen, name: string, value: string) {
  const target = field(el, name)!;
  expect(target, name).not.toBeNull();
  await chooseOption(target, value);
  await settle(el);
}

const text = (node: Element | null) => (node?.textContent ?? "").replace(/\s+/g, " ").trim();

function cell(el: HoursScreen, key: string, weekday: number): HTMLElement {
  return el.shadowRoot!.querySelector<HTMLElement>(
    `td[data-subject="${key}"][data-weekday="${weekday}"]`,
  )!;
}
const cellButton = (el: HoursScreen, key: string, weekday: number) =>
  cell(el, key, weekday).querySelector<HTMLButtonElement>("button");

async function click(el: HoursScreen, target: HTMLElement | null) {
  expect(target).not.toBeNull();
  target!.click();
  await settle(el);
}

/** Opens a `wt-row-actions` menu and clicks its action. */
async function menuAction(el: HoursScreen, scope: Element, test: string) {
  const action = [...scope.querySelectorAll<HTMLElement>(`[data-test="${test}"]`)][0] ?? null;
  expect(action, test).not.toBeNull();
  action!
    .closest("wt-row-actions")!
    .shadowRoot!.querySelector<HTMLButtonElement>("button")!
    .click();
  action!.click();
  await settle(el);
}

const modal = (el: HoursScreen) => el.shadowRoot!.querySelector<HTMLElement>("wt-modal");
const saveButton = (el: HoursScreen) =>
  el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>('[data-test="save-editor"]')!;
const actions = (el: HoursScreen) =>
  el.shadowRoot!.querySelector<WtFormActions>("wt-modal wt-form-actions")!;
async function bottomMessage(el: HoursScreen): Promise<string> {
  return text(await formMessageOf(actions(el)));
}
async function selectTab(el: HoursScreen, key: string) {
  const tabs = el.shadowRoot!.querySelector("wt-tabs")!;
  tabs.shadowRoot!.querySelector<HTMLButtonElement>(`[data-key="${key}"]`)!.click();
  await settle(el);
}

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const restaurant = "department:restaurant";
const deli = "department:deli";
const kitchen = "station:kitchen";
const bar = "station:bar";

describe("Hours: the standard week", () => {
  it("shows Monday to Sunday down the side and departments, then a separated block of stations", async () => {
    const { api } = server();
    const el = await mount(api);
    expect(text(el.shadowRoot!.querySelector("h1"))).toBe("Hours");
    expect(el.shadowRoot!.querySelectorAll("h1")).toHaveLength(1);
    const grid = el.shadowRoot!.querySelector('table[data-test="week-grid"]')!;
    expect([...grid.querySelectorAll("tbody th")].map(text)).toEqual([
      "Monday",
      "Tuesday",
      "Wednesday Today",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ]);
    expect(grid.querySelector('tr[data-weekday="3"]')!.getAttribute("aria-current")).toBe("date");
    const headers = [...grid.querySelectorAll<HTMLElement>("thead th[data-subject]")];
    expect(headers.map((th) => th.dataset.subject)).toEqual([restaurant, deli, kitchen, bar]);
    expect(headers.map((th) => text(th.querySelector(".subject-name")))).toEqual([
      "Restaurant",
      "Deli",
      "Kitchen",
      "Bar",
    ]);
    expect(headers.map((th) => th.hasAttribute("data-separator"))).toEqual([
      false,
      false,
      true,
      false,
    ]);
    expect(cell(el, kitchen, 1).hasAttribute("data-separator")).toBe(true);
    expect(text(cell(el, restaurant, 1))).toBe("Closed");
    expect(text(cell(el, restaurant, 2))).toBe("12:00–16:00, 20:00–23:30");
    expect(text(cell(el, bar, 5))).toBe("18:00–02:00");
    expect(text(cell(el, deli, 4))).toBe("No hours set");
    expect(text(el.shadowRoot!.querySelector('[data-test="clock-note"]'))).toBe(
      "Times are the venue's local time (Europe/Madrid).",
    );
  });

  it("wraps a squeezed cell between its periods, never inside one", async () => {
    const { api } = server();
    const el = await mount(api);
    const button = cellButton(el, restaurant, 2)!;
    button.style.width = "1px";
    const ranges = [...button.querySelectorAll(".range")];
    expect(ranges.map(text)).toEqual(["12:00–16:00,", "20:00–23:30"]);
    // The text's own line boxes: a flex item's getClientRects is one box however its text wraps.
    const textRects = (node: Element) => {
      const contents = document.createRange();
      contents.selectNodeContents(node);
      return [...contents.getClientRects()];
    };
    const lines = (rects: DOMRect[]) => new Set(rects.map((rect) => Math.round(rect.top))).size;
    for (const range of ranges) expect(lines(textRects(range))).toBe(1);
    expect(lines(textRects(button))).toBe(2);
  });

  it("shows the default station Always open on every day, with nothing to open", async () => {
    const { api } = server();
    const el = await mount(api);
    for (const weekday of [0, 1, 2, 3, 4, 5, 6]) {
      expect(text(cell(el, kitchen, weekday))).toBe("Always open");
      expect(cellButton(el, kitchen, weekday)).toBeNull();
    }
    const header = el.shadowRoot!.querySelector(`th[data-subject="${kitchen}"]`)!;
    expect(header.querySelector("wt-row-actions")).toBeNull();
  });

  it("says a station with no weekly hours has no restriction", async () => {
    const { api, state } = server();
    state.model.week[4]!.days = week(() => UNSET);
    const el = await mount(api);
    expect(text(cell(el, bar, 1))).toBe("No hours restriction");
    expect(text(cell(el, deli, 1))).toBe("No hours set");
  });

  it("names a sole department by its own name", async () => {
    const { api, state } = server();
    state.model.subjects = state.model.subjects.filter(
      (s) => s.id !== "deli" && s.id !== "terrace",
    );
    state.model.week = state.model.week.filter(
      (w) => w.subject.id !== "deli" && w.subject.id !== "terrace",
    );
    const el = await mount(api);
    const headers = [...el.shadowRoot!.querySelectorAll<HTMLElement>("thead th[data-subject]")];
    expect(headers.map((th) => text(th.querySelector(".subject-name")))).toEqual([
      "Restaurant",
      "Kitchen",
      "Bar",
    ]);
  });

  it("keeps inactive departments and stations out of view until asked, then shows them read-only", async () => {
    const { api } = server();
    const el = await mount(api);
    expect(el.shadowRoot!.querySelector('th[data-subject="department:terrace"]')).toBeNull();
    const toggle = el.shadowRoot!.querySelector<HTMLElement>('wt-switch[name="showInactive"]')!;
    toggle.dispatchEvent(
      new CustomEvent("wt-change", { detail: { checked: true }, bubbles: true, composed: true }),
    );
    await settle(el);
    const header = el.shadowRoot!.querySelector('th[data-subject="department:terrace"]')!;
    expect(text(header)).toBe("Terrace (inactive)");
    expect(header.querySelector("wt-row-actions")).toBeNull();
    expect(text(cell(el, "department:terrace", 1))).toBe("Open all day");
    expect(cellButton(el, "department:terrace", 1)).toBeNull();
    const order = [...el.shadowRoot!.querySelectorAll<HTMLElement>("thead th[data-subject]")].map(
      (th) => th.dataset.subject,
    );
    expect(order).toEqual([restaurant, deli, "department:terrace", kitchen, bar]);
  });

  it("edits one day in its own editor and saves the whole week, every other day as it was", async () => {
    const { api, calls, request } = server();
    const el = await mount(api);
    const opener = cellButton(el, restaurant, 2)!;
    expect(opener.getAttribute("aria-label")).toBe("Restaurant, Tuesday: 12:00–16:00, 20:00–23:30");
    await click(el, opener);
    expect(modal(el)!.getAttribute("heading")).toBe("Restaurant: Tuesday");
    const mode = field(el, "tuesday.mode") as Field & { options: { value: string }[] };
    expect(mode.options.map((option) => option.value)).toEqual(["closed", "all_day", "periods"]);
    await setField(el, "tuesday.periods.1.closesAt", "23:00");
    const readsBefore = calls("GET").length;
    await click(el, saveButton(el));
    expect(calls("PUT")).toEqual([
      [
        "/management-api/venue-service/hours/week",
        {
          subject: { kind: "department", id: "restaurant" },
          days: restaurantWeek.map((day) =>
            day.weekday === 2
              ? {
                  weekday: 2,
                  cell: {
                    mode: "periods",
                    periods: [P("r2a", "12:00", "16:00"), P("r2b", "20:00", "23:00")],
                  },
                }
              : day,
          ),
        },
      ],
    ]);
    expect(modal(el)).toBeNull();
    const order = request.mock.calls.map((call) => call[1]);
    expect(order.lastIndexOf("GET")).toBeGreaterThan(order.indexOf("PUT"));
    expect(calls("GET").length).toBe(readsBefore + 1);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.activeElement).toBe(cellButton(el, restaurant, 2)),
    );
  });

  it("swapping two periods' times keeps each id with its row and writes no other cell", async () => {
    const { api, calls } = server();
    const el = await mount(api);
    await click(el, cellButton(el, restaurant, 4));
    await setField(el, "thursday.periods.0.opensAt", "20:00");
    await setField(el, "thursday.periods.0.closesAt", "23:30");
    await setField(el, "thursday.periods.1.opensAt", "12:00");
    await setField(el, "thursday.periods.1.closesAt", "16:00");
    await click(el, saveButton(el));
    const body = calls("PUT")[0]![1] as { days: WeekDay[] };
    expect(body.days[4]!.cell).toEqual({
      mode: "periods",
      periods: [P("r4a", "20:00", "23:30"), P("r4b", "12:00", "16:00")],
    });
    for (const weekday of [0, 1, 2, 3, 5, 6])
      expect(body.days[weekday]).toEqual(restaurantWeek[weekday]);
  });

  it("adds and removes periods in the day's editor and saves on Enter", async () => {
    const { api, calls } = server();
    const el = await mount(api);
    await click(el, cellButton(el, restaurant, 1));
    await choose(el, "monday.mode", "periods");
    await setField(el, "monday.periods.0.opensAt", "09:00");
    await setField(el, "monday.periods.0.closesAt", "11:00");
    await click(el, find(el, '[data-test="add-period"]'));
    await setField(el, "monday.periods.1.opensAt", "13:00");
    await setField(el, "monday.periods.1.closesAt", "15:00");
    await click(el, find(el, '[data-test="add-period"]'));
    await click(el, findAll(el, '[data-test="remove-period"]')[2]!);
    const input = find(field(el, "monday.periods.1.closesAt")!, "input")!;
    input.focus();
    await userEvent.keyboard("{Enter}");
    await settle(el);
    const body = calls("PUT")[0]![1] as { days: WeekDay[] };
    const periods = body.days[1]!.cell.periods;
    expect(periods.map(({ opensAt, closesAt }) => [opensAt, closesAt])).toEqual([
      ["09:00", "11:00"],
      ["13:00", "15:00"],
    ]);
    expect(periods.every((p) => /^[0-9a-f-]{36}$/.test(p.id))).toBe(true);
    expect(modal(el)).toBeNull();
  });

  it("Cancel and Escape close the editor without saving, and focus returns to the day", async () => {
    const { api, calls } = server();
    const el = await mount(api);
    await click(el, cellButton(el, bar, 3));
    await setField(el, "wednesday.periods.0.opensAt", "16:00");
    await click(el, el.shadowRoot!.querySelector('[data-test="cancel-editor"]'));
    await expect.poll(() => modal(el)).toBeNull();
    await vi.waitFor(() => expect(el.shadowRoot!.activeElement).toBe(cellButton(el, bar, 3)));
    await click(el, cellButton(el, bar, 3));
    expect(field(el, "wednesday.periods.0.opensAt")!.value).toBe("17:00");
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(modal(el)).toBeNull());
    await vi.waitFor(() => expect(el.shadowRoot!.activeElement).toBe(cellButton(el, bar, 3)));
    expect(calls("PUT")).toEqual([]);
  });

  it("is one stop for Tab, and the arrow keys move between days and columns", async () => {
    const { api } = server();
    const el = await mount(api);
    const tabbable = [...el.shadowRoot!.querySelectorAll<HTMLElement>("td button")].filter(
      (button) => button.tabIndex === 0,
    );
    expect(tabbable).toEqual([cellButton(el, restaurant, 1)]);
    expect(el.shadowRoot!.querySelector(".grid-box")!.hasAttribute("tabindex")).toBe(false);
    cellButton(el, restaurant, 1)!.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(el.shadowRoot!.activeElement).toBe(cellButton(el, restaurant, 2));
    await userEvent.keyboard("{ArrowRight}");
    expect(el.shadowRoot!.activeElement).toBe(cellButton(el, deli, 2));
    // The default station has nothing to open, so the next stop is the bar.
    await userEvent.keyboard("{ArrowRight}");
    expect(el.shadowRoot!.activeElement).toBe(cellButton(el, bar, 2));
    await userEvent.keyboard("{ArrowUp}");
    expect(el.shadowRoot!.activeElement).toBe(cellButton(el, bar, 1));
    await userEvent.keyboard("{ArrowUp}");
    expect(el.shadowRoot!.activeElement).toBe(cellButton(el, bar, 1));
    await userEvent.keyboard("{ArrowLeft}");
    expect(el.shadowRoot!.activeElement).toBe(cellButton(el, deli, 1));
    await settle(el);
    expect(cellButton(el, deli, 1)!.tabIndex).toBe(0);
    expect(cellButton(el, restaurant, 1)!.tabIndex).toBe(-1);
    await userEvent.keyboard("{Enter}");
    await settle(el);
    expect(modal(el)!.getAttribute("heading")).toBe("Configure hours: Deli");
  });

  it("marks every bad field and the bottom of the form, and holds Save until they are fixed", async () => {
    const { api, calls } = server();
    const el = await mount(api);
    await click(el, cellButton(el, restaurant, 3));
    await setField(el, "wednesday.periods.0.opensAt", "");
    await setField(el, "wednesday.periods.1.opensAt", "13:00");
    await setField(el, "wednesday.periods.1.closesAt", "13:00");
    expect(saveButton(el).disabled).toBe(false);
    expect(field(el, "wednesday.periods.0.opensAt")!.error).toBe("");
    await click(el, saveButton(el));
    expect(field(el, "wednesday.periods.0.opensAt")!.error).toBe("Enter a time.");
    expect(field(el, "wednesday.periods.1.closesAt")!.error).toBe(
      "Choose a closing time different from the opening time.",
    );
    expect(await bottomMessage(el)).toBe("Correct the highlighted fields to continue.");
    expect(saveButton(el).disabled).toBe(true);
    await setField(el, "wednesday.periods.0.opensAt", "12:00");
    expect(field(el, "wednesday.periods.0.opensAt")!.error).toBe("");
    expect(saveButton(el).disabled).toBe(true);
    await setField(el, "wednesday.periods.1.closesAt", "15:00");
    expect(field(el, "wednesday.periods.1.opensAt")!.error).toBe(
      "This period overlaps another one on the same day.",
    );
    await setField(el, "wednesday.periods.1.opensAt", "18:00");
    await setField(el, "wednesday.periods.1.closesAt", "22:00");
    expect(saveButton(el).disabled).toBe(false);
    expect(await bottomMessage(el)).toBe("");
    expect(calls("PUT")).toEqual([]);
  });

  it("refuses a day that runs into the next one's hours, naming that day", async () => {
    const { api } = server();
    const el = await mount(api);
    await click(el, cellButton(el, restaurant, 2));
    await setField(el, "tuesday.periods.1.closesAt", "13:00");
    await click(el, saveButton(el));
    expect(field(el, "tuesday.mode")!.error).toBe(
      "These hours run past midnight into Wednesday's hours.",
    );
  });

  it("puts a server refusal of the edited day under it, and Save stays ready to retry", async () => {
    const { api, state, calls } = server();
    const el = await mount(api);
    await click(el, cellButton(el, restaurant, 1));
    await choose(el, "monday.mode", "all_day");
    state.writes.push({
      reject: {
        code: "hours.invalid",
        params: { field: "days.1.cell", date: "2026-10-13", subjectId: "restaurant" },
      },
    });
    await click(el, saveButton(el));
    expect(field(el, "monday.mode")!.error).toBe(
      "These hours overlap the hours on Tue, 13 Oct 2026.",
    );
    expect(await bottomMessage(el)).toBe("Correct the highlighted fields to continue.");
    expect(saveButton(el).disabled).toBe(false);
    await click(el, saveButton(el));
    expect(calls("PUT")).toHaveLength(2);
    expect(modal(el)).toBeNull();
  });

  it.each([
    [
      {
        code: "hours.invalid",
        params: { field: "days.0.cell", date: "2026-10-11", subjectId: "restaurant" },
      },
      "These hours overlap the hours on Sun, 11 Oct 2026.",
    ],
    [
      { code: "station.always_open", params: { stationId: "bar" } },
      "The default station is always open, so its hours cannot change.",
    ],
    [{ code: "connection.failed" }, "The change could not be saved."],
    [
      { code: "hours.invalid", params: { field: "days.1.cell.periods.0.id" } },
      "One of these periods could not be saved as sent. Close this editor and open it again to start from the saved hours.",
    ],
    [
      { code: "hours.invalid", params: { field: "days.0.cell.mode" } },
      "Some days of this week now have no hours, and a week has hours on every day or on none. Close this editor and open it again.",
    ],
    [
      { code: "hours.invalid", params: { field: "subject" } },
      "A department or prep station these hours are for no longer exists. Close this editor and open it again.",
    ],
  ])(
    "says a refusal that names no field in the editor at its bottom: %j",
    async (refusal, message) => {
      const { api, state } = server();
      const el = await mount(api);
      await click(el, cellButton(el, restaurant, 1));
      state.writes.push({ reject: refusal });
      await click(el, saveButton(el));
      expect(await bottomMessage(el)).toBe(message);
      expect(field(el, "monday.mode")!.error).toBe("");
      expect(saveButton(el).disabled).toBe(false);
    },
  );

  it("puts a refusal of one period's time under that time", async () => {
    const { api, state } = server();
    const el = await mount(api);
    await click(el, cellButton(el, restaurant, 2));
    state.writes.push({
      reject: { code: "hours.invalid", params: { field: "days.2.cell.periods.1.closesAt" } },
    });
    await click(el, saveButton(el));
    expect(field(el, "tuesday.periods.1.closesAt")!.error).toBe("Check this value.");
    expect(field(el, "tuesday.mode")!.error).toBe("");
  });

  it("closes the editor once the write succeeds, and says a failed reload as a read failure", async () => {
    const { api, state } = server();
    const el = await mount(api);
    await click(el, cellButton(el, bar, 2));
    state.reads.push({ reject: { code: "connection.failed" } });
    await click(el, saveButton(el));
    expect(modal(el)).toBeNull();
    expect(text(el.shadowRoot!.querySelector('[data-test="page-alert"]'))).toBe(
      "Hours could not be loaded.",
    );
  });

  it("asks the seven-day draft's confirmation in a compact dialog, and goes back to the full editor", async () => {
    const { api } = server();
    const el = await mount(api);
    await click(el, cellButton(el, deli, 5));
    expect(modal(el)!.getAttribute("size")).toBe("standard");
    await click(el, saveButton(el));
    expect(modal(el)!.getAttribute("size")).toBe("compact");
    await click(el, el.shadowRoot!.querySelector('[data-test="cancel-editor"]'));
    expect(modal(el)!.getAttribute("size")).toBe("standard");
  });

  it("configures a subject with no hours through a seven-day draft that starts Closed and saves after confirming", async () => {
    const { api, calls } = server();
    const el = await mount(api);
    await click(el, cellButton(el, deli, 5));
    expect(modal(el)!.getAttribute("heading")).toBe("Configure hours: Deli");
    expect(text(el.shadowRoot!.querySelector('[data-test="configure-note"]'))).toBe(
      "Every day starts Closed. Days you leave Closed will be closed.",
    );
    const editors = [
      ...el.shadowRoot!.querySelectorAll<HTMLElement & { label: string; cell: { mode: string } }>(
        "wt-modal hours-cell-editor",
      ),
    ];
    expect(editors.map((editor) => editor.label)).toEqual([
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ]);
    expect(editors.every((editor) => editor.cell.mode === "closed")).toBe(true);
    const mode = field(el, "friday.mode") as Field & { options: { value: string }[] };
    expect(mode.options.map((option) => option.value)).toEqual(["closed", "all_day", "periods"]);
    await choose(el, "friday.mode", "periods");
    await setField(el, "friday.periods.0.opensAt", "09:00");
    await setField(el, "friday.periods.0.closesAt", "14:00");
    await choose(el, "saturday.mode", "all_day");
    await click(el, saveButton(el));
    expect(calls("PUT")).toEqual([]);
    expect(text(el.shadowRoot!.querySelector('[data-test="confirm-text"]'))).toBe(
      "Save these hours for Deli? Days left Closed will be closed.",
    );
    expect(text(saveButton(el))).toBe("Save hours");
    await click(el, el.shadowRoot!.querySelector('[data-test="cancel-editor"]'));
    expect(text(el.shadowRoot!.querySelector('[data-test="confirm-text"]'))).toBe("");
    expect(field(el, "friday.periods.0.opensAt")!.value).toBe("09:00");
    await click(el, saveButton(el));
    await click(el, saveButton(el));
    const [[path, body]] = calls("PUT") as [[string, { subject: unknown; days: WeekDay[] }]];
    expect(path).toBe("/management-api/venue-service/hours/week");
    expect(body.subject).toEqual({ kind: "department", id: "deli" });
    expect(body.days.map((day) => [day.weekday, day.cell.mode])).toEqual([
      [0, "closed"],
      [1, "closed"],
      [2, "closed"],
      [3, "closed"],
      [4, "closed"],
      [5, "periods"],
      [6, "all_day"],
    ]);
    expect(body.days[5]!.cell.periods).toEqual([
      { id: expect.stringMatching(/^[0-9a-f-]{36}$/), opensAt: "09:00", closesAt: "14:00" },
    ]);
    expect(modal(el)).toBeNull();
  });

  it("marks the later day when one configured day runs past midnight into the next", async () => {
    const { api } = server();
    const el = await mount(api);
    await menuAction(el, el.shadowRoot!.querySelector(`th[data-subject="${deli}"]`)!, "configure");
    await choose(el, "monday.mode", "periods");
    await setField(el, "monday.periods.0.opensAt", "20:00");
    await setField(el, "monday.periods.0.closesAt", "03:00");
    await choose(el, "tuesday.mode", "all_day");
    await click(el, saveButton(el));
    expect(field(el, "tuesday.mode")!.error).toBe(
      "These hours overlap Monday's hours past midnight.",
    );
    expect(field(el, "monday.mode")!.error).toBe("");
    expect(text(el.shadowRoot!.querySelector('[data-test="confirm-text"]'))).toBe("");
  });

  it("clears a configured week only after confirming, back to no hours", async () => {
    const { api, calls } = server();
    const el = await mount(api);
    const header = el.shadowRoot!.querySelector(`th[data-subject="${restaurant}"]`)!;
    expect(header.querySelector('[data-test="configure"]')).toBeNull();
    await menuAction(el, header, "clear");
    expect(modal(el)!.getAttribute("heading")).toBe("Clear schedule: Restaurant");
    expect(text(el.shadowRoot!.querySelector('[data-test="confirm-text"]'))).toBe(
      "Restaurant will show no opening hours.",
    );
    expect(calls("PUT")).toEqual([]);
    await click(el, saveButton(el));
    expect(calls("PUT")).toEqual([
      [
        "/management-api/venue-service/hours/week",
        { subject: { kind: "department", id: "restaurant" }, days: week(() => UNSET) },
      ],
    ]);
    await menuAction(el, el.shadowRoot!.querySelector(`th[data-subject="${bar}"]`)!, "clear");
    expect(text(el.shadowRoot!.querySelector('[data-test="confirm-text"]'))).toBe(
      "Bar will have no hours restriction and take work at any time.",
    );
  });

  it("keeps a failed save's message through reads, and a failed read never replaces it", async () => {
    const liveData = new LiveData();
    const { api, state } = server(liveData);
    const el = await mount(api);
    await click(el, cellButton(el, restaurant, 2));
    state.writes.push({ reject: { code: "server.internal" } });
    await click(el, saveButton(el));
    expect(await bottomMessage(el)).toBe("The change could not be saved.");

    state.reads.push({ reject: { code: "connection.failed" } });
    liveData.invalidate([{ type: "hours_week_cells" }]);
    await vi.waitFor(() =>
      expect(text(el.shadowRoot!.querySelector('[data-test="page-alert"]'))).toBe(
        "Hours could not be loaded.",
      ),
    );
    expect(await bottomMessage(el)).toBe("The change could not be saved.");

    liveData.invalidate([{ type: "hours_week_cells" }]);
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector('[data-test="page-alert"]')).toBeNull(),
    );
    expect(await bottomMessage(el)).toBe("The change could not be saved.");
    expect(saveButton(el).disabled).toBe(false);
  });

  it("without live updates, keeps a save's hours when a timer read started before it answers after the save's read", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const { api, state } = server();
      const el = await mount(api);
      expect(text(cell(el, restaurant, 2))).not.toContain("Open all day");
      const slow = deferred();
      state.reads.push(slow.promise);
      vi.advanceTimersByTime(60_000);
      const saved = model();
      saved.week[0]!.days = week((d) => (d === 2 ? ALL_DAY : restaurantWeek[d]!.cell));
      state.model = saved;
      await click(el, cellButton(el, restaurant, 2));
      await click(el, saveButton(el));
      await vi.waitFor(() => expect(text(cell(el, restaurant, 2))).toContain("Open all day"));
      slow.resolve(model());
      await settle(el);
      expect(text(cell(el, restaurant, 2))).toContain("Open all day");
    } finally {
      vi.useRealTimers();
    }
  });

  const cancelButton = (el: HoursScreen) =>
    el.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
      '[data-test="cancel-editor"]',
    )!;

  it("holds the editor open while a save is pending, and says a late failure in it", async () => {
    const { api, state } = server();
    const el = await mount(api);
    const late = deferred();
    state.writes.push(late.promise);
    await click(el, cellButton(el, restaurant, 2));
    await click(el, saveButton(el));
    expect(saveButton(el).disabled).toBe(true);
    expect(cancelButton(el).disabled).toBe(true);
    await click(el, cancelButton(el));
    await userEvent.keyboard("{Escape}");
    await settle(el);
    expect(modal(el)).not.toBeNull();
    late.resolve({ reject: { code: "connection.failed" } });
    await settle(el);
    expect(modal(el)).not.toBeNull();
    expect(await bottomMessage(el)).toBe("The change could not be saved.");
    expect(saveButton(el).disabled).toBe(false);
    expect(cancelButton(el).disabled).toBe(false);
  });

  it("closes the editor and reads once when a save that Cancel could not stop succeeds", async () => {
    const { api, state, calls } = server();
    const el = await mount(api);
    const late = deferred();
    state.writes.push(late.promise);
    await click(el, cellButton(el, restaurant, 2));
    await click(el, saveButton(el));
    await click(el, cancelButton(el));
    expect(modal(el)).not.toBeNull();
    const reads = calls("GET").length;
    late.resolve(undefined);
    await settle(el);
    expect(modal(el)).toBeNull();
    expect(calls("GET").length).toBe(reads + 1);
  });

  it("follows another client's changes while open without touching an unsaved draft, and stops reading once gone", async () => {
    const liveData = new LiveData();
    const { api, state, calls } = server(liveData);
    const el = await mount(api);
    await click(el, cellButton(el, restaurant, 2));
    await setField(el, "tuesday.periods.0.closesAt", "15:00");

    const changed = model();
    changed.week[0]!.days = restaurantWeek.map((day) =>
      day.weekday === 3 ? { weekday: 3, cell: CLOSED } : day,
    );
    changed.subjects = changed.subjects.map((s) =>
      s.kind === "station" ? { ...s, isDefault: s.id === "bar" } : s,
    );
    changed.timeZone = "America/New_York";
    state.model = changed;
    liveData.invalidate([{ type: "kitchen_stations" }]);
    await vi.waitFor(() => expect(text(cell(el, restaurant, 3))).toBe("Closed"));
    expect(text(cell(el, bar, 1))).toBe("Always open");
    expect(text(cell(el, kitchen, 1))).toBe("No hours restriction");
    expect(text(el.shadowRoot!.querySelector('[data-test="clock-note"]'))).toBe(
      "Times are the venue's local time (America/New_York).",
    );
    expect(modal(el)).not.toBeNull();
    expect(field(el, "tuesday.periods.0.closesAt")!.value).toBe("15:00");

    const reads = calls("GET").length;
    el.remove();
    liveData.invalidate([{ type: "special_dates" }]);
    liveData.refresh();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls("GET").length).toBe(reads);
  });

  it("says when the venue's clock cannot be read", async () => {
    const { api, state } = server();
    state.model.clockReadable = false;
    state.model.civilDate = null;
    const el = await mount(api);
    expect(text(el.shadowRoot!.querySelector('[data-test="clock-note"]'))).toBe(
      "The venue's time zone or day cutover cannot be read, so opening hours are not applied.",
    );
    expect(el.shadowRoot!.querySelector("tr[aria-current]")).toBeNull();
  });

  it("offers nothing to change to a read-only viewer", async () => {
    const { api } = server();
    const el = await mount(api, true);
    expect(el.shadowRoot!.querySelectorAll('table[data-test="week-grid"] button')).toHaveLength(0);
    const box = el.shadowRoot!.querySelector<HTMLElement>(".grid-box")!;
    expect([box.tabIndex, box.getAttribute("role"), box.getAttribute("aria-label")]).toEqual([
      0,
      "region",
      "Standard week",
    ]);
    expect(el.shadowRoot!.querySelector("wt-row-actions")).toBeNull();
    expect(text(cell(el, restaurant, 2))).toBe("12:00–16:00, 20:00–23:30");
    await selectTab(el, "dates");
    expect(el.shadowRoot!.querySelector('[data-test="add-date"]')).toBeNull();
    expect(el.shadowRoot!.querySelector('[data-test="close-venue"]')).toBeNull();
    const table = el.shadowRoot!.querySelector<HTMLElement & { columns: { key: string }[] }>(
      'wt-data-table[data-test="special-dates"]',
    )!;
    expect(table.columns.map((column) => column.key)).not.toContain("actions");
  });

  it("speaks Spanish", async () => {
    setLocale("es");
    const { api } = server();
    const el = await mount(api);
    expect(text(el.shadowRoot!.querySelector("h1"))).toBe("Horarios");
    const grid = el.shadowRoot!.querySelector('table[data-test="week-grid"]')!;
    expect(text(grid.querySelector("tbody th"))).toBe("Lunes");
    expect(text(cell(el, restaurant, 1))).toBe("Cerrado");
    expect(text(cell(el, kitchen, 1))).toBe("Siempre abierta");
    expect(text(cell(el, deli, 1))).toBe("Sin horario");
  });
});

describe("Hours: where a link opens it", () => {
  it.each([
    ["/manage/hours/view/week/department/deli", deli],
    ["/manage/hours/station/bar", bar],
  ])("focuses the subject %s names", async (path, key) => {
    history.replaceState(null, "", path);
    const { api } = server();
    const el = await mount(api);
    const header = el.shadowRoot!.querySelector(`th[data-subject="${key}"]`)!;
    expect(el.shadowRoot!.activeElement).toBe(header);
    expect(modal(el)).toBeNull();
    // The arrow keys move only between the days' cells.
    await userEvent.keyboard("{ArrowDown}");
    expect(el.shadowRoot!.activeElement).toBe(header);
  });

  it.each([
    "/manage/hours/department/nobody",
    "/manage/hours/department/bar",
    "/manage/hours/station/terrace",
  ])("opens no editor and focuses nothing for an unknown subject: %s", async (path) => {
    history.replaceState(null, "", path);
    const { api } = server();
    const el = await mount(api);
    expect(modal(el)).toBeNull();
    expect(el.shadowRoot!.activeElement).toBeNull();
  });

  it("opens the tab its link names, and records a tab change in the address", async () => {
    history.replaceState(null, "", "/manage/hours/view/dates");
    const { api } = server();
    const el = await mount(api);
    expect(el.shadowRoot!.querySelector('wt-data-table[data-test="special-dates"]')).not.toBeNull();
    await selectTab(el, "week");
    expect(location.pathname).toBe("/manage/hours/view/week");
    expect(el.shadowRoot!.querySelector('table[data-test="week-grid"]')).not.toBeNull();
  });
});

type ListTable = HTMLElement & {
  updateComplete: Promise<unknown>;
  columns: { key: string; label: string; group?: string; pinned?: string }[];
};
const listTable = (el: HoursScreen) =>
  el.shadowRoot!.querySelector<ListTable>('wt-data-table[data-test="special-dates"]')!;
function listRows(el: HoursScreen): string[][] {
  return [...listTable(el).shadowRoot!.querySelectorAll("tbody tr")].map((row) =>
    [...row.querySelectorAll("td")].map(text),
  );
}
const rowOf = (el: HoursScreen, name: string) =>
  [...listTable(el).shadowRoot!.querySelectorAll("tbody tr")].find((row) =>
    text(row).includes(name),
  )!;

describe("Hours: special dates", () => {
  it("lists each date with its name, colour and the week's columns, and a pinned actions column", async () => {
    const { api } = server();
    const el = await mount(api);
    await selectTab(el, "dates");
    const table = listTable(el);
    expect(table.columns.map(({ key, label, group }) => [key, label, group ?? null])).toEqual([
      ["date", "Date", null],
      ["name", "Name", null],
      [restaurant, "Restaurant", "Departments"],
      [deli, "Deli", "Departments"],
      [kitchen, "Kitchen", "Prep stations"],
      [bar, "Bar", "Prep stations"],
      ["actions", "Actions", null],
    ]);
    expect(table.columns.at(-1)!.pinned).toBe("end");
    await table.updateComplete;
    expect(listRows(el).map((row) => row.slice(0, 6))).toEqual([
      [
        "Mon, 12 Oct 2026",
        "Fiesta Nacional Red",
        "12:00–23:00",
        "Closed",
        "Always open",
        "Standard hours: 17:00–23:00",
      ],
      ["Tue, 13 Oct 2026", "Staff day off Grey", "Closed", "Closed", "Always open", "Closed"],
    ]);
    expect(rowOf(el, "Fiesta").querySelector('[part~="inherited"]')).not.toBeNull();
    expect(rowOf(el, "Staff").querySelector('[part~="inherited"]')).toBeNull();
  });

  it("adds a date whose blank cells keep the standard hours, shown in grey for that date", async () => {
    const { api, calls } = server();
    const el = await mount(api);
    await selectTab(el, "dates");
    await click(el, el.shadowRoot!.querySelector('[data-test="add-date"]'));
    expect(modal(el)!.getAttribute("heading")).toBe("Add a special date");
    expect(field(el, "closeWholeVenue")).not.toBeNull();
    const colour = field(el, "colour") as Field & { options: { value: string; label: string }[] };
    expect(colour.options.map((o) => [o.value, o.label])).toEqual([
      ["red", "Red"],
      ["amber", "Amber"],
      ["grey", "Grey"],
      ["blue", "Blue"],
      ["green", "Green"],
      ["purple", "Purple"],
    ]);
    const editors = [
      ...el.shadowRoot!.querySelectorAll<HTMLElement & { label: string; fieldPrefix: string }>(
        "wt-modal hours-cell-editor",
      ),
    ];
    expect(editors.map((e) => [e.label, e.fieldPrefix])).toEqual([
      ["Restaurant", "department.restaurant"],
      ["Deli", "department.deli"],
      ["Bar", "station.bar"],
    ]);
    expect(text(el.shadowRoot!.querySelector('[data-test="default-station"]'))).toBe(
      "Kitchen: Always open (default station)",
    );
    const mode = field(el, "station.bar.mode") as Field & {
      placeholder: string;
      options: { value: string }[];
    };
    expect(mode.options.map((o) => o.value)).toEqual(["", "closed", "all_day", "periods"]);
    expect(mode.placeholder).toBe("Standard hours");
    await setField(el, "date", "2026-10-19");
    expect(mode.placeholder).toBe("Standard hours (17:00–23:00)");
    expect(
      (field(el, "department.restaurant.mode") as Field & { placeholder: string }).placeholder,
    ).toBe("Standard hours (Closed)");
    await setField(el, "name", "Puente");
    await choose(el, "colour", "amber");
    await choose(el, "department.restaurant.mode", "closed");
    await choose(el, "station.bar.mode", "periods");
    await setField(el, "station.bar.periods.0.opensAt", "18:00");
    await setField(el, "station.bar.periods.0.closesAt", "22:00");
    await click(el, saveButton(el));
    expect(calls("POST")).toEqual([
      [
        "/management-api/venue-service/special-dates",
        {
          date: "2026-10-19",
          name: "Puente",
          colour: "amber",
          closeWholeVenue: false,
          cells: [
            {
              subject: { kind: "department", id: "restaurant" },
              cell: { mode: "closed", periods: [] },
            },
            {
              subject: { kind: "station", id: "bar" },
              cell: {
                mode: "periods",
                periods: [
                  {
                    id: expect.stringMatching(/^[0-9a-f-]{36}$/),
                    opensAt: "18:00",
                    closesAt: "22:00",
                  },
                ],
              },
            },
          ],
        },
      ],
    ]);
    expect(modal(el)).toBeNull();
  });

  it("marks every missing field of a new date and the bottom of the form", async () => {
    const { api, calls } = server();
    const el = await mount(api);
    await selectTab(el, "dates");
    await click(el, el.shadowRoot!.querySelector('[data-test="add-date"]'));
    await choose(el, "department.deli.mode", "periods");
    await click(el, saveButton(el));
    expect(field(el, "date")!.error).toBe("Enter a date.");
    expect(field(el, "name")!.error).toBe("Enter a name.");
    expect(field(el, "colour")!.error).toBe("Choose a colour.");
    expect(field(el, "department.deli.periods.0.opensAt")!.error).toBe("Enter a time.");
    expect(await bottomMessage(el)).toBe("Correct the highlighted fields to continue.");
    expect(saveButton(el).disabled).toBe(true);
    await setField(el, "name", "   ");
    expect(field(el, "name")!.error).toBe("Enter a name.");
    expect(calls("POST")).toEqual([]);
  });

  it("edits a date in place, keeping the cells of departments it does not show", async () => {
    const { api, calls } = server();
    const el = await mount(api);
    await selectTab(el, "dates");
    await menuAction(el, rowOf(el, "Fiesta"), "edit-date");
    expect(modal(el)!.getAttribute("heading")).toBe("Edit special date");
    expect(field(el, "date")!.value).toBe("2026-10-12");
    expect(field(el, "name")!.value).toBe("Fiesta Nacional");
    expect(field(el, "colour")!.value).toBe("red");
    expect(field(el, "department.restaurant.periods.0.closesAt")!.value).toBe("23:00");
    await choose(el, "department.deli.mode", "");
    await setField(el, "name", "Fiesta");
    await click(el, saveButton(el));
    expect(calls("PUT")).toEqual([
      [
        "/management-api/venue-service/special-dates/fiesta",
        {
          date: "2026-10-12",
          name: "Fiesta",
          colour: "red",
          closeWholeVenue: false,
          cells: [
            {
              subject: { kind: "department", id: "restaurant" },
              cell: { mode: "periods", periods: [P("f1", "12:00", "23:00")] },
            },
            {
              subject: { kind: "department", id: "terrace" },
              cell: { mode: "closed", periods: [] },
            },
          ],
        },
      ],
    ]);
  });

  it("closes the whole venue on a date, explaining the locked cells and the default station", async () => {
    const { api, calls } = server();
    const el = await mount(api);
    await selectTab(el, "dates");
    await click(el, el.shadowRoot!.querySelector('[data-test="close-venue"]'));
    expect(modal(el)!.getAttribute("heading")).toBe("Close the whole venue");
    expect((field(el, "closeWholeVenue") as Field & { checked: boolean }).checked).toBe(true);
    expect(text(el.shadowRoot!.querySelector('[data-test="whole-venue-note"]'))).toBe(
      "Every department and prep station is closed on this date, except the default station, which is always open. The hours below are kept for when you turn this off.",
    );
    const editors = [
      ...el.shadowRoot!.querySelectorAll<HTMLElement & { disabled: boolean }>(
        "wt-modal hours-cell-editor",
      ),
    ];
    expect(editors.every((editor) => editor.disabled)).toBe(true);
    await setField(el, "date", "2026-12-25");
    await setField(el, "name", "Christmas");
    await choose(el, "colour", "green");
    await click(el, saveButton(el));
    expect(calls("POST")[0]![1]).toEqual({
      date: "2026-12-25",
      name: "Christmas",
      colour: "green",
      closeWholeVenue: true,
      cells: [],
    });
  });

  it("unlocks the cells when the whole-venue closure is turned off", async () => {
    const { api } = server();
    const el = await mount(api);
    await selectTab(el, "dates");
    await menuAction(el, rowOf(el, "Staff"), "edit-date");
    const toggle = field(el, "closeWholeVenue")!;
    toggle.dispatchEvent(
      new CustomEvent("wt-change", { detail: { checked: false }, bubbles: true, composed: true }),
    );
    await settle(el);
    expect(el.shadowRoot!.querySelector('[data-test="whole-venue-note"]')).toBeNull();
    const editors = [
      ...el.shadowRoot!.querySelectorAll<HTMLElement & { disabled: boolean }>(
        "wt-modal hours-cell-editor",
      ),
    ];
    expect(editors.some((editor) => editor.disabled)).toBe(false);
  });

  const switchClosure = async (el: HoursScreen, checked: boolean) => {
    field(el, "closeWholeVenue")!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { checked }, bubbles: true, composed: true }),
    );
    await settle(el);
  };

  it("resets each half-filled cell to its stored hours when the closure is switched on, so Save is not held", async () => {
    const { api, calls } = server();
    const el = await mount(api);
    await selectTab(el, "dates");
    await menuAction(el, rowOf(el, "Fiesta"), "edit-date");
    await choose(el, "station.bar.mode", "periods");
    await setField(el, "station.bar.periods.0.opensAt", "18:00");
    await setField(el, "department.restaurant.periods.0.closesAt", "");
    await switchClosure(el, true);
    expect(field(el, "station.bar.mode")!.value).toBe("");
    expect(field(el, "station.bar.periods.0.opensAt")).toBeNull();
    expect(field(el, "department.restaurant.periods.0.closesAt")!.value).toBe("23:00");
    expect(saveButton(el).disabled).toBe(false);
    await click(el, saveButton(el));
    expect(calls("PUT")).toEqual([
      [
        "/management-api/venue-service/special-dates/fiesta",
        {
          date: "2026-10-12",
          name: "Fiesta Nacional",
          colour: "red",
          closeWholeVenue: true,
          cells: model().specialCells[0]!.cells,
        },
      ],
    ]);
    expect(modal(el)).toBeNull();
  });

  it("saves a valid edit made before the closure is switched on, as the locked cell shows it", async () => {
    const { api, calls } = server();
    const el = await mount(api);
    await selectTab(el, "dates");
    await menuAction(el, rowOf(el, "Fiesta"), "edit-date");
    await choose(el, "station.bar.mode", "periods");
    await setField(el, "station.bar.periods.0.opensAt", "18:00");
    await setField(el, "station.bar.periods.0.closesAt", "22:00");
    await switchClosure(el, true);
    expect(field(el, "station.bar.periods.0.closesAt")!.value).toBe("22:00");
    await click(el, saveButton(el));
    const [stored] = model().specialCells;
    expect(calls("PUT")).toEqual([
      [
        "/management-api/venue-service/special-dates/fiesta",
        {
          date: "2026-10-12",
          name: "Fiesta Nacional",
          colour: "red",
          closeWholeVenue: true,
          cells: [
            stored!.cells[0],
            stored!.cells[1],
            {
              subject: { kind: "station", id: "bar" },
              cell: {
                mode: "periods",
                periods: [
                  {
                    id: expect.stringMatching(/^[0-9a-f-]{36}$/),
                    opensAt: "18:00",
                    closesAt: "22:00",
                  },
                ],
              },
            },
            stored!.cells[2],
          ],
        },
      ],
    ]);
  });

  it("saves the hours entered on a new date before the closure is switched on", async () => {
    const { api, calls } = server();
    const el = await mount(api);
    await selectTab(el, "dates");
    await click(el, el.shadowRoot!.querySelector('[data-test="add-date"]'));
    await setField(el, "date", "2026-12-24");
    await setField(el, "name", "Christmas Eve");
    await choose(el, "colour", "green");
    await choose(el, "department.restaurant.mode", "all_day");
    await choose(el, "station.bar.mode", "closed");
    await switchClosure(el, true);
    await click(el, saveButton(el));
    expect(calls("POST")).toEqual([
      [
        "/management-api/venue-service/special-dates",
        {
          date: "2026-12-24",
          name: "Christmas Eve",
          colour: "green",
          closeWholeVenue: true,
          cells: [
            {
              subject: { kind: "department", id: "restaurant" },
              cell: { mode: "all_day", periods: [] },
            },
            { subject: { kind: "station", id: "bar" }, cell: { mode: "closed", periods: [] } },
          ],
        },
      ],
    ]);
  });

  it("explains before saving that a time the clock shows twice follows these hours both times, and still saves", async () => {
    const { api, calls } = server();
    const el = await mount(api);
    await selectTab(el, "dates");
    await click(el, el.shadowRoot!.querySelector('[data-test="add-date"]'));
    const notes = () =>
      [...el.shadowRoot!.querySelectorAll('[data-test="repeat-note"]')].map((note) => text(note));
    const back = clocksBack();
    const barTwice = `Bar: the clock goes back, so ${back.twice} happens twice. These hours apply both times.`;
    await setField(el, "name", "Clocks back");
    await choose(el, "colour", "red");
    await choose(el, "station.bar.mode", "periods");
    await setField(el, "station.bar.periods.0.opensAt", back.twice);
    await setField(el, "station.bar.periods.0.closesAt", "04:00");
    expect(notes()).toEqual([]);
    await setField(el, "date", back.date);
    expect(notes()).toEqual([barTwice]);
    await setField(el, "station.bar.periods.0.closesAt", "");
    expect(notes()).toEqual([]);
    await setField(el, "station.bar.periods.0.closesAt", "04:00");
    expect(notes()).toEqual([barTwice]);

    await setField(el, "date", back.weekBefore);
    expect(notes()).toEqual([]);

    await setField(el, "date", back.dayBefore);
    await setField(el, "station.bar.periods.0.opensAt", "22:00");
    expect(notes()).toEqual([]);
    await setField(el, "station.bar.periods.0.closesAt", back.twice);
    expect(notes()).toEqual([barTwice]);

    await switchClosure(el, true);
    expect(notes()).toEqual([]);
    await switchClosure(el, false);
    expect(notes()).toEqual([barTwice]);

    await click(el, saveButton(el));
    expect(calls("POST")).toEqual([
      [
        "/management-api/venue-service/special-dates",
        expect.objectContaining({
          date: back.dayBefore,
          cells: [
            {
              subject: { kind: "station", id: "bar" },
              cell: {
                mode: "periods",
                periods: [{ id: expect.any(String), opensAt: "22:00", closesAt: back.twice }],
              },
            },
          ],
        }),
      ],
    ]);
    expect(modal(el)).toBeNull();
  });

  it("explains a time the clock shows twice in Spanish", async () => {
    setLocale("es");
    const back = clocksBack();
    const { api } = server();
    const el = await mount(api);
    await selectTab(el, "dates");
    await click(el, el.shadowRoot!.querySelector('[data-test="add-date"]'));
    await setField(el, "date", back.date);
    await choose(el, "station.bar.mode", "periods");
    await setField(el, "station.bar.periods.0.opensAt", "01:00");
    await setField(el, "station.bar.periods.0.closesAt", back.alsoTwice);
    expect(text(el.shadowRoot!.querySelector('[data-test="repeat-note"]'))).toBe(
      `Bar: el reloj se atrasa, así que la hora ${back.alsoTwice} se da dos veces. Este horario se aplica las dos veces.`,
    );
  });

  /** A Madrid clocks-back date, the day and the week before it, and times on it the clock shows twice. */
  function clocksBack() {
    const back = clockChangeAfter("Europe/Madrid", "2026-10-08T00:00:00Z", "backward");
    const daysBefore = (days: number) =>
      new Date(Date.parse(`${back.date}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
    return {
      date: back.date,
      dayBefore: daysBefore(1),
      weekBefore: daysBefore(7),
      twice: minutesAfter(back.after, 30),
      alsoTwice: minutesAfter(back.after, 15),
    };
  }

  /** Fiesta's stored cells gain a period from the repeated time for the bar and the default kitchen. */
  function fiestaFrom(state: { model: HoursModel }, time: string) {
    const cell: WeekCell = { mode: "periods", periods: [P("fx", time, minutesAfter(time, 60))] };
    state.model.specialCells[0]!.cells.push(
      { subject: { kind: "station", id: "bar" }, cell },
      { subject: { kind: "station", id: "kitchen" }, cell },
    );
  }

  const duplicateNotes = (el: HoursScreen) =>
    [...el.shadowRoot!.querySelectorAll('[data-test="duplicate-repeat-note"]')].map((note) =>
      text(note),
    );

  it("explains under each duplicate target where the clock shows a copied time twice, and still saves", async () => {
    const { date, weekBefore, twice } = clocksBack();
    const { api, state, calls } = server();
    fiestaFrom(state, twice);
    const el = await mount(api);
    await selectTab(el, "dates");
    await menuAction(el, rowOf(el, "Fiesta"), "duplicate-date");
    await setField(el, "dates.0", weekBefore);
    expect(duplicateNotes(el)).toEqual([]);
    await click(el, el.shadowRoot!.querySelector('[data-test="add-target"]'));
    await setField(el, "dates.1", date);
    // The default kitchen is always open, so its copied period is not explained.
    expect(duplicateNotes(el)).toEqual([
      `Bar on ${formatDate(date)}: the clock goes back, so ${twice} happens twice. These hours apply both times.`,
    ]);
    const note = el.shadowRoot!.querySelector('[data-test="duplicate-repeat-note"]')!;
    expect(note.previousElementSibling!.querySelector('[name="dates.1"]')).not.toBeNull();
    await setField(el, "dates.1", "not a date");
    expect(duplicateNotes(el)).toEqual([]);
    await setField(el, "dates.1", date);
    await click(el, saveButton(el));
    expect(calls("POST")).toEqual([
      [
        "/management-api/venue-service/special-dates/fiesta/duplicate",
        { dates: [weekBefore, date] },
      ],
    ]);
    expect(modal(el)).toBeNull();
  });

  it("explains a duplicated time the clock shows twice in Spanish", async () => {
    setLocale("es");
    const { date, twice } = clocksBack();
    const { api, state } = server();
    fiestaFrom(state, twice);
    const el = await mount(api);
    await selectTab(el, "dates");
    await menuAction(el, rowOf(el, "Fiesta"), "duplicate-date");
    await setField(el, "dates.0", date);
    expect(duplicateNotes(el)).toEqual([
      `Bar el ${formatDate(date)}: el reloj se atrasa, así que la hora ${twice} se da dos veces. Este horario se aplica las dos veces.`,
    ]);
  });

  it("explains no repeated time while the venue's clock cannot be read", async () => {
    const { date, twice } = clocksBack();
    const { api, state } = server();
    state.model.clockReadable = false;
    state.model.civilDate = null;
    state.model.dayCutover = "not a time";
    fiestaFrom(state, twice);
    const el = await mount(api);
    await selectTab(el, "dates");
    await click(el, el.shadowRoot!.querySelector('[data-test="add-date"]'));
    await setField(el, "date", date);
    await choose(el, "station.bar.mode", "periods");
    await setField(el, "station.bar.periods.0.opensAt", twice);
    await setField(el, "station.bar.periods.0.closesAt", minutesAfter(twice, 60));
    expect(field(el, "station.bar.periods.0.closesAt")!.value).toBe(minutesAfter(twice, 60));
    expect(el.shadowRoot!.querySelectorAll('[data-test="repeat-note"]')).toHaveLength(0);
    await click(el, el.shadowRoot!.querySelector('[data-test="cancel-editor"]'));
    await menuAction(el, rowOf(el, "Fiesta"), "duplicate-date");
    await setField(el, "dates.0", date);
    expect(field(el, "dates.0")!.value).toBe(date);
    expect(duplicateNotes(el)).toEqual([]);
  });

  it("lists, edits and deletes a date saved beyond the calendar's year", async () => {
    const { api, state, calls } = server();
    const far = {
      id: "far",
      date: "2028-12-25",
      name: "Christmas 2028",
      colour: "green" as const,
      closeWholeVenue: false,
    };
    state.model.specialDates.push(far);
    state.model.specialCells.push({
      specialDateId: "far",
      cells: [{ subject: { kind: "station", id: "bar" }, cell: { mode: "closed", periods: [] } }],
    });
    const el = await mount(api);
    await selectTab(el, "dates");
    await listTable(el).updateComplete;
    expect(listRows(el).map((row) => row.slice(0, 2))).toEqual([
      ["Mon, 12 Oct 2026", "Fiesta Nacional Red"],
      ["Tue, 13 Oct 2026", "Staff day off Grey"],
      ["Mon, 25 Dec 2028", "Christmas 2028 Green"],
    ]);
    await menuAction(el, rowOf(el, "Christmas 2028"), "edit-date");
    expect(field(el, "date")!.value).toBe("2028-12-25");
    expect(field(el, "station.bar.mode")!.value).toBe("closed");
    await setField(el, "name", "Christmas Day 2028");
    await click(el, saveButton(el));
    expect(calls("PUT")).toEqual([
      [
        "/management-api/venue-service/special-dates/far",
        {
          date: "2028-12-25",
          name: "Christmas Day 2028",
          colour: "green",
          closeWholeVenue: false,
          cells: [
            { subject: { kind: "station", id: "bar" }, cell: { mode: "closed", periods: [] } },
          ],
        },
      ],
    ]);
    await menuAction(el, rowOf(el, "Christmas 2028"), "delete-date");
    await click(el, saveButton(el));
    expect(calls("DELETE")).toEqual([
      ["/management-api/venue-service/special-dates/far", undefined],
    ]);
  });

  it.each([
    [
      { code: "special_date.date_taken", params: { date: "2026-10-13" } },
      "date",
      "Tue, 13 Oct 2026 already has special hours.",
    ],
    [
      {
        code: "hours.invalid",
        params: { field: "cells.0.cell", date: "2026-10-11", subjectId: "restaurant" },
      },
      "department.restaurant.mode",
      "These hours overlap the hours on Sun, 11 Oct 2026.",
    ],
    [
      { code: "hours.invalid", params: { field: "cells", date: "2026-10-13", subjectId: "bar" } },
      "station.bar.mode",
      "These hours overlap the hours on Tue, 13 Oct 2026.",
    ],
    [
      { code: "hours.invalid", params: { field: "cells.0.cell.periods.0.closesAt" } },
      "department.restaurant.periods.0.closesAt",
      "The clock skips this time on this date.",
    ],
    [
      { code: "hours.invalid", params: { field: "date", date: "2026-10-12", subjectId: "bar" } },
      "date",
      "Moving this date away from Mon, 12 Oct 2026 would leave its standard hours overlapping a neighbouring date.",
    ],
    [{ code: "hours.invalid", params: { field: "name" } }, "name", "Check this value."],
    [
      {
        code: "menu_timetable.invalid",
        params: { field: "date", date: "2026-10-20", departmentId: "restaurant" },
      },
      "date",
      "Restaurant's menu timetable would overlap a neighbouring date's menus here, or use a time the clock skips.",
    ],
    [
      { code: "hours.invalid", params: { field: "cells.0.cell" } },
      "department.restaurant.mode",
      "Check the highlighted hours: periods must not overlap, including past midnight.",
    ],
  ])("puts a refusal beside the field it names: %j", async (refusal, name, message) => {
    const { api, state, calls } = server();
    const el = await mount(api);
    await selectTab(el, "dates");
    await menuAction(el, rowOf(el, "Fiesta"), "edit-date");
    state.writes.push({ reject: refusal });
    await click(el, saveButton(el));
    expect(field(el, name)!.error).toBe(message);
    expect(await bottomMessage(el)).toBe("Correct the highlighted fields to continue.");
    expect(saveButton(el).disabled).toBe(false);
    await setField(
      el,
      name === "date" ? "date" : "name",
      name === "date" ? "2026-10-20" : "Fiesta",
    );
    if (name === "date") expect(field(el, name)!.error).toBe("");
    await click(el, saveButton(el));
    expect(calls("PUT")).toHaveLength(2);
  });

  it.each([
    [
      { code: "special_date.not_found", params: { specialDateId: "fiesta" } },
      "This special date no longer exists.",
    ],
    [
      {
        code: "hours.invalid",
        params: { field: "cells.2.cell", date: "2026-10-13", subjectId: "terrace" },
      },
      "These hours overlap the hours on Tue, 13 Oct 2026.",
    ],
    [{ code: "connection.failed" }, "The change could not be saved."],
    [
      { code: "hours.invalid", params: { field: "closeWholeVenue" } },
      "Check the highlighted hours: periods must not overlap, including past midnight.",
    ],
    [
      { code: "hours.invalid", params: { field: "cells.0.cell.periods.0.id" } },
      "One of these periods could not be saved as sent. Close this editor and open it again to start from the saved hours.",
    ],
    [
      { code: "hours.invalid", params: { field: "cells.1.subject" } },
      "A department or prep station these hours are for no longer exists. Close this editor and open it again.",
    ],
  ])("says a refusal that names no shown field at the bottom: %j", async (refusal, message) => {
    const { api, state } = server();
    const el = await mount(api);
    await selectTab(el, "dates");
    await menuAction(el, rowOf(el, "Fiesta"), "edit-date");
    state.writes.push({ reject: refusal });
    await click(el, saveButton(el));
    expect(await bottomMessage(el)).toBe(message);
    expect(
      findAll<Field>(el, "wt-modal [name]")
        .filter((input) => input.error)
        .map((input) => input.getAttribute("name")),
    ).toEqual([]);
    expect(saveButton(el).disabled).toBe(false);
  });

  it("duplicates a date to several target dates in one batch, asking for nothing else", async () => {
    const { api, calls } = server();
    const el = await mount(api);
    await selectTab(el, "dates");
    await menuAction(el, rowOf(el, "Fiesta"), "duplicate-date");
    expect(modal(el)!.getAttribute("heading")).toBe("Duplicate Fiesta Nacional");
    expect(text(el.shadowRoot!.querySelector('[data-test="duplicate-note"]'))).toBe(
      "Copies the colour and every cell to each date. A date that is a public holiday, local ones included, takes the holiday's name; any other date keeps this name.",
    );
    expect(field(el, "name")).toBeNull();
    expect(field(el, "colour")).toBeNull();
    expect(el.shadowRoot!.querySelector("wt-modal hours-cell-editor")).toBeNull();
    await setField(el, "dates.0", "2026-11-02");
    await click(el, el.shadowRoot!.querySelector('[data-test="add-target"]'));
    await setField(el, "dates.1", "2026-11-02");
    await click(el, el.shadowRoot!.querySelector('[data-test="add-target"]'));
    await click(el, saveButton(el));
    expect(field(el, "dates.1")!.error).toBe("This date is listed twice.");
    expect(field(el, "dates.2")!.error).toBe("Enter a date.");
    expect(await bottomMessage(el)).toBe("Correct the highlighted fields to continue.");
    await click(el, el.shadowRoot!.querySelector('[data-test="remove-target-2"]'));
    await setField(el, "dates.1", "2026-11-09");
    await click(el, saveButton(el));
    expect(calls("POST")).toEqual([
      [
        "/management-api/venue-service/special-dates/fiesta/duplicate",
        { dates: ["2026-11-02", "2026-11-09"] },
      ],
    ]);
    expect(modal(el)).toBeNull();
  });

  it.each([
    [
      { code: "special_date.date_taken", params: { date: "2026-11-09" } },
      "dates.1",
      "Mon, 9 Nov 2026 already has special hours.",
    ],
    [
      { code: "hours.invalid", params: { field: "dates.0", date: "2026-11-02", subjectId: "bar" } },
      "dates.0",
      "The clock skips a time these hours use on this date.",
    ],
    [
      { code: "hours.invalid", params: { field: "dates.1", date: "2026-11-08", subjectId: "bar" } },
      "dates.1",
      "These hours overlap the hours on Sun, 8 Nov 2026.",
    ],
    [
      {
        code: "menu_timetable.invalid",
        params: { field: "date", date: "2026-11-09", departmentId: "restaurant" },
      },
      "dates.1",
      "Restaurant's menu timetable would overlap a neighbouring date's menus here, or use a time the clock skips.",
    ],
  ])(
    "puts a duplicate's refusal beside the target date it names: %j",
    async (refusal, name, message) => {
      const { api, state } = server();
      const el = await mount(api);
      await selectTab(el, "dates");
      await menuAction(el, rowOf(el, "Fiesta"), "duplicate-date");
      await setField(el, "dates.0", "2026-11-02");
      await click(el, el.shadowRoot!.querySelector('[data-test="add-target"]'));
      await setField(el, "dates.1", "2026-11-09");
      state.writes.push({ reject: refusal });
      await click(el, saveButton(el));
      expect(field(el, name)!.error).toBe(message);
      const other = name === "dates.0" ? "dates.1" : "dates.0";
      expect(field(el, other)!.error).toBe("");
      expect(saveButton(el).disabled).toBe(false);
    },
  );

  it.each([
    [
      { code: "special_date.date_taken", params: { date: "2026-11-01" } },
      "Sun, 1 Nov 2026 already has special hours.",
    ],
    [
      { code: "hours.invalid", params: { field: "dates" } },
      "Check the highlighted hours: periods must not overlap, including past midnight.",
    ],
    [{ code: "connection.failed" }, "The change could not be saved."],
    [
      {
        code: "menu_timetable.invalid",
        params: { field: "date", date: "2026-12-01", departmentId: "restaurant" },
      },
      "Restaurant's menu timetable would overlap a neighbouring date's menus here, or use a time the clock skips.",
    ],
  ])(
    "says a duplicate's refusal that names no target at the bottom: %j",
    async (refusal, message) => {
      const { api, state } = server();
      const el = await mount(api);
      await selectTab(el, "dates");
      await menuAction(el, rowOf(el, "Fiesta"), "duplicate-date");
      await setField(el, "dates.0", "2026-11-02");
      state.writes.push({ reject: refusal });
      await click(el, saveButton(el));
      expect(await bottomMessage(el)).toBe(message);
      expect(field(el, "dates.0")!.error).toBe("");
      expect(saveButton(el).disabled).toBe(false);
    },
  );

  it("names inactive columns when they are shown", async () => {
    const { api } = server();
    const el = await mount(api);
    await selectTab(el, "dates");
    el.shadowRoot!.querySelector<HTMLElement>('wt-switch[name="showInactive"]')!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { checked: true }, bubbles: true, composed: true }),
    );
    await settle(el);
    const terrace = listTable(el).columns.find((column) => column.key === "department:terrace");
    expect(terrace?.label).toBe("Terrace (inactive)");
  });

  it("deletes a date after confirming, and names the neighbouring date when that is refused", async () => {
    const { api, state, calls } = server();
    const el = await mount(api);
    await selectTab(el, "dates");
    await menuAction(el, rowOf(el, "Staff"), "delete-date");
    expect(modal(el)!.getAttribute("heading")).toBe("Delete special date");
    expect(text(el.shadowRoot!.querySelector('[data-test="confirm-text"]'))).toBe(
      "Delete Staff day off on Tue, 13 Oct 2026? Its hours go back to the standard week.",
    );
    state.writes.push({
      reject: {
        code: "hours.invalid",
        params: { field: "date", date: "2026-10-14", subjectId: "bar" },
      },
    });
    await click(el, saveButton(el));
    expect(await bottomMessage(el)).toBe(
      "Deleting this date would leave the standard hours overlapping the hours on Wed, 14 Oct 2026.",
    );
    expect(saveButton(el).disabled).toBe(false);
    await click(el, saveButton(el));
    expect(calls("DELETE")).toEqual([
      ["/management-api/venue-service/special-dates/staff", undefined],
      ["/management-api/venue-service/special-dates/staff", undefined],
    ]);
    expect(modal(el)).toBeNull();
  });

  it("says at the bottom when deleting would leave a department's menu week overlapping a neighbour's menus", async () => {
    const { api, state } = server();
    const el = await mount(api);
    await selectTab(el, "dates");
    await menuAction(el, rowOf(el, "Staff"), "delete-date");
    state.writes.push({
      reject: {
        code: "menu_timetable.invalid",
        params: { field: "date", date: "2026-10-14", departmentId: "restaurant" },
      },
    });
    await click(el, saveButton(el));
    expect(await bottomMessage(el)).toBe(
      "Deleting this date would leave Restaurant's normal menu week overlapping the menu timetable on Wed, 14 Oct 2026.",
    );
    expect(saveButton(el).disabled).toBe(false);
  });

  it("says there are no special dates yet", async () => {
    const { api, state } = server();
    state.model.days = state.model.days.map((day) => ({ ...day, specialDate: null }));
    state.model.specialDates = [];
    state.model.specialCells = [];
    const el = await mount(api);
    await selectTab(el, "dates");
    const table = listTable(el) as ListTable & { emptyMessage: string };
    expect(table.emptyMessage).toBe("No special dates yet.");
  });

  it("speaks Spanish in the list", async () => {
    setLocale("es");
    const { api } = server();
    const el = await mount(api);
    await selectTab(el, "dates");
    await listTable(el).updateComplete;
    expect(listRows(el)[0]!.slice(0, 6)).toEqual([
      "lun, 12 oct 2026",
      "Fiesta Nacional Rojo",
      "12:00–23:00",
      "Cerrado",
      "Siempre abierta",
      "Horario habitual: 17:00–23:00",
    ]);
  });
});

describe("Hours: the calendar", () => {
  const calendar = (el: HoursScreen) =>
    el.shadowRoot!.querySelector<
      HTMLElement & { readOnly: boolean; updateComplete: Promise<unknown> }
    >("hours-calendar");
  const day = (el: HoursScreen, date: string) =>
    calendar(el)!.shadowRoot!.querySelector<HTMLButtonElement>(`td[data-date="${date}"] button`)!;
  async function openDay(el: HoursScreen, date: string) {
    await click(el, day(el, date));
    await settle(el);
  }
  async function panelAction(el: HoursScreen, kind: string) {
    await click(el, calendar(el)!.shadowRoot!.querySelector(`[data-test="calendar-${kind}"]`));
    await settle(el);
  }
  const renamed = (name: string): HoursModel => {
    const next = structuredClone(model());
    next.specialDates[0]!.name = name;
    next.days[1]!.specialDate!.name = name;
    return next;
  };

  it("opens from its link, and records choosing it in the address", async () => {
    history.replaceState(null, "", "/manage/hours/view/calendar");
    const { api } = server();
    const el = await mount(api);
    expect(calendar(el)).not.toBeNull();
    await selectTab(el, "week");
    expect(calendar(el)).toBeNull();
    await selectTab(el, "calendar");
    expect(location.pathname).toBe("/manage/hours/view/calendar");
    expect(text(calendar(el)!.shadowRoot!.querySelector('[data-test="month"]'))).toBe(
      "October 2026",
    );
    expect(calendar(el)!.readOnly).toBe(false);
  });

  it("edits a date from the calendar, and without live updates the calendar and the list read it at once under the same id", async () => {
    const { api, state, calls } = server();
    const el = await mount(api);
    await selectTab(el, "calendar");
    await openDay(el, "2026-10-12");
    await panelAction(el, "edit");
    expect(modal(el)!.getAttribute("heading")).toBe("Edit special date");
    expect(field(el, "name")!.value).toBe("Fiesta Nacional");
    await setField(el, "name", "Fiesta renamed");
    state.model = renamed("Fiesta renamed");
    await click(el, saveButton(el));
    await vi.waitFor(() => expect(modal(el)).toBeNull());
    await settle(el);
    expect(calls("PUT")).toEqual([
      [
        "/management-api/venue-service/special-dates/fiesta",
        {
          date: "2026-10-12",
          name: "Fiesta renamed",
          colour: "red",
          closeWholeVenue: false,
          cells: model().specialCells[0]!.cells,
        },
      ],
    ]);
    // Still on the calendar, which has read its month again.
    expect(text(day(el, "2026-10-12"))).toBe("12 Fiesta renamed");
    await selectTab(el, "dates");
    await listTable(el).updateComplete;
    const table = listTable(el) as ListTable & {
      rows: { special: { id: string } }[];
      rowKey: (row: unknown) => string;
    };
    expect(listRows(el)[0]!.slice(0, 2)).toEqual(["Mon, 12 Oct 2026", "Fiesta renamed Red"]);
    expect(table.rowKey(table.rows[0])).toBe("fiesta");
  });

  it("shows a date added in the list on the calendar at once", async () => {
    const { api, state } = server();
    const el = await mount(api);
    await selectTab(el, "dates");
    await click(el, el.shadowRoot!.querySelector('[data-test="add-date"]'));
    await setField(el, "date", "2026-10-21");
    await setField(el, "name", "Market day");
    await choose(el, "colour", "blue");
    const market = {
      id: "market",
      date: "2026-10-21",
      name: "Market day",
      colour: "blue" as const,
      closeWholeVenue: false,
    };
    state.writes.push(market);
    state.model.specialDates.push(market);
    state.model.days.push({ date: market.date, specialDate: market, holidays: [], tone: "blue" });
    state.model.specialCells.push({ specialDateId: "market", cells: [] });
    await click(el, saveButton(el));
    await vi.waitFor(() => expect(modal(el)).toBeNull());
    await selectTab(el, "calendar");
    await settle(el);
    expect(text(day(el, "2026-10-21"))).toBe("21 Market day");
  });

  it("makes an ordinary date special with the date already filled in", async () => {
    const { api, calls } = server();
    const el = await mount(api);
    await selectTab(el, "calendar");
    await openDay(el, "2026-10-15");
    await panelAction(el, "make_special");
    expect(modal(el)!.getAttribute("heading")).toBe("Add a special date");
    expect(field(el, "date")!.value).toBe("2026-10-15");
    expect(field(el, "name")!.value).toBe("2026-10-15");
    await setField(el, "name", "Our party");
    await choose(el, "colour", "green");
    await click(el, saveButton(el));
    await vi.waitFor(() => expect(modal(el)).toBeNull());
    expect(calls("POST")).toEqual([
      [
        "/management-api/venue-service/special-dates",
        {
          date: "2026-10-15",
          name: "Our party",
          colour: "green",
          closeWholeVenue: false,
          cells: [],
        },
      ],
    ]);
  });

  it("edits a date outside the page's own window with the cells the calendar read for it", async () => {
    const { api, state, calls } = server();
    const past = {
      id: "past",
      date: "2026-10-01",
      name: "Past party",
      colour: "amber" as const,
      closeWholeVenue: false,
    };
    const deliClosed = {
      subject: { kind: "department" as const, id: "deli" },
      cell: { mode: "closed" as const, periods: [] as [] },
    };
    // The page's first read starts at yesterday; the calendar's month read holds the past date.
    state.reads.push(model());
    state.model.days.push({ date: past.date, specialDate: past, holidays: [], tone: "amber" });
    state.model.specialCells.push({ specialDateId: "past", cells: [deliClosed] });
    const el = await mount(api);
    await selectTab(el, "calendar");
    await openDay(el, "2026-10-01");
    await panelAction(el, "edit");
    expect(field(el, "name")!.value).toBe("Past party");
    await click(el, saveButton(el));
    await vi.waitFor(() => expect(modal(el)).toBeNull());
    expect(calls("PUT")).toEqual([
      [
        "/management-api/venue-service/special-dates/past",
        {
          date: "2026-10-01",
          name: "Past party",
          colour: "amber",
          closeWholeVenue: false,
          cells: [deliClosed],
        },
      ],
    ]);
  });

  it("explains a repeated time when duplicating a date outside the page's own window, from the cells the calendar read for it", async () => {
    const back = clockChangeAfter("Europe/Madrid", "2026-10-08T00:00:00Z", "backward");
    const twice = minutesAfter(back.after, 30);
    const { api, state } = server();
    const past = {
      id: "past",
      date: "2026-10-01",
      name: "Past party",
      colour: "amber" as const,
      closeWholeVenue: false,
    };
    // The page's first read starts at yesterday; the calendar's month read holds the past date.
    state.reads.push(model());
    state.model.days.push({ date: past.date, specialDate: past, holidays: [], tone: "amber" });
    state.model.specialCells.push({
      specialDateId: "past",
      cells: [
        {
          subject: { kind: "station", id: "bar" },
          cell: { mode: "periods", periods: [P("p1", twice, minutesAfter(twice, 60))] },
        },
      ],
    });
    const el = await mount(api);
    await selectTab(el, "calendar");
    await openDay(el, "2026-10-01");
    await panelAction(el, "duplicate");
    expect(modal(el)!.getAttribute("heading")).toBe("Duplicate Past party");
    await setField(el, "dates.0", back.date);
    expect(
      [...el.shadowRoot!.querySelectorAll('[data-test="duplicate-repeat-note"]')].map((note) =>
        text(note),
      ),
    ).toEqual([
      `Bar on ${formatDate(back.date)}: the clock goes back, so ${twice} happens twice. These hours apply both times.`,
    ]);
  });

  it("duplicates and deletes the date the calendar shows, returning focus to the panel", async () => {
    const { api, calls } = server();
    const el = await mount(api);
    await selectTab(el, "calendar");
    await openDay(el, "2026-10-12");
    await panelAction(el, "duplicate");
    expect(modal(el)!.getAttribute("heading")).toBe("Duplicate Fiesta Nacional");
    await click(el, el.shadowRoot!.querySelector('[data-test="cancel-editor"]'));
    await vi.waitFor(() =>
      expect(calendar(el)!.shadowRoot!.activeElement).toBe(
        calendar(el)!.shadowRoot!.querySelector('[data-test="calendar-duplicate"]'),
      ),
    );
    await panelAction(el, "delete");
    expect(text(el.shadowRoot!.querySelector('[data-test="confirm-text"]'))).toBe(
      "Delete Fiesta Nacional on Mon, 12 Oct 2026? Its hours go back to the standard week.",
    );
    await click(el, saveButton(el));
    await vi.waitFor(() => expect(modal(el)).toBeNull());
    expect(calls("DELETE")).toEqual([
      ["/management-api/venue-service/special-dates/fiesta", undefined],
    ]);
  });

  it.each([
    ["without live updates", () => undefined],
    ["with live updates that deliver nothing", () => new LiveData()],
  ])(
    "shows a date added in the list on a calendar the address brought back beneath the editor, %s",
    async (_, liveData) => {
      history.replaceState(null, "", "/manage/hours/view/calendar");
      const { api, state } = server(liveData());
      const el = await mount(api);
      await selectTab(el, "dates");
      await click(el, el.shadowRoot!.querySelector('[data-test="add-date"]'));
      await setField(el, "date", "2026-10-21");
      await setField(el, "name", "Market day");
      await choose(el, "colour", "blue");
      // The browser's Back button while the editor is open.
      history.replaceState(null, "", "/manage/hours/view/calendar");
      dispatchEvent(new PopStateEvent("popstate"));
      await settle(el);
      expect(text(day(el, "2026-10-21"))).toBe("21");
      expect(modal(el)).not.toBeNull();
      const market = {
        id: "market",
        date: "2026-10-21",
        name: "Market day",
        colour: "blue" as const,
        closeWholeVenue: false,
      };
      state.writes.push(market);
      state.model.specialDates.push(market);
      state.model.days.push({ date: market.date, specialDate: market, holidays: [], tone: "blue" });
      state.model.specialCells.push({ specialDateId: "market", cells: [] });
      await click(el, saveButton(el));
      await vi.waitFor(() => expect(modal(el)).toBeNull());
      await settle(el);
      expect(text(day(el, "2026-10-21"))).toBe("21 Market day");
    },
  );

  it.each([
    ["without live updates", () => undefined],
    ["with live updates that deliver nothing", () => new LiveData()],
  ])(
    "returns focus to the date in the grid once a date deleted from the calendar is gone, %s",
    async (_, liveData) => {
      const { api, state } = server(liveData());
      const el = await mount(api);
      await selectTab(el, "calendar");
      await openDay(el, "2026-10-12");
      await panelAction(el, "delete");
      const gone = model();
      gone.specialDates = [STAFF];
      gone.days = gone.days.filter((entry) => entry.date !== "2026-10-12");
      gone.specialCells = [];
      state.model = gone;
      await click(el, saveButton(el));
      await vi.waitFor(() => expect(modal(el)).toBeNull());
      await settle(el);
      expect(text(day(el, "2026-10-12"))).toBe("12");
      expect(calendar(el)!.shadowRoot!.activeElement).toBe(day(el, "2026-10-12"));
    },
  );

  it("returns focus to the date in the grid when live updates remove the date before the delete answers", async () => {
    const liveData = new LiveData();
    const { api, state } = server(liveData);
    const el = await mount(api);
    await selectTab(el, "calendar");
    await openDay(el, "2026-10-12");
    await panelAction(el, "delete");
    const late = deferred();
    state.writes.push(late.promise);
    await click(el, saveButton(el));
    const gone = model();
    gone.specialDates = [STAFF];
    gone.days = gone.days.filter((entry) => entry.date !== "2026-10-12");
    gone.specialCells = [];
    state.model = gone;
    liveData.invalidate([{ type: "special_dates" }]);
    await vi.waitFor(() => expect(text(day(el, "2026-10-12"))).toBe("12"));
    expect(modal(el)).not.toBeNull();
    late.resolve(undefined);
    await vi.waitFor(() => expect(modal(el)).toBeNull());
    await settle(el);
    expect(calendar(el)!.shadowRoot!.activeElement).toBe(day(el, "2026-10-12"));
  });

  it("shows a save on the page and the calendar when the live stream is open but delivers nothing", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const liveData = new LiveData();
    const stream = Object.assign(new EventTarget(), { readyState: 1, close: () => {} });
    const connection = new LiveConnection(liveData, { open: () => stream });
    connection.start();
    try {
      const { api, state, calls } = server(liveData);
      const el = await mount(api);
      await selectTab(el, "calendar");
      await openDay(el, "2026-10-12");
      await panelAction(el, "edit");
      await setField(el, "name", "Fiesta renamed");
      state.model = renamed("Fiesta renamed");
      const before = calls("GET").length;
      await click(el, saveButton(el));
      await vi.waitFor(() => expect(modal(el)).toBeNull());
      await vi.waitFor(() => expect(text(day(el, "2026-10-12"))).toBe("12 Fiesta renamed"));
      await settle(el);
      const reads = calls("GET")
        .slice(before)
        .map(([path]) => path);
      expect(reads).toHaveLength(2);
      expect(reads).toContain("/management-api/venue-service/hours?from=2026-09-28&to=2026-11-01");
      await selectTab(el, "dates");
      await listTable(el).updateComplete;
      expect(listRows(el)[0]!.slice(0, 2)).toEqual(["Mon, 12 Oct 2026", "Fiesta renamed Red"]);
    } finally {
      connection.stop();
      vi.useRealTimers();
    }
  });

  it("reads a save at most twice for each open view when live updates also announce it", async () => {
    const liveData = new LiveData();
    const stream = Object.assign(new EventTarget(), { readyState: 1, close: () => {} });
    const connection = new LiveConnection(liveData, { open: () => stream });
    connection.start();
    try {
      const { api, state, calls } = server(liveData);
      const el = await mount(api);
      await selectTab(el, "calendar");
      await openDay(el, "2026-10-12");
      await panelAction(el, "edit");
      await setField(el, "name", "Fiesta renamed");
      state.model = renamed("Fiesta renamed");
      const before = calls("GET").length;
      await click(el, saveButton(el));
      await vi.waitFor(() => expect(modal(el)).toBeNull());
      // What the server's change feed sends once the save has committed.
      stream.dispatchEvent(
        new MessageEvent("change", {
          data: JSON.stringify([{ type: "special_dates" }, { type: "special_date_hours" }]),
        }),
      );
      await vi.waitFor(() => expect(text(day(el, "2026-10-12"))).toBe("12 Fiesta renamed"));
      await settle(el);
      const reads = calls("GET")
        .slice(before)
        .map(([path]) => path);
      // One read each after the save, and one more each for the change event, which the shared
      // cache cannot tell apart from a later write by someone else.
      expect(reads).toHaveLength(4);
      const month = "/management-api/venue-service/hours?from=2026-09-28&to=2026-11-01";
      expect(reads.filter((path) => path === month)).toHaveLength(2);
      expect(new Set(reads).size).toBe(2);
    } finally {
      connection.stop();
    }
  });

  it("says a failed live read after a save as a read failure, with the editor closed", async () => {
    const liveData = new LiveData();
    const { api, state } = server(liveData);
    const el = await mount(api);
    await click(el, cellButton(el, bar, 2));
    await click(el, saveButton(el));
    expect(modal(el)).toBeNull();
    state.reads.push({ reject: { code: "connection.failed" } });
    liveData.invalidate([{ type: "hours_week_cells" }]);
    await vi.waitFor(() =>
      expect(text(el.shadowRoot!.querySelector('[data-test="page-alert"]'))).toBe(
        "Hours could not be loaded.",
      ),
    );
    expect(modal(el)).toBeNull();
  });

  it("keeps its view while the address moves to another screen", async () => {
    history.replaceState(null, "", "/manage/hours/view/calendar");
    const { api } = server();
    const el = await mount(api);
    history.pushState(null, "", "/manage/printers");
    dispatchEvent(new PopStateEvent("popstate"));
    await settle(el);
    expect(calendar(el)).not.toBeNull();
  });

  it("offers a read-only viewer the calendar with nothing to change", async () => {
    const { api } = server();
    const el = await mount(api, true);
    await selectTab(el, "calendar");
    expect(calendar(el)!.readOnly).toBe(true);
  });

  it("paints each special date's colour beside its name in the list", async () => {
    const { api } = server();
    const el = await mount(api);
    await selectTab(el, "dates");
    await listTable(el).updateComplete;
    const swatch = rowOf(el, "Fiesta").querySelector<HTMLElement>('[part~="colour-swatch"]')!;
    const probe = document.createElement("span");
    probe.style.color = "var(--wt-color-palette-red)";
    el.shadowRoot!.append(probe);
    expect(getComputedStyle(swatch).backgroundColor).toBe(getComputedStyle(probe).color);
    probe.remove();
  });
});

describe("Hours: public holidays", () => {
  const calendar = (el: HoursScreen) =>
    el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
      "hours-calendar",
    )!;
  const day = (el: HoursScreen, date: string) =>
    calendar(el).shadowRoot!.querySelector<HTMLButtonElement>(`td[data-date="${date}"] button`)!;
  const monthCoverage = (el: HoursScreen) =>
    [...calendar(el).shadowRoot!.querySelectorAll('[data-test="month-coverage"] li')].map(text);
  async function makeSpecial(el: HoursScreen, date: string) {
    await click(el, day(el, date));
    await click(el, calendar(el).shadowRoot!.querySelector('[data-test="calendar-make_special"]'));
  }
  /** The model as the server reads it once 15 October holds `names`, and 2026's coverage. */
  function withHolidays(
    names: string[],
    nationalRegional: "complete" | "area_required" = "complete",
  ): HoursModel {
    const next = model();
    next.days.push({
      date: "2026-10-15",
      specialDate: null,
      holidays: names.map((name, index) => ({
        id: `local:${index}`,
        date: "2026-10-15",
        name,
        scope: "local",
        sourceId: "owner:g-sevilla",
      })),
      tone: "standard",
    });
    next.holidaySources = [
      { id: "owner:g-sevilla", kind: "owner", title: "Sevilla", url: null, sha256: null },
    ];
    next.holidayCoverage = [
      {
        year: 2026,
        country: "ES",
        provinceCode: "25",
        regionCode: "09",
        nationalRegional,
        local: "owner_entered",
        dataVersion: "ES-2026.1",
        sourceIds: [],
      },
    ];
    return next;
  }

  it("puts Local holidays at the foot of the Special dates tab, read-only for a viewer", async () => {
    const { api } = server();
    const el = await mount(api);
    await selectTab(el, "dates");
    const section = el.shadowRoot!.querySelector<HTMLElement & { readOnly: boolean }>(
      "local-holidays-editor",
    )!;
    expect(section).not.toBeNull();
    const table = listTable(el);
    expect(table.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(section.readOnly).toBe(false);
    await selectTab(el, "week");
    expect(el.shadowRoot!.querySelector("local-holidays-editor")).toBeNull();

    const viewer = await mount(server().api, true);
    await selectTab(viewer, "dates");
    expect(
      viewer.shadowRoot!.querySelector<HTMLElement & { readOnly: boolean }>(
        "local-holidays-editor",
      )!.readOnly,
    ).toBe(true);
  });

  it("names a date made special after its holidays, and follows another client's rename until the name is edited", async () => {
    const liveData = new LiveData();
    const { api, state } = server(liveData);
    state.model = withHolidays(["Feria", "Fiesta común"]);
    const el = await mount(api);
    await selectTab(el, "calendar");
    expect(text(day(el, "2026-10-15"))).toBe("15 Feria · Fiesta común · standard hours");
    await makeSpecial(el, "2026-10-15");
    expect(field(el, "name")!.value).toBe("Feria · Fiesta común");

    state.model = withHolidays(["Feria de otoño"]);
    liveData.invalidate([{ type: "local_holidays" }]);
    await vi.waitFor(() =>
      expect(text(day(el, "2026-10-15"))).toBe("15 Feria de otoño · standard hours"),
    );
    await settle(el);
    expect(field(el, "name")!.value).toBe("Feria de otoño");

    await setField(el, "name", "Our own name");
    state.model = withHolidays(["Feria de invierno"]);
    liveData.invalidate([{ type: "local_holidays" }]);
    await vi.waitFor(() =>
      expect(text(day(el, "2026-10-15"))).toBe("15 Feria de invierno · standard hours"),
    );
    await settle(el);
    expect(field(el, "name")!.value).toBe("Our own name");
    expect(modal(el)).not.toBeNull();
  });

  it("follows the holidays through a colour change, and stops once the name is edited, even back to the suggested text", async () => {
    const liveData = new LiveData();
    const { api, state } = server(liveData);
    state.model = withHolidays(["Feria"]);
    const el = await mount(api);
    await selectTab(el, "calendar");
    await makeSpecial(el, "2026-10-15");
    expect(field(el, "name")!.value).toBe("Feria");
    await choose(el, "colour", "amber");
    state.model = withHolidays(["Feria de otoño"]);
    liveData.invalidate([{ type: "local_holidays" }]);
    await vi.waitFor(() =>
      expect(text(day(el, "2026-10-15"))).toBe("15 Feria de otoño · standard hours"),
    );
    await settle(el);
    expect(field(el, "name")!.value).toBe("Feria de otoño");

    await setField(el, "name", "My choice");
    await setField(el, "name", "Feria de otoño");
    state.model = withHolidays(["Feria de invierno"]);
    liveData.invalidate([{ type: "local_holidays" }]);
    await vi.waitFor(() =>
      expect(text(day(el, "2026-10-15"))).toBe("15 Feria de invierno · standard hours"),
    );
    await settle(el);
    expect(field(el, "name")!.value).toBe("Feria de otoño");
  });

  it("keeps a suggested name when a read covers a range without its date", async () => {
    const liveData = new LiveData();
    const { api, state } = server(liveData);
    state.model = withHolidays(["Feria"]);
    const el = await mount(api);
    await selectTab(el, "calendar");
    await makeSpecial(el, "2026-10-15");
    state.model = model();
    liveData.invalidate([{ type: "local_holidays" }]);
    await vi.waitFor(() => expect(text(day(el, "2026-10-15"))).not.toContain("Feria"));
    await settle(el);
    expect(field(el, "name")!.value).toBe("Feria");
  });

  it("turns an untouched suggested name into the date when a read lists the date with no holidays", async () => {
    const liveData = new LiveData();
    const { api, state } = server(liveData);
    state.model = withHolidays(["Feria"]);
    const el = await mount(api);
    await selectTab(el, "calendar");
    await makeSpecial(el, "2026-10-15");
    state.model = withHolidays([]);
    liveData.invalidate([{ type: "local_holidays" }]);
    await vi.waitFor(() => expect(text(day(el, "2026-10-15"))).not.toContain("Feria"));
    await settle(el);
    expect(field(el, "name")!.value).toBe("2026-10-15");
  });

  it("drops the holiday name's link to its date once the draft's date changes, so a later read cannot rename it", async () => {
    const liveData = new LiveData();
    const { api, state } = server(liveData);
    state.model = withHolidays(["Feria"]);
    const el = await mount(api);
    await selectTab(el, "calendar");
    await makeSpecial(el, "2026-10-15");
    expect(field(el, "name")!.value).toBe("Feria");
    await setField(el, "date", "2026-10-16");
    state.model = withHolidays(["Feria de otoño"]);
    liveData.invalidate([{ type: "local_holidays" }]);
    await vi.waitFor(() =>
      expect(text(day(el, "2026-10-15"))).toBe("15 Feria de otoño · standard hours"),
    );
    await settle(el);
    expect(field(el, "name")!.value).toBe("Feria");
    expect(field(el, "date")!.value).toBe("2026-10-16");
  });

  it("opening Make this a special date creates nothing until saved", async () => {
    const { api, calls } = server();
    const el = await mount(api);
    await selectTab(el, "calendar");
    await makeSpecial(el, "2026-10-15");
    await click(el, el.shadowRoot!.querySelector('[data-test="cancel-editor"]'));
    expect(requestWrites(calls)).toEqual([]);
  });

  it("follows another client's area choice into the calendar's coverage", async () => {
    const liveData = new LiveData();
    const { api, state } = server(liveData);
    state.model = withHolidays([], "area_required");
    const el = await mount(api);
    await selectTab(el, "calendar");
    expect(monthCoverage(el)).toEqual([
      "2026: only official holidays for the whole province are shown until the holiday area is chosen under Special dates.",
    ]);
    state.model = withHolidays([]);
    liveData.invalidate([{ type: "holiday_geographies" }]);
    await vi.waitFor(() => expect(monthCoverage(el)).toEqual([]));
  });

  it("follows another client's address change into the local section, reading passively and posting nothing", async () => {
    const liveData = new LiveData();
    const { api, state, request } = server(liveData);
    const el = await mount(api);
    await selectTab(el, "dates");
    const section = () => el.shadowRoot!.querySelector("local-holidays-editor")!;
    await vi.waitFor(() =>
      expect(text(section().shadowRoot!.querySelector('[data-test="local-allowance"]'))).toBe(
        "2026: 1 of 2 local holidays entered.",
      ),
    );
    state.local = {
      ...localModel(),
      venue: { country: "ES", provinceCode: "41", city: "Utrera" },
      geographies: [{ ...localModel().geographies[0]!, matchesVenue: false }],
      entries: [],
    };
    liveData.invalidate([{ type: "locations" }]);
    await vi.waitFor(() =>
      expect(text(section().shadowRoot!.querySelector('[data-test="retained"]'))).toBe(
        "These local holidays were for Sevilla. Remove",
      ),
    );
    expect(request.mock.calls.every(([, method]) => method === "GET")).toBe(true);
    expect(request.mock.calls.every((call) => call[3]?.passive === true)).toBe(true);

    const reads = request.mock.calls.length;
    el.remove();
    liveData.invalidate([{ type: "local_holidays" }, { type: "locations" }]);
    liveData.refresh();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(request.mock.calls.length).toBe(reads);
  });
});

function requestWrites(calls: (method: string) => unknown[][]) {
  return [...calls("POST"), ...calls("PUT"), ...calls("DELETE")];
}
