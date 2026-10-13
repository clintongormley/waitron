import { withOpeningStations } from "../testing/opening-hours-stations-request.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyTokens } from "@waitron/ui";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { OpeningHoursApi } from "./opening-hours-client.js";
import type { SpecialDaysModel } from "../holiday-types.js";
import type { SpecialDayDetail } from "../special-days.js";
import { terraceWeekModel, namedWeekModel } from "../testing/hours-models.js";
import {
  PARTY_DATE,
  everyDateSpecial,
  paintDayRequest,
  type Recorded,
} from "../testing/special-day-fixture.js";
import { t } from "./strings.js";
import "./opening-hours-screen.js";
let screen: HTMLElementTagNameMap["dashboard-opening-hours-screen"];
const original = location.href;
beforeEach(() => {
  setLocale("en");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
  history.replaceState(null, "", "/manage/opening-hours/view/date");
});
afterEach(() => {
  screen?.remove();
  vi.useRealTimers();
  setLocale("en");
  history.replaceState(null, "", original);
});
function emit(target: Element, name: string, detail: unknown) {
  target.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
}
const closedEveryNight = () =>
  Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    ranges: [{ startsAt: "23:00", endsAt: "06:00" }],
  }));
function fixture() {
  const model = terraceWeekModel();
  return {
    ...model,
    departments: model.departments.map((department) => ({
      ...department,
      zones: department.zones.map((zone) => ({
        ...zone,
        seasonWeeks: [{ seasonId: "autumn", week: closedEveryNight() }],
      })),
    })),
  };
}
/** The calendar for `path`'s dates, `detail` standing on each of its dates. */
function calendarOf(detail: SpecialDayDetail, path: string): SpecialDaysModel {
  const query = new URLSearchParams(path.slice(path.indexOf("?") + 1));
  return {
    ...namedWeekModel(),
    days: detail.dates
      .filter(({ date }) => query.get("from")! <= date && date <= query.get("to")!)
      .map(({ date, closedAllDay }) => ({
        date,
        specialDay: { id: detail.id, name: detail.name },
        holidays: [],
        tone: "special_day" as const,
        closed: closedAllDay,
      })),
  };
}
const ordinary = async () => namedWeekModel();
async function mount(
  write: (path: string, method: string, body: unknown) => Promise<unknown> = async () => {},
  model = fixture(),
  named?: (path: string) => Promise<SpecialDaysModel>,
  detail?: SpecialDayDetail,
) {
  screen = document.createElement("dashboard-opening-hours-screen");
  screen.api = new OpeningHoursApi(
    withOpeningStations((async (path, method, body) =>
      method === "GET"
        ? path.includes("named-days?")
          ? (named?.(path) ?? (detail ? calendarOf(detail, path) : everyDateSpecial(path)))
          : detail && path.endsWith(`/special-days/${detail.id}`)
            ? detail
            : /\/special-days\/day-/.test(path)
              ? everyDateSpecial(path)
              : path.endsWith("/special-days")
                ? []
                : structuredClone(model)
        : write(path, method, body)) as DashboardRequest),
  );
  applyTokens(screen);
  document.body.append(screen);
  await expect.poll(() => screen.shadowRoot?.querySelector("opening-hours-day")).not.toBeNull();
  const day = screen.shadowRoot!.querySelector("opening-hours-day")!;
  await day.updateComplete;
  return day;
}
const grid = (day: HTMLElementTagNameMap["opening-hours-day"]) =>
  day.shadowRoot!.querySelector("service-grid")!;
const save = (day: HTMLElementTagNameMap["opening-hours-day"]) =>
  day.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save-day]")!;
