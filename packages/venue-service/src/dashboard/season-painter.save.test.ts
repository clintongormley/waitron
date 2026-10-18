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
  readNumbers,
  settle,
  slot,
  withBar,
  withDays,
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
/** The painter model with Restaurant open on Thursday 06:00–12:00, so Terrace may close then. */
const thursdayOpen = () => withDays(withBar(), "d1", { 4: [slot("p1", "06:00", "12:00")] });
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
  const { painter, writes, reread } = await mount(thursdayOpen());
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
              { weekday: 4, slots: [{ periodId: "p1", startsAt: "06:00", endsAt: "12:00" }] },
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

it("shrinking Restaurant's Tuesday cuts Terrace's Tuesday in the same Save", async () => {
  const { painter, writes } = await mount(
    withDays(withBar(), "d1", { 2: [slot("p1", "13:00", "18:00")] }),
  );
  button(painter, "paint-closed").click();
  await settle(painter);
  const changed = vi.spyOn((painter as unknown as { scope: { changed(): void } }).scope, "changed");
  await drag(painter, "2", 10 * 60, 12 * 60);
  expect(changed).toHaveBeenCalledTimes(1);
  await save(painter, writes);
  expect(writes.map(({ body }) => body)).toEqual([
    {
      departments: [
        {
          departmentId: "d1",
          days: [
            { weekday: 1, slots: [{ periodId: "p1", startsAt: "13:00", endsAt: "16:00" }] },
            { weekday: 2, slots: [{ periodId: "p1", startsAt: "13:00", endsAt: "16:00" }] },
            empty(3),
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
            { weekday: 2, ranges: [{ startsAt: "15:00", endsAt: "16:00" }] },
            open(3),
            open(4),
            open(5),
            open(6),
            open(0),
          ],
        },
      ],
      expectedClockRevision: 4,
    },
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

it("a refresh that stores what the draft painted leaves it clean on the model's clock revision", async () => {
  const { painter, writes } = await mount();
  await drag(painter, "3", 7 * 60, 9 * 60);
  const painted = grid(painter).days.get("3")!;
  expect(painted).not.toEqual([]);
  const next = withBar();
  (next.departments[0]!.seasonWeeks[1]!.week[3]!.slots as unknown[]).push(...painted);
  painter.model = { ...next, clockRevision: 11 };
  await settle(painter);
  expect(frame(painter).dirty).toBe(false);
  await drag(painter, "4", 7 * 60, 9 * 60);
  await save(painter, writes);
  expect((writes[0]!.body as { expectedClockRevision: number }).expectedClockRevision).toBe(11);
});

it("a refusal naming no field shows beside Save only, keeps the draft, and a retry saves", async () => {
  const { painter, writes, reread } = await mount(thursdayOpen(), [
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
  const message = "Change the end offset of Drinks to fit these times.";
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

it("an end-offset refusal naming no period of the department keeps the unnamed wording", async () => {
  const { painter, writes } = await mount(withBar(), [
    {
      code: "menu_timetable.invalid",
      params: { field: "departments.0.days.2.slots", reason: "end_offset", periodId: "gone" },
    },
  ]);
  await pick(painter, "d3");
  await drag(painter, "3", 7 * 60, 9 * 60);
  await save(painter, writes);
  expect(frame(painter).refusal).toBe(
    "Bar, Wednesday: Change this period’s end offset to fit these time ranges.",
  );
});

it("a zone refusal on a day shows that zone and marks its heading; the next save clears it", async () => {
  const { painter, writes } = await mount(thursdayOpen(), [
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

it("an outside_hours refusal shows the zone, marks the day and says why", async () => {
  const { painter, writes } = await mount(thursdayOpen(), [
    {
      code: "zone_closed_time.invalid",
      params: { field: "zones.0.days.3.ranges.0", reason: "outside_hours" },
    },
  ]);
  await pick(painter, "zone:z2");
  await drag(painter, "4", 0, 3 * 60);
  await pick(painter, "d1");
  await save(painter, writes);
  const message = "A zone can only close while its department is open.";
  expect(
    painter.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=department]")!
      .value,
  ).toBe("zone:z2");
  expect([...grid(painter).columnErrors]).toEqual([["4", message]]);
  expect(frame(painter).refusal).toBe(`Terrace, Thursday: ${message}`);
});

it("over a standing Save refusal, a zone stroke cut to nothing says why beside Save", async () => {
  const { painter, writes } = await mount(thursdayOpen(), [{ code: "hours.clock_changed" }]);
  await pick(painter, "zone:z2");
  await drag(painter, "4", 0, 3 * 60);
  await save(painter, writes);
  expect(frame(painter).refusal).toBe("The business-day start changed. Reload hours.");
  await drag(painter, "3", 0, 3 * 60);
  expect(grid(painter).days.get("3")).toEqual([]);
  expect(frame(painter).refusal).toBe("A zone can only close while its department is open.");
});

it("a Save refusal replaces a removal notice, and a save clears one", async () => {
  const { painter, writes } = await mount(thursdayOpen(), [{ code: "hours.clock_changed" }]);
  await paintRestaurantAndTerrace(painter);
  await pick(painter, "d1");
  const next = thursdayOpen();
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
  const { painter } = await mount(thursdayOpen());
  await pick(painter, "zone:z2");
  await drag(painter, "4", 0, 3 * 60);
  await pick(painter, "d1");
  await drag(painter, "3", 7 * 60, 9 * 60);
  const next = thursdayOpen();
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
  expect(frame(painter).heading).toBe("Spring: standard week");
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

it("a save sends season-week-saved, clean unless painted during the save", async () => {
  let succeed!: () => void;
  const late = new Promise<void>((resolve) => {
    succeed = resolve;
  });
  const { painter, writes } = await mount(withBar(), [late]);
  const saved: { clean: boolean }[] = [];
  const seen = { bubbles: false, composed: false };
  painter.addEventListener("season-week-saved", (event) => {
    seen.bubbles = event.bubbles;
    seen.composed = event.composed;
    saved.push((event as CustomEvent<{ clean: boolean }>).detail);
  });
  await drag(painter, "3", 7 * 60, 9 * 60);
  saveButton(painter).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(saved).toEqual([]);
  await drag(painter, "4", 7 * 60, 9 * 60);
  succeed();
  await expect.poll(() => saved).toEqual([{ clean: false }]);
  expect(seen).toEqual({ bubbles: true, composed: true });
  await expect.poll(() => frame(painter).busy).toBe(false);
  await save(painter, writes);
  expect(saved).toEqual([{ clean: false }, { clean: true }]);
});

it("a refused save sends no season-week-saved", async () => {
  const { painter, writes } = await mount(withBar(), [
    { code: "season.not_found", params: { seasonId: "winter" } },
  ]);
  const saved: unknown[] = [];
  painter.addEventListener("season-week-saved", (event) => saved.push(event));
  await drag(painter, "3", 7 * 60, 9 * 60);
  await save(painter, writes);
  expect(saved).toEqual([]);
});

it("Save writes the season being painted, not the venue's current season", async () => {
  const { painter, writes, navigations } = await mount();
  button(painter, "next-season").click();
  await expect.poll(() => frame(painter).heading).toBe("Spring: standard week");
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

/** Presses on `key`'s column at `minute` and answers a release at another minute, measured
 *  against the column as it stood when pressed. */
function hold(el: SeasonPainter, key: string, minute: number) {
  const day = grid(el).shadowRoot!.querySelector<HTMLElement>(`.day[data-column="${key}"]`)!;
  const box = day.getBoundingClientRect();
  const point = (type: string, at: number) =>
    (type === "pointerdown" ? day : window).dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        composed: true,
        pointerId: 7,
        button: 0,
        clientX: box.left + box.width / 2,
        clientY: box.top + (at / 1440) * box.height,
      }),
    );
  point("pointerdown", minute);
  return async (at: number) => {
    point("pointerup", at);
    await settle(el);
  };
}

it.each(["season", "department", "zone"])(
  "removing the %s being painted during a held stroke cannot paint its replacement",
  async (kind) => {
    const { painter } = await mount();
    if (kind === "zone") await pick(painter, "zone:z2");
    const release = hold(painter, "3", 7 * 60);
    const next = withBar();
    painter.model =
      kind === "season"
        ? {
            ...next,
            seasons: next.seasons.filter(({ id }) => id !== "winter"),
            currentSeasonId: "spring",
          }
        : kind === "department"
          ? { ...next, departments: next.departments.filter(({ id }) => id !== "d1") }
          : {
              ...next,
              departments: next.departments.map((department) =>
                department.id === "d1"
                  ? { ...department, zones: department.zones.filter(({ id }) => id !== "z2") }
                  : department,
              ),
            };
    await settle(painter);
    if (kind === "season") expect(painter.seasonId).toBe("spring");
    await release(9 * 60);
    expect(painter.edited()).toEqual({ departments: [], zones: [] });
    expect(grid(painter).days.get("3")).toEqual([]);
  },
);

it("a refresh that keeps the department being painted keeps a held stroke", async () => {
  const { painter } = await mount();
  const release = hold(painter, "3", 7 * 60);
  const next = withBar();
  painter.model = {
    ...next,
    departments: next.departments.filter(({ id }) => id !== "d3"),
    clockRevision: 9,
  };
  await settle(painter);
  await release(9 * 60);
  expect(painter.edited()).toEqual({ departments: ["d1"], zones: [] });
  expect(grid(painter).days.get("3")).toEqual([
    { periodId: "p1", startsAt: "13:00", endsAt: "15:00" },
  ]);
});

const withoutTerrace = (model = thursdayOpen()): OpeningHoursModel => {
  const restaurant = model.departments[0]!;
  return {
    ...model,
    departments: [
      { ...restaurant, zones: restaurant.zones.filter(({ id }) => id !== "z2") },
      ...model.departments.slice(1),
    ],
  };
};
const withoutBar = (model = thursdayOpen()): OpeningHoursModel => ({
  ...model,
  departments: model.departments.filter(({ id }) => id !== "d3"),
});

it.each([
  {
    gone: "Terrace",
    edit: async (el: SeasonPainter) => {
      await pick(el, "zone:z2");
      await drag(el, "4", 0, 3 * 60);
    },
    refresh: withoutTerrace,
    refusal: { code: "zone_closed_time.invalid", params: { field: "zones.0.days.3" } },
    reason: "These closed times overlap or are not in 15-minute steps.",
  },
  {
    gone: "Bar",
    edit: async (el: SeasonPainter) => {
      await pick(el, "d3");
      await drag(el, "3", 7 * 60, 9 * 60);
    },
    refresh: withoutBar,
    refusal: { code: "menu_timetable.invalid", params: { field: "departments.0.days.2" } },
    reason: "Check this day's time ranges and periods.",
  },
])(
  "a refusal naming $gone, removed while the save was in flight, shows beside Save and leaves the painter on Restaurant",
  async ({ gone, edit, refresh, refusal, reason }) => {
    let refuse!: (error: unknown) => void;
    const late = new Promise((_, reject) => (refuse = reject));
    const { painter, writes, navigations } = await mount(thursdayOpen(), [late]);
    await edit(painter);
    await pick(painter, "d1");
    navigations.length = 0;
    saveButton(painter).click();
    await expect.poll(() => writes.length).toBe(1);
    painter.model = refresh();
    await settle(painter);
    expect(frame(painter).refusal).toBe(`${gone} was removed; its changes were dropped.`);
    refuse(refusal);
    await late.catch(() => undefined);
    await expect.poll(() => frame(painter).busy).toBe(false);
    await settle(painter);
    expect(frame(painter).refusal).toContain(reason);
    expect(navigations).toEqual([]);
    expect(grid(painter).closedErases).toBe(true);
    expect(grid(painter).days.get("1")).toEqual([
      { periodId: "p1", startsAt: "13:00", endsAt: "16:00" },
    ]);
    expect(grid(painter).columnErrors.size).toBe(0);
  },
);

it("a save that lands after its edited zone was removed leaves nothing to save", async () => {
  let succeed!: () => void;
  const late = new Promise<void>((resolve) => (succeed = resolve));
  const { painter, writes, reread } = await mount(thursdayOpen(), [late]);
  await pick(painter, "zone:z2");
  await drag(painter, "4", 0, 3 * 60);
  await pick(painter, "d1");
  saveButton(painter).click();
  await expect.poll(() => writes.length).toBe(1);
  painter.model = withoutTerrace();
  await settle(painter);
  succeed();
  await late;
  await expect.poll(() => frame(painter).busy).toBe(false);
  await settle(painter);
  expect(reread).toHaveBeenCalledTimes(1);
  expect(painter.edited()).toEqual({ departments: [], zones: [] });
  expect(frame(painter).dirty).toBe(false);
  expect(saveButton(painter).disabled).toBe(true);
  expect(frame(painter).refusal).toBe("Terrace was removed; its changes were dropped.");
});

it("a save whose later edit was dropped for a department removed meanwhile is not clean, and the notice stays", async () => {
  let succeed!: () => void;
  const late = new Promise<void>((resolve) => (succeed = resolve));
  const { painter, writes } = await mount(thursdayOpen(), [late]);
  const saved: boolean[] = [];
  painter.addEventListener("season-week-saved", (event) =>
    saved.push((event as CustomEvent<{ clean: boolean }>).detail.clean),
  );
  await drag(painter, "3", 7 * 60, 9 * 60);
  saveButton(painter).click();
  await expect.poll(() => writes.length).toBe(1);
  await pick(painter, "d3");
  await drag(painter, "4", 7 * 60, 9 * 60);
  expect(painter.edited().departments).toContain("d3");
  painter.model = withoutBar();
  await settle(painter);
  expect(frame(painter).refusal).toBe("Bar was removed; its changes were dropped.");
  succeed();
  await expect.poll(() => saved).toEqual([false]);
  await expect.poll(() => frame(painter).busy).toBe(false);
  await settle(painter);
  expect(frame(painter).refusal).toBe("Bar was removed; its changes were dropped.");
});

it("a save whose own sent edit's zone was removed meanwhile, with nothing edited since, is clean", async () => {
  let succeed!: () => void;
  const late = new Promise<void>((resolve) => (succeed = resolve));
  const { painter, writes } = await mount(thursdayOpen(), [late]);
  const saved: boolean[] = [];
  painter.addEventListener("season-week-saved", (event) =>
    saved.push((event as CustomEvent<{ clean: boolean }>).detail.clean),
  );
  await pick(painter, "zone:z2");
  await drag(painter, "4", 0, 3 * 60);
  await pick(painter, "d1");
  saveButton(painter).click();
  await expect.poll(() => writes.length).toBe(1);
  painter.model = withoutTerrace();
  await settle(painter);
  succeed();
  await expect.poll(() => saved).toEqual([true]);
});

const mondayLunch = [slot("p1", "13:00", "16:00")];
const mondayDinner = [slot("p2", "18:00", "21:00")];
const earlyWednesday = [slot("p1", "07:00", "09:00")];
const earlyThursday = [slot("p1", "07:00", "09:00")];

it("a save's weeks follow the first model read after it, keeping only paint added since it was sent", async () => {
  let succeed!: () => void;
  const late = new Promise<void>((resolve) => (succeed = resolve));
  const { painter, writes } = await mount(withBar(), [late]);
  const { after } = readNumbers(painter);
  await drag(painter, "3", 60, 180);
  saveButton(painter).click();
  await expect.poll(() => writes.length).toBe(1);
  painter.model = withDays(withBar(), "d1", { 1: mondayDinner, 3: [slot("p1", "13:00", "15:00")] });
  await settle(painter);
  succeed();
  await expect.poll(() => frame(painter).busy).toBe(false);
  await settle(painter);
  expect(frame(painter).dirty).toBe(false);
  expect(grid(painter).days.get("1")).toEqual(mondayLunch);
  expect(grid(painter).days.get("3")).toEqual(earlyWednesday);

  await drag(painter, "4", 60, 180);
  painter.model = after(withDays(withBar(), "d1", { 1: mondayDinner, 3: earlyWednesday }));
  await settle(painter);
  expect(grid(painter).days.get("1")).toEqual(mondayDinner);
  expect(grid(painter).days.get("3")).toEqual(earlyWednesday);
  expect(grid(painter).days.get("4")).toEqual(earlyThursday);
  expect(painter.edited()).toEqual({ departments: ["d1"], zones: [] });
  await save(painter, writes);
  const days = (writes[1]!.body as { departments: { days: { weekday: number }[] }[] })
    .departments[0]!.days;
  expect(days.find(({ weekday }) => weekday === 1)).toEqual({ weekday: 1, slots: mondayDinner });
});

it("a model that a watch read before the save never counts as the one after it", async () => {
  const { painter, writes, reread } = await mount();
  const { at } = readNumbers(painter);
  reread.mockReturnValue(10);
  await drag(painter, "3", 60, 180);
  await save(painter, writes);
  await drag(painter, "4", 60, 180);
  painter.model = at(withDays(withBar(), "d1", { 1: mondayDinner, 3: earlyWednesday }), 5);
  await settle(painter);
  expect(grid(painter).days.get("1")).toEqual(mondayLunch);
  expect(grid(painter).days.get("3")).toEqual(earlyWednesday);
  expect(grid(painter).days.get("4")).toEqual(earlyThursday);
  expect(painter.edited()).toEqual({ departments: ["d1"], zones: [] });
});

it("stepping to another season before the model after a save forgets that save", async () => {
  const { painter, writes } = await mount();
  const { after } = readNumbers(painter);
  await drag(painter, "3", 60, 180);
  await save(painter, writes);
  button(painter, "next-season").click();
  await settle(painter);
  painter.model = after(withDays(withBar(), "d1", { 1: [slot("p1", "12:00", "14:00")] }, "spring"));
  await settle(painter);
  expect(grid(painter).days.get("1")).toEqual([slot("p1", "12:00", "14:00")]);
  expect(frame(painter).dirty).toBe(false);
});

it("an edited week the save did not send takes the read after the save on the days it did not change", async () => {
  const { painter, writes } = await mount();
  const { after } = readNumbers(painter);
  await drag(painter, "3", 60, 180);
  await save(painter, writes);
  await pick(painter, "d3");
  await drag(painter, "1", 60, 180);
  painter.model = after(
    withDays(withDays(withBar(), "d1", { 3: earlyWednesday }), "d3", {
      2: [slot("q1", "10:00", "12:00")],
    }),
  );
  await settle(painter);
  expect(grid(painter).days.get("2")).toEqual([slot("q1", "10:00", "12:00")]);
  expect(painter.edited()).toEqual({ departments: ["d3"], zones: [] });
});

it("a model set during a second save's flight is not taken in, and the read after the second save is", async () => {
  let succeed!: () => void;
  const late = new Promise<void>((resolve) => (succeed = resolve));
  const { painter, writes, reread } = await mount(withBar(), [Promise.resolve(), late]);
  const { at, after } = readNumbers(painter);
  reread.mockReturnValueOnce(10).mockReturnValueOnce(20);
  await drag(painter, "3", 60, 180);
  await save(painter, writes);
  await drag(painter, "4", 60, 180);
  saveButton(painter).click();
  await expect.poll(() => writes.length).toBe(2);
  painter.model = at(withDays(withBar(), "d1", { 1: mondayDinner, 3: earlyWednesday }), 15);
  await settle(painter);
  expect(grid(painter).days.get("1")).toEqual(mondayLunch);

  succeed();
  await expect.poll(() => frame(painter).busy).toBe(false);
  await settle(painter);
  expect(grid(painter).days.get("1")).toEqual(mondayLunch);
  painter.model = after(
    withDays(withBar(), "d1", { 1: mondayLunch, 3: earlyWednesday, 4: earlyThursday }),
  );
  await settle(painter);
  expect(frame(painter).dirty).toBe(false);
  expect(grid(painter).days.get("1")).toEqual(mondayLunch);
  expect(grid(painter).days.get("4")).toEqual(earlyThursday);
});

it("two saves before any read after them: the read after the second takes in both saves' weeks", async () => {
  const { painter, writes } = await mount();
  const { after } = readNumbers(painter);
  await drag(painter, "3", 60, 180);
  await save(painter, writes);
  await pick(painter, "d3");
  await drag(painter, "1", 60, 180);
  await save(painter, writes);
  await pick(painter, "d1");
  await drag(painter, "5", 60, 180);
  painter.model = after(
    withDays(withDays(withBar(), "d1", { 1: mondayDinner, 3: earlyWednesday }), "d3", {
      1: [slot("q1", "07:00", "09:00")],
    }),
  );
  await settle(painter);
  expect(grid(painter).days.get("1")).toEqual(mondayDinner);
  expect(grid(painter).days.get("3")).toEqual(earlyWednesday);
  expect(grid(painter).days.get("5")).toEqual([slot("p1", "07:00", "09:00")]);
  expect(painter.edited()).toEqual({ departments: ["d1"], zones: [] });
});

it("a model that arrives while a later save is refused takes in the earlier save once the refusal lands", async () => {
  let refuse!: (error: unknown) => void;
  const late = new Promise<void>((_, reject) => (refuse = reject));
  const { painter, writes, reread } = await mount(withBar(), [Promise.resolve(), late]);
  const { after } = readNumbers(painter);
  reread.mockReturnValueOnce(10);
  await drag(painter, "3", 60, 180);
  await save(painter, writes);
  await drag(painter, "4", 60, 180);
  saveButton(painter).click();
  await expect.poll(() => writes.length).toBe(2);
  painter.model = after(withDays(withBar(), "d1", { 1: mondayDinner, 3: earlyWednesday }));
  await settle(painter);
  refuse({ code: "season.not_found", params: { seasonId: "winter" } });
  await expect.poll(() => frame(painter).busy).toBe(false);
  await settle(painter);
  expect(grid(painter).days.get("1")).toEqual(mondayDinner);
  expect(grid(painter).days.get("4")).toEqual(earlyThursday);
  expect(painter.edited()).toEqual({ departments: ["d1"], zones: [] });
});

/** Save 1 sends Restaurant; save 2 sends only Bar and is held while Restaurant follows a read
 *  made between the two saves (number 15), which has Restaurant's Monday cleared. */
async function followedDuringSecondSave() {
  let succeed!: () => void;
  const late = new Promise<void>((resolve) => (succeed = resolve));
  const { painter, writes, reread } = await mount(withBar(), [Promise.resolve(), late]);
  const { at, after } = readNumbers(painter);
  reread.mockReturnValueOnce(10).mockReturnValueOnce(20);
  await drag(painter, "3", 60, 180);
  await save(painter, writes);
  await pick(painter, "d3");
  await drag(painter, "1", 60, 180);
  saveButton(painter).click();
  await expect.poll(() => writes.length).toBe(2);
  painter.model = at(
    withDays(withDays(withBar(), "d1", { 1: [], 3: earlyWednesday }), "d3", { 1: [] }),
    15,
  );
  await settle(painter);
  await pick(painter, "d1");
  expect(grid(painter).days.get("1")).toEqual([]);
  succeed();
  await expect.poll(() => frame(painter).busy).toBe(false);
  await settle(painter);
  return { painter, after, barMonday: [slot("q1", "07:00", "09:00")] };
}

it("a week only the first of two saves sent, followed during the second, shows the read after both as stored", async () => {
  const { painter, after, barMonday } = await followedDuringSecondSave();
  expect(frame(painter).dirty).toBe(false);
  painter.model = after(
    withDays(withDays(withBar(), "d1", { 1: mondayDinner, 3: earlyWednesday }), "d3", {
      1: barMonday,
    }),
  );
  await settle(painter);
  expect(grid(painter).days.get("1")).toEqual(mondayDinner);
  expect(frame(painter).dirty).toBe(false);
});

it("a week only the first of two saves sent keeps paint added after it followed a read during the second", async () => {
  const { painter, after, barMonday } = await followedDuringSecondSave();
  await drag(painter, "1", 420, 600);
  expect(grid(painter).days.get("1")).toEqual(mondayLunch);
  expect(painter.edited()).toEqual({ departments: ["d1"], zones: [] });
  painter.model = after(
    withDays(withDays(withBar(), "d1", { 1: [], 3: earlyWednesday }), "d3", { 1: barMonday }),
  );
  await settle(painter);
  expect(grid(painter).days.get("1")).toEqual(mondayLunch);
  expect(painter.edited()).toEqual({ departments: ["d1"], zones: [] });
});

it("a week both saves sent is compared with the second save's copy when the read after them arrives", async () => {
  const { painter, writes } = await mount();
  const { after } = readNumbers(painter);
  await drag(painter, "3", 60, 180);
  await save(painter, writes);
  await drag(painter, "4", 60, 180);
  await save(painter, writes);
  const thursdayDinner = [slot("p2", "18:00", "21:00")];
  painter.model = after(withDays(withBar(), "d1", { 3: earlyWednesday, 4: thursdayDinner }));
  await settle(painter);
  expect(grid(painter).days.get("4")).toEqual(thursdayDinner);
  expect(frame(painter).dirty).toBe(false);
});

it("a save's week taken in from the read after it is clean when nothing was painted since", async () => {
  const { painter, writes } = await mount();
  const { after } = readNumbers(painter);
  await drag(painter, "3", 60, 180);
  await save(painter, writes);
  painter.model = after(withDays(withBar(), "d1", { 1: mondayDinner, 3: earlyWednesday }));
  await settle(painter);
  expect(grid(painter).days.get("1")).toEqual(mondayDinner);
  expect(frame(painter).dirty).toBe(false);
});

it("once a save is taken in, a day painted back to what it sent is kept by the next model", async () => {
  const { painter, writes } = await mount();
  const { after } = readNumbers(painter);
  await drag(painter, "3", 60, 180);
  await save(painter, writes);
  await drag(painter, "4", 60, 180);
  const shortLunch = [slot("p1", "14:00", "15:00")];
  const stored = () => withDays(withBar(), "d1", { 1: shortLunch, 3: earlyWednesday });
  painter.model = after(stored());
  await settle(painter);
  expect(grid(painter).days.get("1")).toEqual(shortLunch);
  await drag(painter, "1", 420, 600);
  expect(grid(painter).days.get("1")).toEqual(mondayLunch);
  painter.model = after(stored());
  await settle(painter);
  expect(grid(painter).days.get("1")).toEqual(mondayLunch);
  expect(grid(painter).days.get("4")).toEqual(earlyThursday);
  expect(painter.edited()).toEqual({ departments: ["d1"], zones: [] });
});

it.each([
  ["removed", "Bar was removed; its changes were dropped."],
  ["made inactive", "Bar is no longer active; its changes were dropped."],
])(
  "a saved department %s by the read after the save drops the paint added since, and says so",
  async (cause, notice) => {
    const { painter, writes } = await mount();
    const { after } = readNumbers(painter);
    await pick(painter, "d3");
    await drag(painter, "1", 60, 180);
    await save(painter, writes);
    await drag(painter, "4", 60, 180);
    const model = withBar();
    if (cause === "removed") model.departments = model.departments.filter(({ id }) => id !== "d3");
    else model.departments.find(({ id }) => id === "d3")!.active = false;
    painter.model = after(model);
    await settle(painter);
    expect(painter.edited()).toEqual({ departments: [], zones: [] });
    expect(frame(painter).dirty).toBe(false);
    expect(frame(painter).refusal).toBe(notice);
    expect(grid(painter).days.get("1")).toEqual(mondayLunch);
  },
);

it("a saved department missing from the draft when the read after the save brings it back is shown as stored", async () => {
  const { painter, writes, reread } = await mount();
  const { at } = readNumbers(painter);
  reread.mockReturnValue(10);
  await pick(painter, "d3");
  await drag(painter, "1", 60, 180);
  await save(painter, writes);
  const removed = withBar();
  removed.departments = removed.departments.filter(({ id }) => id !== "d3");
  painter.model = at(removed, 5);
  await settle(painter);
  painter.model = at(withDays(withBar(), "d3", { 1: [slot("q1", "18:00", "21:00")] }), 15);
  await settle(painter);
  await pick(painter, "d3");
  expect(grid(painter).days.get("1")).toEqual([slot("q1", "18:00", "21:00")]);
  expect(painter.edited()).toEqual({ departments: [], zones: [] });
  expect(frame(painter).dirty).toBe(false);
});

it("closing the painter before the model after a save forgets that save", async () => {
  const { painter, writes, reread } = await mount();
  const { at } = readNumbers(painter);
  reread.mockReturnValue(10);
  await drag(painter, "3", 60, 180);
  await save(painter, writes);
  frame(painter).shadowRoot!.querySelector<HTMLElement>("[data-test=dismiss]")!.click();
  await expect.poll(() => painter.open).toBe(false);
  painter.open = true;
  await settle(painter);
  await drag(painter, "4", 60, 180);
  painter.model = at(withDays(withBar(), "d1", { 1: mondayDinner, 3: earlyWednesday }), 5);
  await settle(painter);
  expect(grid(painter).days.get("1")).toEqual(mondayDinner);
  expect(grid(painter).days.get("3")).toEqual(earlyWednesday);
  expect(grid(painter).days.get("4")).toEqual(earlyThursday);
  expect(painter.edited()).toEqual({ departments: ["d1"], zones: [] });
});
