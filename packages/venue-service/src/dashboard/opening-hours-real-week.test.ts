import { withOpeningStations } from "../testing/opening-hours-stations-request.js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import { OpeningHoursApi } from "./opening-hours-client.js";
import type { SpecialDaysModel } from "../holiday-types.js";
import {
  realWeekModel as fixture,
  namedWeekModel as calendarFixture,
} from "../testing/real-week-model.js";
import type { SpecialDayDetail } from "../special-days.js";
import {
  PARTY_DATE,
  paintDayModel,
  paintDayRequest,
  partyDetail,
} from "../testing/special-day-fixture.js";
import "./opening-hours-screen.js";
let screen: HTMLElementTagNameMap["dashboard-opening-hours-screen"];
const original = location.href;

function emit(target: Element, name: string, detail: unknown) {
  target.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
}
beforeEach(() => {
  setLocale("en");
  vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
  history.replaceState(null, "", "/manage/opening-hours?week=2026-10-12&keep=yes#anchor");
});
afterEach(() => {
  screen?.remove();
  vi.useRealTimers();
  setLocale("en");
  history.replaceState(null, "", original);
});

async function mount(
  write: (path: string, method: string, body: unknown) => Promise<unknown> = async () => {},
  zone = false,
  data = fixture(),
  named: () => Promise<SpecialDaysModel> = async () => calendarFixture(),
) {
  if (zone)
    history.replaceState(
      null,
      "",
      "/manage/opening-hours/view/week/department/d1/zone/z1?week=2026-10-12",
    );
  screen = document.createElement("dashboard-opening-hours-screen");
  screen.api = new OpeningHoursApi(
    withOpeningStations((async (path, method, body) =>
      method === "GET"
        ? path.includes("named-days?")
          ? named()
          : path.endsWith("/special-days")
            ? []
            : structuredClone(data)
        : write(path, method, body)) as DashboardRequest),
  );
  applyTokens(screen);
  document.body.append(screen);
  await expect
    .poll(() =>
      screen.shadowRoot?.querySelector(zone ? "opening-hours-zone-week" : "opening-hours-week"),
    )
    .not.toBeNull();
  await screen.updateComplete;
  const week = screen.shadowRoot!.querySelector(
    zone ? "opening-hours-zone-week" : "opening-hours-week",
  )!;
  await week.updateComplete;
  return week;
}
it("bounds previous at the business week and preserves query/hash when stepping", async () => {
  await mount();
  const previous = screen.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>(
    "[data-test=previous-week]",
  );
  expect(previous, "real-week previous action").not.toBeNull();
  expect(previous!.disabled).toBe(true);
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=next-week]")!.click();
  await expect.poll(() => location.search).toBe("?week=2026-10-19&keep=yes");
  expect(location.hash).toBe("#anchor");
  screen.shadowRoot!.querySelector<HTMLElement>("[data-test=previous-week]")!.click();
  await expect.poll(() => location.search).toBe("?week=2026-10-12&keep=yes");
});

it("starts a Monday before cutover in the previous business week", async () => {
  vi.setSystemTime(new Date("2026-10-12T03:00:00Z"));
  history.replaceState(null, "", "/manage/opening-hours?keep=yes");
  await mount();
  emit(screen.shadowRoot!.querySelector("[name=realWeek]")!, "wt-change", { checked: true });
  await expect.poll(() => location.search).toBe("?keep=yes&week=2026-10-05");
});
it.each(["2026-10-06", "bad", "2026-02-30"])(
  "removes invalid week %s without losing unrelated query",
  async (value) => {
    history.replaceState(null, "", `/manage/opening-hours?week=${value}&keep=yes#anchor`);
    await mount();
    await expect.poll(() => location.search).toBe("?keep=yes");
    expect(location.hash).toBe("#anchor");
  },
);
it("replaces an earlier valid Monday with the current business Monday", async () => {
  history.replaceState(null, "", "/manage/opening-hours?week=2026-10-05&keep=yes");
  await mount();
  await expect.poll(() => location.search).toBe("?week=2026-10-12&keep=yes");
});