function editZone(day: HTMLElementTagNameMap["opening-hours-day"]) {
  emit(grid(day), "grid-range-select", {
    columnKey: "zone:z1",
    startsAt: "13:00",
    endsAt: "14:00",
  });
}
it("places a narrow Terrace closed layer immediately after Restaurant, with its parent slots behind it", async () => {
  const day = await mount();
  expect(grid(day).columns.map((column) => column.label)).toEqual(["Restaurant", "Terrace"]);
  expect(grid(day).columns[1]).toMatchObject({
    key: "zone:z1",
    layer: "closed",
    narrow: true,
    editable: true,
    slots: [{ periodId: "p1", startsAt: "10:00", endsAt: "14:00" }],
    closed: [{ startsAt: "23:00", endsAt: "06:00" }],
  });
});
it("blocks previous-day navigation at today's business day even for a dispatched click", async () => {
  const day = await mount();
  const previous = day.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=previous-day]",
  )!;
  expect(previous.disabled).toBe(true);
  previous.dispatchEvent(new MouseEvent("click"));
  await day.updateComplete;
  expect(day.shadowRoot!.querySelector("[data-test=day-date]")!.textContent).toContain(
    "12 Oct 2026",
  );
});
it("stages a closed range and saves it as the date's closed zone paint", async () => {
  const writes: unknown[][] = [];
  const day = await mount(async (...args) => {
    writes.push(args);
  });
  editZone(day);
  await day.updateComplete;
  expect(writes).toEqual([]);
  expect(save(day).disabled).toBe(false);
  save(day).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes).toEqual([
    [
      "/management-api/venue-service/special-days/day-2026-10-12",
      "PUT",
      {
        name: "Special 2026-10-12",
        repeatsYearly: false,
        dates: [{ date: "2026-10-12", closedAllDay: false }],
        zonePaint: [
          {
            zoneId: "z1",
            date: "2026-10-12",
            ranges: [{ kind: "closed", startsAt: "13:00", endsAt: "14:00" }],
          },
        ],
        expectedClockRevision: 0,
      },
    ],
  ]);
});
it("saves a Terrace edit on Monday 2 Dec 2030 against Winter's closed week, not the current Autumn's", async () => {
  vi.setSystemTime(new Date("2030-12-02T12:00:00Z"));
  const winter = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    ranges: [{ startsAt: `22:0${weekday}`, endsAt: "06:00" }],
  }));
  const model = fixture();
  const writes: unknown[][] = [];
  const day = await mount(
    async (...args) => {
      writes.push(args);
    },
    {
      ...model,
      currentBusinessDay: "2030-12-02",
      seasons: [...model.seasons, { id: "winter", name: "Winter", startsOn: "12-01" }],
      departments: model.departments.map((department) => ({
        ...department,
        zones: department.zones.map((zone) => ({
          ...zone,
          seasonWeeks: [...zone.seasonWeeks, { seasonId: "winter", week: winter }],
        })),
      })),
    },
  );
  expect(grid(day).columns[1]!.closed).toEqual(winter[1]!.ranges);
  editZone(day);
  await day.updateComplete;
  save(day).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes).toEqual([
    [
      "/management-api/venue-service/special-days/day-2030-12-02",
      "PUT",
      {
        name: "Special 2030-12-02",
        repeatsYearly: false,
        dates: [{ date: "2030-12-02", closedAllDay: false }],
        zonePaint: [
          {
            zoneId: "z1",
            date: "2030-12-02",
            ranges: [{ kind: "closed", startsAt: "13:00", endsAt: "14:00" }],
          },
        ],
        expectedClockRevision: 0,
      },
    ],
  ]);
});
/** "Anniversary" on Tuesday 13 Oct 2026: Restaurant's Lunch moved to 12:00–16:00 and the Terrace
 *  closed from 22:00, where the season has Lunch 10:00–14:00 and the Terrace closed from 23:00. */
