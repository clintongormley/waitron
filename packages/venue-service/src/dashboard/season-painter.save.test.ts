import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyTokens } from "@waitron/ui";
import { setLocale } from "@waitron/dashboard-kit";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import type { SeasonPainter } from "./season-painter.js";
import {
  drag,
  frame,
  grid,
  painterApi,
  painterModel,
  pick,
  settle,
  withBar,
  type Write,
} from "../testing/season-painter-fixture.js";
import "./season-painter.js";

let painter: SeasonPainter | undefined;
beforeEach(() => setLocale("en"));
afterEach(() => {
  painter?.remove();
  painter = undefined;
  setLocale("en");
});

/** `refusals` are thrown (or, when a promise, answered) in turn by the season weeks save; once they run out it succeeds. */
async function mount(model: OpeningHoursModel = withBar(), refusals: unknown[] = []) {
  const writes: Write[] = [];
  painter = document.createElement("season-painter");
  painter.api = painterApi(writes, (write) => {
    if (!write.url.endsWith("/weeks") || !refusals.length) return undefined;
    const next = refusals.shift();
    if (next instanceof Promise) return next;
    throw next;
  });
  painter.model = model;
  painter.seasonId = "winter";
  painter.departmentId = "d1";
  painter.open = true;
  applyTokens(painter);
  document.body.append(painter);
  await settle(painter);
  const reread = vi.spyOn(painter.api, "rereadWatches");
  const navigations: unknown[] = [];
  painter.addEventListener("painter-navigate", (event) =>
    navigations.push((event as CustomEvent).detail),
  );
  return { painter, writes, reread, navigations };
}
const button = (el: SeasonPainter, test: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-test="${test}"]`)!;
const saveButton = (el: SeasonPainter) =>
  frame(el).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save]")!;
async function save(el: SeasonPainter, writes: Write[]) {
  const before = writes.length;
  saveButton(el).click();
  await expect.poll(() => writes.length).toBe(before + 1);
  await expect.poll(() => frame(el).busy).toBe(false);
  await settle(el);
}
/** Restaurant's Wednesday gets Dinner 20:00–23:00; Terrace's Thursday is closed 06:00–09:00. */
async function paintRestaurantAndTerrace(el: SeasonPainter) {
  button(el, "paint-p2").click();
  await settle(el);
  await drag(el, "3", 14 * 60, 17 * 60);
  await pick(el, "zone:z2");
  await drag(el, "4", 0, 3 * 60);
}
const empty = (weekday: number) => ({ weekday, slots: [] });
const open = (weekday: number) => ({ weekday, ranges: [] });

it("saves exactly the edited department and zone in one request, then is clean and rereads", async () => {
  const { painter, writes, reread } = await mount();
  await paintRestaurantAndTerrace(painter);
  await save(painter, writes);
  expect(writes).toEqual([
    {
      url: "/management-api/venue-service/seasons/winter/weeks",
      method: "PUT",
      body: {
        departments: [
          {
            departmentId: "d1",
            days: [
              { weekday: 1, slots: [{ periodId: "p1", startsAt: "13:00", endsAt: "16:00" }] },
              empty(2),
              { weekday: 3, slots: [{ periodId: "p2", startsAt: "20:00", endsAt: "23:00" }] },
              empty(4),
              empty(5),
              empty(6),
              empty(0),
            ],
          },
        ],
        zones: [
          {
            zoneId: "z2",
            days: [
              open(1),
              { weekday: 2, ranges: [{ startsAt: "15:00", endsAt: "17:00" }] },
              open(3),
              { weekday: 4, ranges: [{ startsAt: "06:00", endsAt: "09:00" }] },
              open(5),
              open(6),
              open(0),
            ],
          },
        ],
        expectedClockRevision: 4,
      },
    },
  ]);
  expect(painter.edited()).toEqual({ departments: [], zones: [] });
  expect(frame(painter).dirty).toBe(false);
  expect(reread).toHaveBeenCalledTimes(1);
  expect(grid(painter).days.get("4")).toEqual([
    { periodId: null, startsAt: "06:00", endsAt: "09:00" },
  ]);
});

it("sends the clock revision the draft was seeded with, followed only while nothing is edited", async () => {
  const { painter, writes } = await mount();
  painter.model = { ...withBar(), clockRevision: 9 };
  await settle(painter);
  await drag(painter, "3", 7 * 60, 9 * 60);
  painter.model = { ...withBar(), clockRevision: 11 };
  await settle(painter);
  await save(painter, writes);
  expect((writes[0]!.body as { expectedClockRevision: number }).expectedClockRevision).toBe(9);
});

it("a refusal naming no field shows beside Save only, keeps the draft, and a retry saves", async () => {
  const { painter, writes, reread } = await mount(withBar(), [
    { code: "season.not_found", params: { seasonId: "winter" } },
  ]);
  await paintRestaurantAndTerrace(painter);
  await save(painter, writes);
  expect(frame(painter).refusal).toBe("This could not be saved. Try again.");
  expect(grid(painter).columnErrors.size).toBe(0);
  expect(painter.edited()).toEqual({ departments: ["d1"], zones: ["z2"] });
  expect(frame(painter).dirty).toBe(true);
  expect(saveButton(painter).disabled).toBe(false);
  expect(reread).not.toHaveBeenCalled();
  await save(painter, writes);
  expect(writes[1]!.body).toEqual(writes[0]!.body);
  expect(frame(painter).refusal).toBe("");
  expect(frame(painter).dirty).toBe(false);
  expect(reread).toHaveBeenCalledTimes(1);
});

it("the business-day start changing has its own message, and the draft stays", async () => {
  const { painter, writes } = await mount(withBar(), [{ code: "hours.clock_changed" }]);
  await drag(painter, "3", 7 * 60, 9 * 60);
  await save(painter, writes);
  expect(frame(painter).refusal).toBe("The business-day start changed. Reload hours.");
  expect(painter.edited()).toEqual({ departments: ["d1"], zones: [] });
});

it("a department refusal on a day shows that department, marks the day's heading and names it beside Save", async () => {
  const { painter, writes, navigations } = await mount(withBar(), [
    {
      code: "menu_timetable.invalid",
      params: { field: "departments.1.days.2.slots", reason: "end_offset", periodId: "q1" },
    },
  ]);
  await drag(painter, "1", 0, 60);
  await pick(painter, "d3");
  await drag(painter, "3", 7 * 60, 9 * 60);
  await pick(painter, "zone:z2");
  navigations.length = 0;
  await save(painter, writes);
  const sent = (writes[0]!.body as { departments: { departmentId: string }[] }).departments;
  expect(sent.map(({ departmentId }) => departmentId)).toEqual(["d1", "d3"]);
  const message = "Change this period’s end offset to fit these time ranges.";
  expect(button(painter, "follows")).toBeNull();
  expect(grid(painter).periods.map(({ id }) => id)).toEqual(["q1"]);
  expect([...grid(painter).columnErrors]).toEqual([["3", message]]);
  expect(frame(painter).refusal).toBe(`Bar, Wednesday: ${message}`);
  expect(navigations).toEqual([{ seasonId: "winter", departmentId: "d3", zoneId: null }]);
  expect(painter.edited()).toEqual({ departments: ["d1", "d3"], zones: [] });
  await pick(painter, "d1");
  expect(grid(painter).columnErrors.size).toBe(0);
  await pick(painter, "d3");
  expect(grid(painter).columnErrors.size).toBe(1);
  await drag(painter, "3", 10 * 60, 11 * 60);
  expect(grid(painter).columnErrors.size).toBe(0);
  expect(frame(painter).refusal).toBe("");
});

it("a zone refusal on a day shows that zone and marks its heading; the next save clears it", async () => {
  const { painter, writes } = await mount(withBar(), [
    {
      code: "zone_closed_time.invalid",
      params: { field: "zones.0.days.4.ranges" },
    },
  ]);
  await paintRestaurantAndTerrace(painter);
  await pick(painter, "d1");
  await save(painter, writes);
  const message = "These closed times overlap or are not in 15-minute steps.";
  expect(grid(painter).closedErases).toBe(false);
  expect(grid(painter).days.get("4")).toEqual([
    { periodId: null, startsAt: "06:00", endsAt: "09:00" },
  ]);
  expect([...grid(painter).columnErrors]).toEqual([["5", message]]);
  expect(frame(painter).refusal).toBe(`Terrace, Friday: ${message}`);
  await save(painter, writes);
  expect(grid(painter).columnErrors.size).toBe(0);
  expect(frame(painter).refusal).toBe("");
  expect(frame(painter).dirty).toBe(false);
});

it("a Save refusal replaces a removal notice, and a save clears one", async () => {
  const { painter, writes } = await mount(withBar(), [{ code: "hours.clock_changed" }]);
  await paintRestaurantAndTerrace(painter);
  await pick(painter, "d1");
  const next = withBar();
  const restaurant = next.departments[0]!;
  const withoutTerrace = {
    ...next,
    departments: [
      { ...restaurant, zones: restaurant.zones.filter(({ id }) => id !== "z2") },
      ...next.departments.slice(1),
    ],
  };
  painter.model = withoutTerrace;
  await settle(painter);
  expect(frame(painter).refusal).toBe("Terrace was removed; its changes were dropped.");
  await save(painter, writes);
  expect(frame(painter).refusal).toBe("The business-day start changed. Reload hours.");
  await save(painter, writes);
  expect(frame(painter).refusal).toBe("");
});

it("a removal notice clears when the picker changes", async () => {
  const { painter } = await mount();
  await pick(painter, "zone:z2");
  await drag(painter, "4", 0, 3 * 60);
  await pick(painter, "d1");
  await drag(painter, "3", 7 * 60, 9 * 60);
  const next = withBar();
  const restaurant = next.departments[0]!;
  painter.model = {
    ...next,
    departments: [
      { ...restaurant, zones: restaurant.zones.filter(({ id }) => id !== "z2") },
      ...next.departments.slice(1),
    ],
  };
  await settle(painter);
  expect(frame(painter).refusal).not.toBe("");
  await pick(painter, "d3");
  expect(frame(painter).refusal).toBe("");
});

it("a removal notice clears when the painter closes", async () => {
  const { painter } = await mount();
  await drag(painter, "3", 7 * 60, 9 * 60);
  painter.model = {
    ...withBar(),
    seasons: withBar().seasons.filter(({ id }) => id !== "winter"),
    currentSeasonId: "spring",
  };
  await settle(painter);
  expect(frame(painter).refusal).toBe("Winter was removed; its changes were dropped.");
  frame(painter).shadowRoot!.querySelector<HTMLElement>("[data-test=dismiss]")!.click();
  await expect.poll(() => painter.open).toBe(false);
  painter.open = true;
  await settle(painter);
  expect(frame(painter).refusal).toBe("");
});

it("an edited department made inactive is told as no longer active, and the painter says what it shows now", async () => {
  const { painter, navigations } = await mount();
  await pick(painter, "d3");
  await drag(painter, "3", 7 * 60, 9 * 60);
  navigations.length = 0;
  const next = withBar();
  painter.model = {
    ...next,
    departments: next.departments.map((department) =>
      department.id === "d3" ? { ...department, active: false } : department,
    ),
  };
  await settle(painter);
  expect(frame(painter).refusal).toBe("Bar is no longer active; its changes were dropped.");
  expect(navigations).toEqual([{ seasonId: "winter", departmentId: "d1", zoneId: null }]);
});

it("a removed zone being shown moves the painter to its department and says so", async () => {
  const { painter, navigations } = await mount(painterModel());
  await pick(painter, "zone:z2");
  navigations.length = 0;
  const next = painterModel();
  const restaurant = next.departments[0]!;
  painter.model = {
    ...next,
    departments: [
      { ...restaurant, zones: restaurant.zones.filter(({ id }) => id !== "z2") },
      ...next.departments.slice(1),
    ],
  };
  await settle(painter);
  expect(grid(painter).closedErases).toBe(true);
  expect(navigations).toEqual([{ seasonId: "winter", departmentId: "d1", zoneId: null }]);
});

it("ignores a save's late refusal once the painter has stepped to another season", async () => {
  let refuse!: (error: unknown) => void;
  const late = new Promise((_, reject) => {
    refuse = reject;
  });
  const { painter, writes, reread } = await mount(withBar(), [late]);
  await drag(painter, "3", 7 * 60, 9 * 60);
  saveButton(painter).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(frame(painter).busy).toBe(true);
  button(painter, "next-season").click();
  await settle(painter);
  expect(frame(painter).heading).toBe("Spring week");
  expect(frame(painter).busy).toBe(false);
  refuse({ code: "hours.clock_changed" });
  await late.catch(() => undefined);
  await settle(painter);
  expect(frame(painter).refusal).toBe("");
  expect(reread).not.toHaveBeenCalled();
});

it.each([
  [
    "menu_timetable.invalid",
    { field: "departments.0.days", reason: "end_offset" },
    "Restaurant: Change this period’s end offset to fit these time ranges.",
    [],
  ],
  [
    "menu_timetable.invalid",
    { field: "departments.0.days.0.slots.0.startsAt", reason: "clock_skips" },
    "Restaurant, Monday: The clock skips this time on this date.",
    [["1", "The clock skips this time on this date."]],
  ],
  [
    "menu_timetable.invalid",
    { field: "departments.0.days.6" },
    "Restaurant, Sunday: Check this day's time ranges and periods.",
    [["0", "Check this day's time ranges and periods."]],
  ],
  [
    "management.request_invalid",
    { field: "departments.0.departmentId" },
    "Restaurant: This could not be saved. Try again.",
    [],
  ],
  [
    "menu_timetable.invalid",
    { field: "departments.3.days" },
    "This could not be saved. Try again.",
    [],
  ],
  [
    "menu_timetable.invalid",
    { field: "departments.01x" },
    "This could not be saved. Try again.",
    [],
  ],
])("a %s refusal on %o reads %s", async (code, params, message, columns) => {
  const { painter, writes } = await mount(withBar(), [{ code, params }]);
  await drag(painter, "3", 7 * 60, 9 * 60);
  await save(painter, writes);
  expect(frame(painter).refusal).toBe(message);
  expect([...grid(painter).columnErrors]).toEqual(columns);
  expect(painter.edited()).toEqual({ departments: ["d1"], zones: [] });
});

it("a second Save while the first is in flight sends nothing", async () => {
  const { painter, writes } = await mount();
  await drag(painter, "3", 7 * 60, 9 * 60);
  saveButton(painter).click();
  saveButton(painter).click();
  await expect.poll(() => frame(painter).dirty).toBe(false);
  expect(writes).toHaveLength(1);
});

it("ignores a save's late success once the painter has stepped to another season", async () => {
  let succeed!: () => void;
  const late = new Promise<void>((resolve) => {
    succeed = resolve;
  });
  const { painter, writes, reread } = await mount(withBar(), [late]);
  await drag(painter, "3", 7 * 60, 9 * 60);
  saveButton(painter).click();
  await expect.poll(() => writes.length).toBe(1);
  button(painter, "next-season").click();
  await settle(painter);
  await drag(painter, "2", 7 * 60, 9 * 60);
  succeed();
  await late;
  await settle(painter);
  expect(reread).not.toHaveBeenCalled();
  expect(painter.edited()).toEqual({ departments: ["d1"], zones: [] });
});

it("several edited departments made inactive are told together", async () => {
  const model = withBar();
  const bar = model.departments[2]!;
  const { painter } = await mount({
    ...model,
    departments: [...model.departments, { ...bar, id: "d4", name: "Café" }],
  });
  for (const id of ["d3", "d4"]) {
    await pick(painter, id);
    await drag(painter, "3", 7 * 60, 9 * 60);
  }
  const next = withBar();
  painter.model = {
    ...next,
    departments: [
      ...next.departments.map((department) =>
        department.id === "d3" ? { ...department, active: false } : department,
      ),
      { ...bar, id: "d4", name: "Café", active: false },
    ],
  };
  await settle(painter);
  expect(frame(painter).refusal).toBe(
    "Bar and Café are no longer active; their changes were dropped.",
  );
});

it("a pending business-day change has its own message", async () => {
  const { painter, writes } = await mount(withBar(), [{ code: "hours.clock_change_pending" }]);
  await drag(painter, "3", 7 * 60, 9 * 60);
  await save(painter, writes);
  expect(frame(painter).refusal).toBe(
    "Cancel the pending business-day change before editing hours.",
  );
});

it("the season steps and the picker are disabled while a save is in flight", async () => {
  let succeed!: () => void;
  const late = new Promise<void>((resolve) => {
    succeed = resolve;
  });
  const { painter, writes } = await mount(withBar(), [late]);
  await drag(painter, "3", 7 * 60, 9 * 60);
  const steps = () =>
    ["previous-season", "next-season"].map(
      (test) => (button(painter, test) as HTMLElementTagNameMap["wt-button"]).disabled,
    );
  const picker = () =>
    painter.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=department]")!;
  expect(steps()).toEqual([false, false]);
  expect(picker().disabled).toBe(false);
  saveButton(painter).click();
  await expect.poll(() => writes.length).toBe(1);
  await settle(painter);
  expect(steps()).toEqual([true, true]);
  expect(picker().disabled).toBe(true);
  succeed();
  await expect.poll(() => frame(painter).busy).toBe(false);
  await settle(painter);
  expect(steps()).toEqual([false, false]);
  expect(picker().disabled).toBe(false);
});

it("after a save, the painting stays even though the last model refresh came before it", async () => {
  const { painter, writes } = await mount();
  button(painter, "paint-p2").click();
  await settle(painter);
  await drag(painter, "3", 14 * 60, 17 * 60);
  painter.model = withBar();
  await settle(painter);
  await save(painter, writes);
  expect(frame(painter).dirty).toBe(false);
  expect(grid(painter).days.get("3")).toEqual([
    { periodId: "p2", startsAt: "20:00", endsAt: "23:00" },
  ]);
});

it.each(["success", "refusal"])(
  "ignores a save's late %s once the painter was taken off the page and put back",
  async (outcome) => {
    let answer!: () => void;
    const late = new Promise<void>((resolve, reject) => {
      answer = () =>
        outcome === "success"
          ? resolve()
          : reject({
              code: "menu_timetable.invalid",
              params: { field: "departments.0.days.2" },
            });
    });
    const { painter, writes, reread } = await mount(withBar(), [late]);
    await drag(painter, "3", 7 * 60, 9 * 60);
    saveButton(painter).click();
    await expect.poll(() => writes.length).toBe(1);
    const parent = painter.parentNode!;
    painter.remove();
    parent.appendChild(painter);
    await settle(painter);
    answer();
    await late.catch(() => undefined);
    await settle(painter);
    expect(frame(painter).busy).toBe(false);
    expect(frame(painter).refusal).toBe("");
    expect(grid(painter).columnErrors.size).toBe(0);
    expect(reread).not.toHaveBeenCalled();
    expect(painter.edited()).toEqual({ departments: ["d1"], zones: [] });
    expect(frame(painter).dirty).toBe(true);
    expect(saveButton(painter).disabled).toBe(false);
  },
);

it("a save that fails to reach the server says so beside Save, and a model refresh keeps the message", async () => {
  const { painter, writes } = await mount(withBar(), [new Error("offline")]);
  await drag(painter, "3", 7 * 60, 9 * 60);
  await save(painter, writes);
  expect(frame(painter).refusal).toBe("This could not be saved. Try again.");
  expect(grid(painter).columnErrors.size).toBe(0);
  painter.model = withBar();
  await settle(painter);
  expect(frame(painter).refusal).toBe("This could not be saved. Try again.");
  expect(painter.edited()).toEqual({ departments: ["d1"], zones: [] });
});

it("a painter-save with nothing changed sends nothing", async () => {
  const { painter, writes } = await mount();
  frame(painter).dispatchEvent(new CustomEvent("painter-save", { bubbles: true, composed: true }));
  await settle(painter);
  expect(writes).toEqual([]);
  expect(frame(painter).busy).toBe(false);
});

it("a paint made while a save is in flight is kept, and is still unsaved once the save lands", async () => {
  let succeed!: () => void;
  const late = new Promise<void>((resolve) => {
    succeed = resolve;
  });
  const { painter, writes } = await mount(withBar(), [late]);
  await drag(painter, "3", 7 * 60, 9 * 60);
  saveButton(painter).click();
  await expect.poll(() => writes.length).toBe(1);
  await drag(painter, "4", 7 * 60, 9 * 60);
  succeed();
  await expect.poll(() => frame(painter).busy).toBe(false);
  await settle(painter);
  const sent = (writes[0]!.body as { departments: { days: { weekday: number }[] }[] })
    .departments[0]!.days;
  expect(sent.find(({ weekday }) => weekday === 4)).toEqual({ weekday: 4, slots: [] });
  expect(grid(painter).days.get("4")).toEqual([
    { periodId: "p1", startsAt: "13:00", endsAt: "15:00" },
  ]);
  expect(painter.edited()).toEqual({ departments: ["d1"], zones: [] });
  expect(frame(painter).dirty).toBe(true);
  await save(painter, writes);
  expect(writes).toHaveLength(2);
  expect(frame(painter).dirty).toBe(false);
});

it("Save writes the season being painted, not the venue's current season", async () => {
  const { painter, writes, navigations } = await mount();
  button(painter, "next-season").click();
  await expect.poll(() => frame(painter).heading).toBe("Spring week");
  await settle(painter);
  expect(navigations).toEqual([{ seasonId: "spring", departmentId: "d1", zoneId: null }]);
  await drag(painter, "3", 7 * 60, 9 * 60);
  await save(painter, writes);
  expect(writes.map(({ url, method }) => ({ url, method }))).toEqual([
    { url: "/management-api/venue-service/seasons/spring/weeks", method: "PUT" },
  ]);
  expect((writes[0]!.body as { departments: { days: unknown[] }[] }).departments[0]!.days).toEqual([
    { weekday: 1, slots: [{ periodId: "p2", startsAt: "20:00", endsAt: "23:00" }] },
    empty(2),
    { weekday: 3, slots: [{ periodId: "p1", startsAt: "13:00", endsAt: "15:00" }] },
    empty(4),
    empty(5),
    empty(6),
    empty(0),
  ]);
});
