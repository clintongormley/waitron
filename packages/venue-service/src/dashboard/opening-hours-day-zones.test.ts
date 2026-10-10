import { withOpeningStations } from "../testing/opening-hours-stations-request.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applyTokens } from "@waitron/ui";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { OpeningHoursApi } from "./opening-hours-client.js";
import type { NamedDaysModel } from "../holiday-types.js";
import { realWeekModel, namedWeekModel } from "../testing/real-week-model.js";
import "./opening-hours-screen.js";
let screen: HTMLElementTagNameMap["dashboard-opening-hours-screen"];
const original = location.href;
beforeEach(() => {
  setLocale("en");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
  history.replaceState(null, "", "/manage/opening-hours/view/day");
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
function fixture() {
  const model = realWeekModel();
  return {
    ...model,
    namedDays: [
      ...model.namedDays,
      { ...model.namedDays[0]!, id: "normal-annual", date: "2025-10-16", ownHours: false },
    ],
    departments: model.departments.map((department) => ({
      ...department,
      zones: department.zones.map((zone) => ({
        ...zone,
        week: Array.from({ length: 7 }, (_, weekday) => ({
          weekday,
          ranges: [{ startsAt: "23:00", endsAt: "06:00" }],
        })),
        dates: [{ specialDateId: "annual/day", ranges: [{ startsAt: "22:00", endsAt: "06:00" }] }],
      })),
    })),
  };
}
async function mount(
  write: (path: string, method: string, body: unknown) => Promise<unknown> = async () => {},
  model = fixture(),
  named: () => Promise<NamedDaysModel> = async () => namedWeekModel(),
) {
  screen = document.createElement("dashboard-opening-hours-screen");
  screen.api = new OpeningHoursApi(
    withOpeningStations((async (path, method, body) =>
      method === "GET"
        ? path.includes("named-days?")
          ? named()
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
it("stages a closed range and saves the weekday while preserving other weekdays", async () => {
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
      "/management-api/venue-service/zones/z1/closed-week",
      "PUT",
      {
        days: [
          { weekday: 0, ranges: [{ startsAt: "23:00", endsAt: "06:00" }] },
          {
            weekday: 1,
            ranges: [
              { startsAt: "13:00", endsAt: "14:00" },
              { startsAt: "23:00", endsAt: "06:00" },
            ],
          },
          ...[2, 3, 4, 5, 6].map((weekday) => ({
            weekday,
            ranges: [{ startsAt: "23:00", endsAt: "06:00" }],
          })),
        ],
      },
    ],
  ]);
});
it("saves department and zone changes to the named occurrence and retains completed writes on a zone refusal", async () => {
  vi.setSystemTime(new Date("2026-10-13T12:00:00Z"));
  const writes: unknown[][] = [];
  let fail = true;
  const day = await mount(async (...args) => {
    writes.push(args);
    if (args[0].includes("zone-closed-times") && fail)
      throw { code: "zone_closed_time.invalid", params: { field: "ranges.0.endsAt" } };
  });
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
  expect(writes).toEqual([
    [
      "/management-api/venue-service/special-dates/annual%2Fday/menu-timetables/d1",
      "PUT",
      { slots: [{ periodId: "p1", startsAt: "12:00", endsAt: "17:00" }] },
    ],
    ...[0, 1].map(() => [
      "/management-api/venue-service/special-dates/annual%2Fday/zone-closed-times/z1",
      "PUT",
      {
        ranges: [
          { startsAt: "13:00", endsAt: "14:00" },
          { startsAt: "22:00", endsAt: "06:00" },
        ],
      },
    ]),
  ]);
});
it("shows Closed and refuses all grid actions on a whole-venue closure", async () => {
  vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
  const writes: unknown[][] = [];
  const day = await mount(async (...args) => {
    writes.push(args);
  });
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
it("opens the existing annual named-day editor with own hours enabled from the Day heading", async () => {
  vi.setSystemTime(new Date("2026-10-16T12:00:00Z"));
  const day = await mount();
  const own =
    day.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=own-date]")!;
  expect(own).not.toBeNull();
  await expect.poll(() => own.disabled).toBe(false);
  own.click();
  await expect.poll(() => screen.shadowRoot!.querySelector("named-day-editor")).not.toBeNull();
  const editor = screen.shadowRoot!.querySelector("named-day-editor")!;
  await editor.updateComplete;
  expect(editor.day?.id).toBe("normal-annual");
  expect(editor.ownHours).toBe(true);
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
it("keeps a zone-only draft and its original weekday target through a changed background model and reconnect", async () => {
  const writes: unknown[][] = [];
  const day = await mount(async (...args) => {
    writes.push(args);
  });
  editZone(day);
  await day.updateComplete;
  const parent = day.parentNode!;
  day.remove();
  day.model = {
    ...fixture(),
    namedDays: [{ ...fixture().namedDays[0]!, date: "2026-10-12", ownHours: true }],
  };
  parent.appendChild(day);
  await day.updateComplete;
  expect(grid(day).columns[1]!.closed).toEqual([
    { startsAt: "13:00", endsAt: "14:00" },
    { startsAt: "23:00", endsAt: "06:00" },
  ]);
  expect(save(day).disabled).toBe(false);
  save(day).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]![0]).toBe("/management-api/venue-service/zones/z1/closed-week");
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

it("waits for the shown date's calendar facts and prefills a public holiday's name and kind", async () => {
  let answer!: (model: NamedDaysModel) => void;
  const reads: string[] = [];
  screen = document.createElement("dashboard-opening-hours-screen");
  screen.api = new OpeningHoursApi(
    withOpeningStations((async (path, method) => {
      if (method !== "GET") return;
      if (path.includes("named-days?")) {
        reads.push(path);
        return new Promise<NamedDaysModel>((resolve) => {
          answer = resolve;
        });
      }
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
  expect(screen.shadowRoot!.querySelector("named-day-editor")).toBeNull();
  expect(reads).toEqual(["/management-api/venue-service/named-days?from=2026-10-12&to=2026-10-12"]);
  answer({
    ...namedWeekModel(),
    days: [
      {
        date: "2026-10-12",
        namedDay: null,
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
        ownHours: false,
        closed: false,
      },
    ],
  });
  await expect.poll(() => own.disabled).toBe(false);
  own.click();
  await expect.poll(() => screen.shadowRoot!.querySelector("named-day-editor")).not.toBeNull();
  const editor = screen.shadowRoot!.querySelector("named-day-editor")!;
  await editor.updateComplete;
  expect(
    editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("[name=name]")!.value,
  ).toBe("National feast");
  expect(
    editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-combobox"]>("[name=kind]")!.value,
  ).toBe("holiday");
});
it("keeps the own-hours action blocked after a failed calendar read and recovers without clearing a save refusal", async () => {
  let fail = true;
  const day = await mount(
    async () => {
      throw { code: "zone_closed_time.invalid", params: { field: "days.1.ranges" } };
    },
    fixture(),
    async () => {
      if (fail) throw new Error("offline");
      return namedWeekModel();
    },
  );
  await expect
    .poll(() => day.shadowRoot!.textContent)
    .toContain("Opening hours could not be loaded");
  const own =
    day.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=own-date]")!;
  expect(own.disabled).toBe(true);
  editZone(day);
  await day.updateComplete;
  save(day).click();
  await expect.poll(() => day.shadowRoot!.querySelector("[data-zone-error=z1]")).not.toBeNull();
  fail = false;
  screen.api.namedDays.rereadWatches();
  await expect.poll(() => own.disabled).toBe(false);
  expect(day.shadowRoot!.querySelector("[data-zone-error=z1]")).not.toBeNull();
});

it("keeps the opened department, zone and named-day facts when the same source objects change while dirty", async () => {
  vi.setSystemTime(new Date("2026-10-13T12:00:00Z"));
  const writes: unknown[][] = [];
  const day = await mount(async (...args) => {
    writes.push(args);
  });
  editZone(day);
  await day.updateComplete;
  Object.assign(day.model.departments[0]!, { zones: [], name: "Replacement" });
  Object.assign(day.model.namedDays[0]!, { ownHours: false });
  day.requestUpdate();
  await day.updateComplete;
  expect(grid(day).columns.map((column) => column.label)).toEqual(["Restaurant", "Terrace"]);
  save(day).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toEqual([
    "/management-api/venue-service/special-dates/annual%2Fday/zone-closed-times/z1",
    "PUT",
    {
      ranges: [
        { startsAt: "13:00", endsAt: "14:00" },
        { startsAt: "22:00", endsAt: "06:00" },
      ],
    },
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
it("commits a successful zone before a later zone refusal and retries only the remaining zone", async () => {
  const writes: string[] = [];
  let fail = true;
  const day = await mount(async (path) => {
    writes.push(path);
    if (path.includes("z2") && fail)
      throw { code: "zone_closed_time.invalid", params: { field: "days.1.ranges.0" } };
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
  expect(save(day).variant).toBe("primary");
  fail = false;
  save(day).click();
  await expect.poll(() => save(day).variant).toBe("secondary");
  expect(writes).toEqual([
    "/management-api/venue-service/zones/z1/closed-week",
    "/management-api/venue-service/zones/z2/closed-week",
    "/management-api/venue-service/zones/z2/closed-week",
  ]);
});
it.each(["success", "refusal"])(
  "ignores a zone save's late %s after reconnect and does not continue with the next zone",
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
    else refuse({ code: "zone_closed_time.invalid", params: { field: "days.1.ranges" } });
    await expect.poll(() => save(day).disabled).toBe(false);
    expect(save(day).variant).toBe("primary");
    expect(writes).toEqual(["/management-api/venue-service/zones/z1/closed-week"]);
    expect(day.shadowRoot!.querySelector("[data-zone-error]")).toBeNull();
    expect(grid(day).columns[1]!.closed).toEqual([
      { startsAt: "13:00", endsAt: "14:00" },
      { startsAt: "23:00", endsAt: "06:00" },
    ]);
  },
);