function anniversary(): SpecialDayDetail {
  return {
    id: "anniversary",
    name: "Anniversary",
    repeatsYearly: false,
    dates: [{ date: "2026-10-13", closedAllDay: false }],
    paint: [
      {
        departmentId: "d1",
        date: "2026-10-13",
        ranges: [
          { periodId: null, startsAt: "10:00", endsAt: "12:00" },
          { periodId: "p1", startsAt: "14:00", endsAt: "16:00" },
        ],
      },
    ],
    zonePaint: [
      {
        zoneId: "z1",
        date: "2026-10-13",
        ranges: [{ kind: "closed", startsAt: "22:00", endsAt: "23:00" }],
      },
    ],
  };
}
const anniversaryBody = (paint: boolean) => ({
  name: "Anniversary",
  repeatsYearly: false,
  dates: [{ date: "2026-10-13", closedAllDay: false }],
  ...(paint
    ? {
        paint: [
          {
            departmentId: "d1",
            date: "2026-10-13",
            ranges: [
              { periodId: null, startsAt: "10:00", endsAt: "12:00" },
              { periodId: "p1", startsAt: "14:00", endsAt: "17:00" },
            ],
          },
        ],
      }
    : {}),
  zonePaint: [
    {
      zoneId: "z1",
      date: "2026-10-13",
      ranges: [
        { kind: "closed", startsAt: "13:00", endsAt: "14:00" },
        { kind: "closed", startsAt: "22:00", endsAt: "23:00" },
      ],
    },
  ],
  expectedClockRevision: 0,
});
it("saves department and zone changes to the special date in one write and resends both after a zone refusal", async () => {
  vi.setSystemTime(new Date("2026-10-13T12:00:00Z"));
  const writes: unknown[][] = [];
  let fail = true;
  const day = await mount(
    async (...args) => {
      writes.push(args);
      if (fail)
        throw { code: "special_day.invalid", params: { field: "zonePaint.0.ranges.0.endsAt" } };
    },
    fixture(),
    undefined,
    anniversary(),
  );
  emit(grid(day), "grid-block-change", {
    columnKey: "d1",
    index: 0,
    startsAt: "12:00",
    endsAt: "17:00",
  });
  editZone(day);
  await day.updateComplete;
  save(day).click();
  await expect.poll(() => day.shadowRoot!.querySelector("[data-zone-error='z1']")).not.toBeNull();
  expect(grid(day).columns[1]!.closed).toEqual([
    { startsAt: "13:00", endsAt: "14:00" },
    { startsAt: "22:00", endsAt: "06:00" },
  ]);
  fail = false;
  save(day).click();
  await expect.poll(() => save(day).variant).toBe("secondary");
  expect(save(day).disabled).toBe(true);
  expect(day.shadowRoot!.querySelector("[data-zone-error]")).toBeNull();
  expect(writes).toEqual(
    [0, 1].map(() => [
      "/management-api/venue-service/special-days/anniversary",
      "PUT",
      anniversaryBody(true),
    ]),
  );
});
it("shows Closed and refuses all grid actions on a whole-venue closure", async () => {
  vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
  const writes: unknown[][] = [];
  const day = await mount(
    async (...args) => {
      writes.push(args);
    },
    fixture(),
    undefined,
    {
      id: "staff-party",
      name: "Staff party",
      repeatsYearly: false,
      dates: [{ date: "2026-10-15", closedAllDay: true }],
      paint: [],
      zonePaint: [],
    },
  );
  expect(day.shadowRoot!.textContent).toContain("Closed");
  expect(grid(day).columns.every((column) => !column.editable && column.slots.length === 0)).toBe(
    true,
  );
  editZone(day);
  emit(grid(day), "grid-range-select", { columnKey: "d1", startsAt: "13:00", endsAt: "14:00" });
  await day.updateComplete;
  expect(day.shadowRoot!.querySelector("range-dialog")).toBeNull();
  expect(save(day)).toBeNull();
  expect(day.shadowRoot!.querySelector("[data-test=own-date]")).toBeNull();
  expect(writes).toEqual([]);
});
it("opens the special-day dialog on the Day's date from the Day heading", async () => {
  vi.setSystemTime(new Date("2026-10-16T12:00:00Z"));
  const day = await mount(undefined, fixture(), ordinary);
  const own =
    day.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=own-date]")!;
  expect(own).not.toBeNull();
  await expect.poll(() => own.disabled).toBe(false);
  own.click();
  await expect.poll(() => screen.shadowRoot!.querySelector("special-day-dialog")).not.toBeNull();
  const editor = screen.shadowRoot!.querySelector("special-day-dialog")!;
  await editor.updateComplete;
  expect(editor.specialDay).toBeUndefined();
  expect(editor.date).toBe("2026-10-16");
});