function seasonBoundaryModel() {
  const data = fixture();
  const slots = (hour: string) =>
    Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      slots: [{ periodId: "p1", startsAt: "10:00", endsAt: `${hour}:0${weekday}` }],
    }));
  const ranges = (hour: string) =>
    Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      ranges: [{ startsAt: `${hour}:0${weekday}`, endsAt: "06:00" }],
    }));
  data.seasons = [
    { id: "autumn", name: "Autumn", startsOn: "09-01" },
    { id: "winter", name: "Winter", startsOn: "12-01" },
  ];
  data.currentSeasonId = "autumn";
  const [department] = data.departments;
  data.departments = [
    {
      ...department!,
      dates: [],
      seasonWeeks: [
        { seasonId: "autumn", week: slots("14") },
        { seasonId: "winter", week: slots("15") },
      ],
      zones: [
        {
          ...department!.zones[0]!,
          dates: [],
          seasonWeeks: [
            { seasonId: "autumn", week: ranges("22") },
            { seasonId: "winter", week: ranges("23") },
          ],
        },
      ],
    },
  ];
  return data;
}
const autumnThenWinterSunday = (hours: [string, string]) =>
  [1, 2, 3, 4, 5, 6, 0].map((weekday) => `${weekday === 0 ? hours[1] : hours[0]}:0${weekday}`);
async function mountAt(address: string, tag: string) {
  history.replaceState(null, "", address);
  const data = seasonBoundaryModel();
  screen = document.createElement("dashboard-opening-hours-screen");
  screen.api = new OpeningHoursApi(
    withOpeningStations((async (path, method) =>
      method === "GET"
        ? path.includes("named-days?")
          ? calendarFixture()
          : structuredClone(data)
        : undefined) as DashboardRequest),
  );
  applyTokens(screen);
  document.body.append(screen);
  await expect.poll(() => screen.shadowRoot?.querySelector(tag)).not.toBeNull();
  const view = screen.shadowRoot!.querySelector(tag) as HTMLElement & {
    updateComplete: Promise<unknown>;
  };
  await view.updateComplete;
  return view.shadowRoot!.querySelector("service-grid")!;
}
it("in the real week from Monday 25 Nov 2030, a department shows Autumn's Monday to Saturday and Winter's Sunday", async () => {
  const grid = await mountAt(
    "/manage/opening-hours/view/week/department/d1?week=2030-11-25",
    "opening-hours-week",
  );
  expect(grid.columns.map((column) => column.slots[0]?.endsAt)).toEqual(
    autumnThenWinterSunday(["14", "15"]),
  );
});
it("in the real week from Monday 25 Nov 2030, a zone shows Autumn's Monday to Saturday and Winter's Sunday, behind each date's department hours", async () => {
  const grid = await mountAt(
    "/manage/opening-hours/view/week/department/d1/zone/z1?week=2030-11-25",
    "opening-hours-zone-week",
  );
  expect(grid.columns.map((column) => column.closed?.[0]?.startsAt)).toEqual(
    autumnThenWinterSunday(["22", "23"]),
  );
  expect(grid.columns.map((column) => column.slots[0]?.endsAt)).toEqual(
    autumnThenWinterSunday(["14", "15"]),
  );
});
it("in the real week from Monday 25 Nov 2030, the All view shows Autumn's Monday to Saturday and Winter's Sunday", async () => {
  const grid = await mountAt(
    "/manage/opening-hours/view/week/department/all?week=2030-11-25",
    "opening-hours-all",
  );
  expect(grid.columns.map((column) => column.slots[0]?.endsAt)).toEqual(
    autumnThenWinterSunday(["14", "15"]),
  );
});
it.each([
  ["department", "/manage/opening-hours/view/week/department/d1", "opening-hours-week"],
  ["zone", "/manage/opening-hours/view/week/department/d1/zone/z1", "opening-hours-zone-week"],
])("shows a manager the %s week's Save only in the standard week", async (_, path, tag) => {
  const saveIn = async (address: string) => {
    const grid = await mountAt(address, tag);
    const save = (grid.getRootNode() as ShadowRoot).querySelector("[data-test=save-week]");
    screen.remove();
    return save;
  };
  expect(await saveIn(path)).not.toBeNull();
  expect(await saveIn(`${path}?week=2030-11-25`)).toBeNull();
});