it("edits and deletes only the closed block, leaving the department unchanged and undoing back to a quiet Save", async () => {
  const day = await mount();
  const parentSlots = structuredClone(grid(day).columns[0]!.slots);
  emit(grid(day), "grid-block-open", { columnKey: "zone:z1", index: 0 });
  await day.updateComplete;
  const dialog = day.shadowRoot!.querySelector("range-dialog")!;
  await dialog.updateComplete;
  expect(dialog.closedTimes).toBe(true);
  expect(dialog.shadowRoot!.querySelector("[name=periodId]")).toBeNull();
  emit(dialog, "range-save", { input: { startsAt: "22:00", endsAt: "06:00" } });
  await day.updateComplete;
  expect(grid(day).columns[1]!.closed).toEqual([{ startsAt: "22:00", endsAt: "06:00" }]);
  expect(grid(day).columns[0]!.slots).toEqual(parentSlots);
  expect(save(day).disabled).toBe(false);
  emit(grid(day), "grid-block-change", {
    columnKey: "zone:z1",
    index: 0,
    startsAt: "23:00",
    endsAt: "06:00",
  });
  await day.updateComplete;
  expect(save(day).disabled).toBe(true);
  emit(grid(day), "grid-block-open", { columnKey: "zone:z1", index: 0 });
  await day.updateComplete;
  const next = day.shadowRoot!.querySelector("range-dialog")!;
  emit(dialog, "range-delete", {});
  emit(dialog, "range-close", {});
  await day.updateComplete;
  expect(day.shadowRoot!.querySelector("range-dialog")).toBe(next);
  emit(next, "range-delete", {});
  await day.updateComplete;
  expect(grid(day).columns[1]!.closed).toEqual([]);
  expect(grid(day).columns[0]!.slots).toEqual(parentSlots);
});
it("keeps a zone-only draft and its original special day through a changed background model, calendar and reconnect", async () => {
  const writes: unknown[][] = [];
  let reads = 0;
  const other: SpecialDayDetail = {
    id: "other",
    name: "Other",
    repeatsYearly: false,
    dates: [{ date: "2026-10-12", closedAllDay: false }],
    paint: [],
    zonePaint: [],
  };
  const day = await mount(
    async (...args) => {
      writes.push(args);
    },
    fixture(),
    async (path) =>
      reads++ === 0 ? (everyDateSpecial(path) as SpecialDaysModel) : calendarOf(other, path),
    other,
  );
  editZone(day);
  await day.updateComplete;
  const parent = day.parentNode!;
  day.remove();
  day.model = fixture();
  parent.appendChild(day);
  await expect.poll(() => reads).toBe(2);
  await new Promise((done) => setTimeout(done, 20));
  await day.updateComplete;
  expect(grid(day).columns[1]!.closed).toEqual([
    { startsAt: "13:00", endsAt: "14:00" },
    { startsAt: "23:00", endsAt: "06:00" },
  ]);
  expect(save(day).disabled).toBe(false);
  save(day).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]![0]).toBe("/management-api/venue-service/special-days/day-2026-10-12");
});
it("ignores zone edits and forged Save while a range dialog or read-only screen blocks actions", async () => {
  const writes: unknown[][] = [];
  const day = await mount(async (...args) => {
    writes.push(args);
  });
  emit(grid(day), "grid-block-open", { columnKey: "zone:z1", index: 0 });
  await day.updateComplete;
  editZone(day);
  emit(grid(day), "grid-block-change", {
    columnKey: "zone:z1",
    index: 0,
    startsAt: "20:00",
    endsAt: "06:00",
  });
  save(day).dispatchEvent(new MouseEvent("click"));
  await day.updateComplete;
  expect(grid(day).columns[1]!.closed).toEqual([{ startsAt: "23:00", endsAt: "06:00" }]);
  expect(writes).toEqual([]);
  emit(day.shadowRoot!.querySelector("range-dialog")!, "range-close", {});
  day.readOnly = true;
  await day.updateComplete;
  editZone(day);
  await day.updateComplete;
  expect(grid(day).columns.every((column) => !column.editable)).toBe(true);
  expect(grid(day).columns[1]!.closed).toEqual([{ startsAt: "23:00", endsAt: "06:00" }]);
});

it("waits for the shown date's calendar facts and prefills a public holiday's name", async () => {
  let answer!: (model: SpecialDaysModel) => void;
  const reads: string[] = [];
  screen = document.createElement("dashboard-opening-hours-screen");
  screen.api = new OpeningHoursApi(
    withOpeningStations((async (path, method) => {
      if (method !== "GET") return;
      if (path.includes("named-days?")) {
        reads.push(path);
        return new Promise<SpecialDaysModel>((resolve) => {
          answer = resolve;
        });
      }
      if (path.endsWith("/special-days")) return [];
      return fixture();
    }) as DashboardRequest),
  );
  applyTokens(screen);
  document.body.append(screen);
  await expect.poll(() => screen.shadowRoot?.querySelector("opening-hours-day")).not.toBeNull();
  const day = screen.shadowRoot!.querySelector("opening-hours-day")!;
  await day.updateComplete;
  const own =
    day.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=own-date]")!;
  expect(own.disabled).toBe(true);
  own.dispatchEvent(new MouseEvent("click"));
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector("special-day-dialog")).toBeNull();
  expect(reads).toEqual(["/management-api/venue-service/named-days?from=2026-10-12&to=2026-10-12"]);
  answer({
    ...namedWeekModel(),
    days: [
      {
        date: "2026-10-12",
        specialDay: null,
        holidays: [
          {
            id: "public",
            date: "2026-10-12",
            name: "National feast",
            scope: "national",
            sourceId: "official",
          },
        ],
        tone: "public_holiday",
        closed: false,
      },
    ],
  });
  await expect.poll(() => own.disabled).toBe(false);
  own.click();
  await expect.poll(() => screen.shadowRoot!.querySelector("special-day-dialog")).not.toBeNull();
  const editor = screen.shadowRoot!.querySelector("special-day-dialog")!;
  await editor.updateComplete;
  expect(
    editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.value,
  ).toBe("National feast");
});
it("keeps the special-day action blocked after a failed calendar read and recovers", async () => {
  let fail = true;
  const day = await mount(undefined, fixture(), async () => {
    if (fail) throw new Error("offline");
    return namedWeekModel();
  });
  await expect
    .poll(() => day.shadowRoot!.textContent)
    .toContain("Opening hours could not be loaded");
  const own =
    day.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=own-date]")!;
  expect(own.disabled).toBe(true);
  fail = false;
  screen.api.specialDays.rereadWatches();
  await expect.poll(() => own.disabled).toBe(false);
});
it("keeps a save refusal through a failed calendar read and its recovery", async () => {
  let fail = false;
  const day = await mount(
    async () => {
      throw { code: "special_day.invalid", params: { field: "zonePaint.0.ranges" } };
    },
    fixture(),
    async (path) => {
      if (fail) throw new Error("offline");
      return everyDateSpecial(path) as SpecialDaysModel;
    },
  );
  editZone(day);
  await day.updateComplete;
  save(day).click();
  await expect.poll(() => day.shadowRoot!.querySelector("[data-zone-error=z1]")).not.toBeNull();
  fail = true;
  screen.api.specialDays.rereadWatches();
  await expect
    .poll(() => day.shadowRoot!.textContent)
    .toContain("Opening hours could not be loaded");
  expect(day.shadowRoot!.querySelector("[data-zone-error=z1]")).not.toBeNull();
  fail = false;
  screen.api.specialDays.rereadWatches();
  await expect
    .poll(() => day.shadowRoot!.textContent)
    .not.toContain("Opening hours could not be loaded");
  expect(day.shadowRoot!.querySelector("[data-zone-error=z1]")).not.toBeNull();
});