const paintedParty = (): SpecialDayDetail => ({
  ...partyDetail(),
  paint: [
    {
      departmentId: "restaurant",
      date: PARTY_DATE,
      ranges: [{ periodId: null, startsAt: "22:00", endsAt: "23:30" }],
    },
  ],
  zonePaint: [
    {
      zoneId: "terrace",
      date: PARTY_DATE,
      ranges: [{ kind: "open", startsAt: "22:00", endsAt: "23:00" }],
    },
  ],
});
async function mountPainted(address: string, tag: string, reads: string[] = []) {
  history.replaceState(null, "", address);
  const request = paintDayRequest([], undefined, paintDayModel(), paintedParty());
  screen = document.createElement("dashboard-opening-hours-screen");
  screen.api = new OpeningHoursApi((async (path, method, body) => {
    if (method === "GET" && path.includes("/special-days/")) reads.push(path);
    return request(path, method, body);
  }) as DashboardRequest);
  applyTokens(screen);
  document.body.append(screen);
  await expect.poll(() => screen.shadowRoot?.querySelector(tag)).not.toBeNull();
  const view = screen.shadowRoot!.querySelector(tag) as HTMLElement & {
    updateComplete: Promise<unknown>;
  };
  await view.updateComplete;
  return view;
}
const dinner = (startsAt: string, endsAt: string) => ({ periodId: "dinner", startsAt, endsAt });
it.each([
  ["department", "/manage/opening-hours/view/week/department/restaurant", "opening-hours-week"],
  [
    "zone",
    "/manage/opening-hours/view/week/department/restaurant/zone/terrace",
    "opening-hours-zone-week",
  ],
])(
  "in the real week a %s's dated columns are read-only and each links to its date's Day view",
  async (_, path, tag) => {
    const view = await mountPainted(`${path}?week=2026-10-12`, tag);
    const grid = view.shadowRoot!.querySelector("service-grid")!;
    expect(grid.columns.map((column) => column.editable)).toEqual(Array(7).fill(false));
    expect(view.shadowRoot!.querySelector("[data-test=save-date]")).toBeNull();
    expect(view.shadowRoot!.querySelector("[data-test=save-week]")).toBeNull();
    expect(view.shadowRoot!.querySelector("[data-test=own-date]")).toBeNull();
    const links = [
      ...view.shadowRoot!.querySelectorAll<HTMLAnchorElement>("a[data-test=day-link]"),
    ];
    expect(links.map((link) => new URL(link.href).pathname)).toEqual(
      ["12", "13", "14", "15", "16", "17", "18"].map(
        (day) => `/manage/opening-hours/view/day/date/2026-10-${day}`,
      ),
    );
    links[1]!.click();
    await expect.poll(() => screen.shadowRoot!.querySelector("opening-hours-day")).not.toBeNull();
    expect(location.pathname).toContain("/view/day/");
    expect(location.pathname).toContain("/date/2026-10-13");
    const day = screen.shadowRoot!.querySelector("opening-hours-day")!;
    expect(day.date).toBe(PARTY_DATE);
  },
);
it("a viewer still has each dated column's Day link", async () => {
  const view = await mountPainted(
    "/manage/opening-hours/view/week/department/restaurant?week=2026-10-12",
    "opening-hours-week",
  );
  screen.readOnly = true;
  await screen.updateComplete;
  await view.updateComplete;
  expect(view.shadowRoot!.querySelectorAll("a[data-test=day-link]")).toHaveLength(7);
});
it("the Day view opens on the address's date", async () => {
  await mountPainted("/manage/opening-hours/view/day/date/2026-10-14", "opening-hours-day");
  expect(screen.shadowRoot!.querySelector("opening-hours-day")!.date).toBe("2026-10-14");
});
it("a special date's column draws its stored paint over the season and names it; an ordinary date draws the season", async () => {
  const reads: string[] = [];
  const view = await mountPainted(
    "/manage/opening-hours/view/week/department/restaurant?week=2026-10-12",
    "opening-hours-week",
    reads,
  );
  const grid = view.shadowRoot!.querySelector("service-grid")!;
  await expect.poll(() => grid.columns[1]!.slots).toEqual([dinner("20:00", "22:00")]);
  expect(grid.columns[1]!.label).toContain("Party");
  expect(grid.columns[2]!.slots).toEqual([dinner("20:00", "23:30")]);
  expect(grid.columns[2]!.label).not.toContain("Party");
  expect(reads).toEqual(["/management-api/venue-service/special-days/party"]);
});
it("a special date's zone column draws its stored zone paint over the department's painted hours", async () => {
  const view = await mountPainted(
    "/manage/opening-hours/view/week/department/restaurant/zone/terrace?week=2026-10-12",
    "opening-hours-zone-week",
  );
  const grid = view.shadowRoot!.querySelector("service-grid")!;
  await expect
    .poll(() => grid.columns[1]!.closed)
    .toEqual([{ startsAt: "23:00", endsAt: "23:30" }]);
  expect(grid.columns[1]!.slots).toEqual([dinner("20:00", "22:00")]);
  expect(grid.columns[1]!.label).toContain("Party");
  expect(grid.columns[2]!.closed).toEqual([{ startsAt: "22:00", endsAt: "23:30" }]);
  expect(grid.columns[2]!.slots).toEqual([dinner("20:00", "23:30")]);
});
it("the All view draws a special date's stored paint over the season and names it", async () => {
  const view = await mountPainted(
    "/manage/opening-hours/view/week/department/all?week=2026-10-12",
    "opening-hours-all",
  );
  const grid = view.shadowRoot!.querySelector("service-grid")!;
  const column = (key: string) => grid.columns.find((entry) => entry.key === key)!;
  await expect.poll(() => column("2:restaurant").slots).toEqual([dinner("20:00", "22:00")]);
  expect(column("2:restaurant").label).toContain("Party");
  expect(column("2:bar").slots).toEqual([
    { periodId: "drinks", startsAt: "18:00", endsAt: "02:00" },
  ]);
  expect(column("3:restaurant").slots).toEqual([dinner("20:00", "23:30")]);
});
it("a date the calendar marks closed all day draws no hours and says Closed", async () => {
  history.replaceState(
    null,
    "",
    "/manage/opening-hours/view/week/department/restaurant?week=2026-10-12",
  );
  const closed = { ...paintedParty(), dates: [{ date: PARTY_DATE, closedAllDay: true }] };
  const request = paintDayRequest([], undefined, paintDayModel(), closed);
  screen = document.createElement("dashboard-opening-hours-screen");
  screen.api = new OpeningHoursApi(request);
  document.body.append(screen);
  await expect.poll(() => screen.shadowRoot?.querySelector("opening-hours-week")).not.toBeNull();
  const grid = screen
    .shadowRoot!.querySelector("opening-hours-week")!
    .shadowRoot!.querySelector("service-grid")!;
  await expect.poll(() => grid.columns[1]!.label).toContain("Closed");
  expect(grid.columns[1]!.slots).toEqual([]);
});
it("says the week could not be loaded when a special day's read fails", async () => {
  history.replaceState(
    null,
    "",
    "/manage/opening-hours/view/week/department/restaurant?week=2026-10-12",
  );
  const request = paintDayRequest([], undefined, paintDayModel(), paintedParty());
  screen = document.createElement("dashboard-opening-hours-screen");
  screen.api = new OpeningHoursApi((async (path, method, body) => {
    if (path.includes("/special-days/")) throw new Error("offline");
    return request(path, method, body);
  }) as DashboardRequest);
  document.body.append(screen);
  await expect
    .poll(() => screen.shadowRoot?.querySelector("[role=alert]")?.textContent)
    .toBe("Opening hours could not be loaded. It will be tried again.");
});
it("leaves a modified click on a Day link to the browser", async () => {
  const view = await mountPainted(
    "/manage/opening-hours/view/week/department/restaurant?week=2026-10-12",
    "opening-hours-week",
  );
  const link = view.shadowRoot!.querySelector<HTMLAnchorElement>("a[data-test=day-link]")!;
  const click = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
  link.addEventListener("click", (event) => event.preventDefault(), { once: true });
  link.dispatchEvent(click);
  await screen.updateComplete;
  expect(screen.shadowRoot!.querySelector("opening-hours-day")).toBeNull();
  expect(location.pathname).toBe("/manage/opening-hours/view/week/department/restaurant");
});