it("keeps the opened department, zone and special-day facts when the same source objects change while dirty", async () => {
  vi.setSystemTime(new Date("2026-10-13T12:00:00Z"));
  const writes: unknown[][] = [];
  const detail = anniversary();
  const day = await mount(
    async (...args) => {
      writes.push(args);
    },
    fixture(),
    undefined,
    detail,
  );
  editZone(day);
  await day.updateComplete;
  Object.assign(day.model.departments[0]!, { zones: [], name: "Replacement" });
  Object.assign(detail, { name: "Replacement", dates: [] });
  day.requestUpdate();
  await day.updateComplete;
  expect(grid(day).columns.map((column) => column.label)).toEqual(["Restaurant", "Terrace"]);
  save(day).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toEqual([
    "/management-api/venue-service/special-days/anniversary",
    "PUT",
    anniversaryBody(false),
  ]);
});

function twoZones() {
  const model = fixture();
  return {
    ...model,
    departments: model.departments.map((department) => ({
      ...department,
      zones: [...department.zones, { ...department.zones[0]!, id: "z2", name: "Garden" }],
    })),
  };
}
it("shows a later zone's refusal beside that zone only and resends both zones in one write", async () => {
  const writes: unknown[][] = [];
  let fail = true;
  const day = await mount(async (...args) => {
    writes.push(args);
    if (fail) throw { code: "special_day.invalid", params: { field: "zonePaint.1.ranges.0" } };
  }, twoZones());
  editZone(day);
  emit(grid(day), "grid-range-select", {
    columnKey: "zone:z2",
    startsAt: "13:00",
    endsAt: "14:00",
  });
  await day.updateComplete;
  save(day).click();
  await expect.poll(() => day.shadowRoot!.querySelector("[data-zone-error=z2]")).not.toBeNull();
  expect(day.shadowRoot!.querySelector("[data-zone-error=z1]")).toBeNull();
  expect(save(day).variant).toBe("primary");
  fail = false;
  save(day).click();
  await expect.poll(() => save(day).variant).toBe("secondary");
  expect(writes).toEqual(
    [0, 1].map(() => [
      "/management-api/venue-service/special-days/day-2026-10-12",
      "PUT",
      {
        name: "Special 2026-10-12",
        repeatsYearly: false,
        dates: [{ date: "2026-10-12", closedAllDay: false }],
        zonePaint: ["z1", "z2"].map((zoneId) => ({
          zoneId,
          date: "2026-10-12",
          ranges: [{ kind: "closed", startsAt: "13:00", endsAt: "14:00" }],
        })),
        expectedClockRevision: 0,
      },
    ]),
  );
});
it.each(["success", "refusal"])(
  "ignores a save's late %s after reconnect and keeps its draft to save again",
  async (outcome) => {
    let done!: () => void, refuse!: (error: unknown) => void;
    const writes: string[] = [];
    const day = await mount(async (path) => {
      writes.push(path);
      await new Promise<void>((resolve, reject) => {
        done = resolve;
        refuse = reject;
      });
    }, twoZones());
    editZone(day);
    emit(grid(day), "grid-range-select", {
      columnKey: "zone:z2",
      startsAt: "13:00",
      endsAt: "14:00",
    });
    await day.updateComplete;
    save(day).click();
    await expect.poll(() => done).toBeTypeOf("function");
    const parent = day.parentNode!;
    day.remove();
    await day.updateComplete;
    parent.appendChild(day);
    await day.updateComplete;
    if (outcome === "success") done();
    else refuse({ code: "special_day.invalid", params: { field: "zonePaint.0.ranges" } });
    await expect.poll(() => save(day).disabled).toBe(false);
    expect(save(day).variant).toBe("primary");
    expect(writes).toEqual(["/management-api/venue-service/special-days/day-2026-10-12"]);
    expect(day.shadowRoot!.querySelector("[data-zone-error]")).toBeNull();
    expect(grid(day).columns[1]!.closed).toEqual([
      { startsAt: "13:00", endsAt: "14:00" },
      { startsAt: "23:00", endsAt: "06:00" },
    ]);
  },
);
it("reads a zone's season weeks once per reseed, not once per weekday", async () => {
  const day = await mount();
  const model = fixture();
  let reads = 0;
  const [zone] = model.departments[0]!.zones;
  const { seasonWeeks, ...rest } = zone!;
  const counted = Object.defineProperty({ ...rest }, "seasonWeeks", {
    enumerable: true,
    get: () => {
      reads++;
      return seasonWeeks;
    },
  }) as typeof zone;
  model.departments = [{ ...model.departments[0]!, zones: [counted!] }];
  day.model = model;
  await day.updateComplete;
  expect(grid(day).columns.find((column) => column.key === "zone:z1")!.closed).toEqual([
    { startsAt: "23:00", endsAt: "06:00" },
  ]);
  expect(reads).toBeGreaterThan(0);
  expect(reads).toBeLessThan(7);
});

async function mountPaint(request: DashboardRequest) {
  vi.setSystemTime(new Date("2026-10-13T12:00:00Z"));
  screen = document.createElement("dashboard-opening-hours-screen");
  screen.api = new OpeningHoursApi(request);
  applyTokens(screen);
  document.body.append(screen);
  await expect.poll(() => screen.shadowRoot?.querySelector("opening-hours-day")).not.toBeNull();
  const day = screen.shadowRoot!.querySelector("opening-hours-day")!;
  await expect.poll(() => save(day)?.disabled).toBe(true);
  return day;
}
const shortenTerrace = (day: HTMLElementTagNameMap["opening-hours-day"]) =>
  emit(grid(day), "grid-block-change", {
    columnKey: "zone:terrace",
    index: 0,
    startsAt: "23:00",
    endsAt: "23:30",
  });

it("on a special date saves the Terrace's later closing as open zone paint and no department paint", async () => {
  const writes: Recorded[] = [];
  const day = await mountPaint(paintDayRequest(writes));
  shortenTerrace(day);
  await day.updateComplete;
  save(day).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes).toEqual([
    {
      path: "/management-api/venue-service/special-days/party",
      method: "PUT",
      body: {
        name: "Party",
        repeatsYearly: false,
        dates: [{ date: PARTY_DATE, closedAllDay: false }],
        zonePaint: [
          {
            zoneId: "terrace",
            date: PARTY_DATE,
            ranges: [{ kind: "open", startsAt: "22:00", endsAt: "23:00" }],
          },
        ],
        expectedClockRevision: 4,
      },
    },
  ]);
});

it("shows a refusal naming a zone's date beside that zone only", async () => {
  const writes: Recorded[] = [];
  const day = await mountPaint(
    paintDayRequest(writes, async () => {
      throw {
        code: "special_day.invalid",
        params: { field: "zonePaint.0.date" },
      };
    }),
  );
  shortenTerrace(day);
  await day.updateComplete;
  save(day).click();
  await expect
    .poll(() => day.shadowRoot!.querySelector("[data-zone-error=terrace]"))
    .not.toBeNull();
  expect(day.shadowRoot!.querySelector("[data-department-error]")).toBeNull();
  expect(save(day).disabled).toBe(false);
});

it.each([
  ["a date the request lacks", { field: "zonePaint.0.date" }, "opening.check_day"],
  [
    "a clock skip",
    { field: "zonePaint.0.ranges.0.endsAt", reason: "clock_skips", date: PARTY_DATE },
    "menu.time_skipped",
  ],
  [
    "overlapping ranges",
    { field: "zonePaint.0.ranges", reason: "overlap" },
    "opening.closed_invalid",
  ],
  [
    "a kept date's ranges",
    { field: "zonePaint", zoneId: "terrace", date: "2026-10-20" },
    "opening.closed_invalid",
  ],
] as const)("explains a zone refusal about %s with its own sentence", async (_, params, key) => {
  const day = await mountPaint(
    paintDayRequest([], async () => {
      throw { code: "special_day.invalid", params };
    }),
  );
  shortenTerrace(day);
  await day.updateComplete;
  save(day).click();
  await expect
    .poll(() => day.shadowRoot!.querySelector("[data-zone-error=terrace]")?.textContent)
    .toBe(t(key));
});
