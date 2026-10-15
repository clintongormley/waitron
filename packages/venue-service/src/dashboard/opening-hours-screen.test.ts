import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { html, LitElement } from "lit";
import { userEvent } from "vitest/browser";
import {
  registerCatalogue,
  setLocale,
  type CalendarViewHost,
  type DashboardCalendarView,
  type DashboardRequest,
} from "@waitron/dashboard-kit";
import { applyTokens, NavigationGuard } from "@waitron/ui";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import type { OpeningHoursYear } from "../opening-hours-calendar.js";
import type { SpecialDayDetail, SpecialDayInput } from "../special-days.js";
import { OpeningHoursApi } from "./opening-hours-client.js";
import type { SpecialDayPainter } from "./special-day-painter.js";
import { frame, settle } from "../testing/special-day-painter-fixture.js";
import { t } from "./strings.js";

import "./opening-hours-screen.js";

type Screen = LitElement & { api: OpeningHoursApi; readOnly: boolean };
const hosts: HTMLElement[] = [];
const originalUrl = location.href;
beforeEach(() => {
  setLocale("en");
  history.replaceState(null, "", "/manage/opening-hours/view/year");
});
afterEach(() => {
  vi.useRealTimers();
  for (const host of hosts.splice(0)) host.remove();
  setLocale("en");
  history.replaceState(null, "", originalUrl);
});

function model(): OpeningHoursModel {
  return {
    businessDayClock: { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] },
    clockRevision: 0,
    currentBusinessDay: "2026-10-12",
    pending: null,
    timeZone: "Europe/Madrid",
    clockReadable: true,
    dayCutover: "06:00",
    menus: [
      { id: "lunch", name: "Lunch menu", active: true, includes: ["desserts", "drinks"] },
      { id: "desserts", name: "Desserts", active: true, includes: [] },
      { id: "drinks", name: "Drinks", active: true, includes: [] },
      { id: "staff", name: "Staff snacks", active: true, includes: [] },
    ],
    seasons: [],
    currentSeasonId: null,
    departments: [
      {
        id: "restaurant",
        name: "Restaurant",
        active: true,
        zones: [],
        periods: [
          {
            id: "p1",
            name: "Lunch",
            colour: "green",
            menuId: "lunch",
            staffMenuIds: ["staff"],
            endOffsetMinutes: 0,
            weekdays: [1, 3],
            routingUses: [],
          },
        ],
        seasonWeeks: [],
      },
      {
        id: "deli",
        name: "Deli",
        active: false,
        zones: [],
        periods: [],
        seasonWeeks: [],
      },
    ],
  };
}

/** Answers the special-day painter's season read with no season hours; the rest goes to `request`. */
function withSeasonDays(request: DashboardRequest): DashboardRequest {
  return (async (path, method, body, options) =>
    method === "GET" && path.includes("/opening-hours/season-days?")
      ? {
          days: new URL(path, "http://x").searchParams
            .get("dates")!
            .split(",")
            .map((date) => ({ date, seasonId: null, dayCutover: "06:00", departments: [] })),
        }
      : request(path, method, body, options)) as DashboardRequest;
}
/** A special-day write's answer as the server gives it: the stored day the request describes. */
function savedDay(path: string, method: string, body: unknown): SpecialDayDetail {
  const input = body as SpecialDayInput;
  return {
    id: method === "POST" ? "new" : decodeURIComponent(path.split("/").pop()!),
    name: input.name,
    repeatsYearly: input.repeatsYearly,
    dates: [...input.dates],
    paint: [],
    zonePaint: [],
  };
}
async function specialPainter(el: Screen) {
  await expect
    .poll(() =>
      el
        .shadowRoot!.querySelector("special-day-painter")
        ?.shadowRoot?.querySelector("painter-frame"),
    )
    .toBeTruthy();
  const form = el.shadowRoot!.querySelector<SpecialDayPainter>("special-day-painter")!;
  await expect.poll(() => form.shadowRoot!.querySelector("[data-test=loading]")).toBeNull();
  await settle(form);
  return form;
}
const painterSave = (form: SpecialDayPainter) =>
  frame(form).shadowRoot!.querySelector<HTMLElementTagNameMap["wt-button"]>("[data-test=save]")!;
const painterChips = (form: SpecialDayPainter) =>
  [...form.shadowRoot!.querySelectorAll<HTMLElement>("[data-test=date-chip]")].map(
    (chip) => chip.dataset.date,
  );

async function mount(request?: DashboardRequest, readOnly = false) {
  expect(
    customElements.get("dashboard-opening-hours-screen"),
    "Opening hours screen registered",
  ).toBeDefined();
  const el = document.createElement("dashboard-opening-hours-screen") as Screen;
  el.api = new OpeningHoursApi(
    withSeasonDays(
      request ??
        ((async (path: string) =>
          path.includes("/opening-hours/year?")
            ? yearRead(2026)
            : structuredClone(model())) as DashboardRequest),
    ),
  );
  el.readOnly = readOnly;
  applyTokens(el);
  hosts.push(el);
  document.body.append(el);
  await expect.poll(() => el.shadowRoot?.querySelector("wt-tabs")).not.toBeNull();
  await el.updateComplete;
  return el;
}
it("falls back to an active department for an unknown link", async () => {
  history.replaceState(null, "", "/manage/opening-hours/view/unknown/department/missing");
  const el = await mount();
  expect(el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-tabs"]>("wt-tabs")!.value).toBe(
    "year",
  );
  await expect
    .poll(() => location.pathname)
    .toBe("/manage/opening-hours/view/season/department/restaurant");
  expect(el.shadowRoot!.querySelector("season-painter")!.departmentId).toBe("restaurant");
});

it("ignores another screen's department link while Opening hours is mounted", async () => {
  history.replaceState(null, "", "/manage/other-screen/view/periods/department/deli");
  const el = await mount();
  expect(el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-tabs"]>("wt-tabs")!.value).toBe(
    "year",
  );
  expect(el.shadowRoot!.querySelector("season-painter")).toBeNull();
  expect(location.pathname).toBe("/manage/other-screen/view/periods/department/deli");
});

it("recovers a failed initial load and ignores model reads that settle after removal", async () => {
  // Madrid's business day is still 31 December; Kiritimati's is already 1 January.
  vi.setSystemTime(new Date("2026-12-31T23:30:00Z"));
  let reads = 0;
  let resolve!: (data: OpeningHoursModel) => void;
  const el = document.createElement("dashboard-opening-hours-screen");
  el.api = new OpeningHoursApi((async (path: string) => {
    if (path.includes("/opening-hours/year?")) return yearRead(2026);
    if (++reads === 1) throw new Error("offline");
    if (reads === 2) return model();
    return new Promise<OpeningHoursModel>((done) => {
      resolve = done;
    });
  }) as DashboardRequest);
  hosts.push(el);
  document.body.append(el);
  await expect.poll(() => el.shadowRoot!.querySelector("[data-test=read-error]")).not.toBeNull();
  el.api.rereadWatches();
  await expect.poll(() => el.shadowRoot!.querySelector("opening-hours-year")).not.toBeNull();
  expect(el.shadowRoot!.querySelector("[data-test=read-error]")).toBeNull();
  expect(el.shadowRoot!.querySelector("opening-hours-year")!.year).toBe(2026);
  el.api.rereadWatches();
  el.remove();
  const data = model();
  data.businessDayClock = { ...data.businessDayClock, timeZone: "Pacific/Kiritimati" };
  resolve(data);
  await new Promise((settled) => setTimeout(settled, 0));
  await el.updateComplete;
  expect(el.shadowRoot!.querySelector("opening-hours-year")!.year).toBe(2026);
});

it("reads no prep-station list, on the Year or on an old station address", async () => {
  const paths: string[] = [];
  const read = (async (path: string) => {
    paths.push(path);
    return path.includes("/opening-hours/year?") ? yearRead(2026) : structuredClone(model());
  }) as DashboardRequest;
  const el = document.createElement("dashboard-opening-hours-screen") as Screen;
  el.api = new OpeningHoursApi(withSeasonDays(read));
  hosts.push(el);
  document.body.append(el);
  await expect.poll(() => el.shadowRoot?.querySelector("opening-hours-year")).not.toBeNull();
  history.pushState(null, "", "/manage/opening-hours?view=week&station=bar");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await expect.poll(() => el.shadowRoot?.querySelector("season-painter")).not.toBeNull();
  expect(paths.some((path) => path.startsWith("/management-api/stations"))).toBe(false);
});

it("shows the Spanish Calendar title", async () => {
  setLocale("es");
  const el = await mount();
  expect(el.shadowRoot!.querySelector("h1")!.textContent).toBe("Calendario");
});

function pickerModel(): OpeningHoursModel {
  const data = model();
  data.departments[0]!.zones = [{ id: "terrace", name: "Terrace", seasonWeeks: [] }];
  return {
    ...data,
    departments: [
      ...data.departments,
      {
        id: "bar",
        name: "Bar",
        active: true,
        zones: [],
        periods: [],
        seasonWeeks: [],
      },
    ],
  };
}
it("keeps a zone through Back and Forward and clears it when choosing a department", async () => {
  history.replaceState(null, "", "/manage/opening-hours/view/year");
  const guard = new NavigationGuard(window, {
    isDirty: () => false,
    request: async () => "proceeded",
  });
  try {
    const el = await mount((async (path: string) =>
      path.includes("/opening-hours/year?")
        ? yearRead(2026)
        : structuredClone(pickerModel())) as DashboardRequest);
    const painter = () => el.shadowRoot!.querySelector("season-painter");
    history.pushState(
      null,
      "",
      "/manage/opening-hours/view/season/department/restaurant/zone/terrace",
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
    await expect.poll(() => painter()?.zoneId).toBe("terrace");
    expect(painter()!.departmentId).toBe("restaurant");
    history.back();
    await expect.poll(() => painter()).toBeNull();
    expect(location.pathname).toBe("/manage/opening-hours/view/year");
    history.forward();
    await expect.poll(() => painter()?.zoneId).toBe("terrace");
    painter()!.dispatchEvent(
      new CustomEvent("painter-navigate", {
        detail: { seasonId: "", departmentId: "bar", zoneId: null },
        bubbles: true,
        composed: true,
      }),
    );
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/season/department/bar");
    await expect.poll(() => painter()?.zoneId).toBe("");
    expect(painter()!.departmentId).toBe("bar");
  } finally {
    guard.dispose();
  }
});
it("ignores a zone belonging to another department", async () => {
  history.replaceState(null, "", "/manage/opening-hours/view/week/department/bar/zone/terrace");
  const el = await mount((async (path: string) =>
    path.includes("/opening-hours/year?")
      ? yearRead(2026)
      : structuredClone(pickerModel())) as DashboardRequest);
  await expect
    .poll(() => location.pathname)
    .toBe("/manage/opening-hours/view/season/department/bar");
  const painter = el.shadowRoot!.querySelector("season-painter")!;
  expect([painter.departmentId, painter.zoneId]).toEqual(["bar", ""]);
});

function yearRead(
  year: number,
  days: OpeningHoursYear["days"] = [],
  overrides: Partial<OpeningHoursYear> = {},
): OpeningHoursYear {
  return {
    businessDayClock: { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] },
    clockRevision: 0,
    currentBusinessDay: "2026-10-07",
    pending: null,
    year,
    timeZone: "Europe/Madrid",
    today: "2026-10-07",
    seasons: [],
    days,
    publicHolidaysAvailable: true,
    missingHolidays: [],
    holidayCoverage: [],
    area: {
      addressKey: "fixture-address",
      readiness: "ready",
      options: [],
      required: false,
      chosen: null,
    },
    ...overrides,
  };
}
const yearHeading = (el: Screen) =>
  el.shadowRoot!.querySelector("opening-hours-year")?.shadowRoot?.querySelector("[data-test=year]")
    ?.textContent;

it("restores the Year URL and writes year navigation without a department picker", async () => {
  vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
  history.replaceState(null, "", "/manage/opening-hours/view/year/year/2027?keep=yes");
  const years: string[] = [];
  const el = await mount((async (path: string) => {
    const asked = /\/opening-hours\/year\?year=(\d+)$/.exec(path);
    if (asked) {
      years.push(asked[1]!);
      return yearRead(Number(asked[1]));
    }
    if (path.endsWith("/special-days")) return [];
    return model();
  }) as DashboardRequest);
  expect(el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-tabs"]>("wt-tabs")!.value).toBe(
    "year",
  );
  const year = el.shadowRoot!.querySelector("opening-hours-year");
  expect(year).not.toBeNull();
  await expect.poll(() => yearHeading(el)).toBe("2027");
  expect(el.shadowRoot!.querySelector("[name=departmentId]")).toBeNull();
  expect(years[0]).toBe("2027");
  (year!.shadowRoot!.querySelector("[data-test=next-year]") as HTMLElement).click();
  await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/year/year/2028");
  expect(location.search).toBe("?keep=yes");
  await expect.poll(() => yearHeading(el)).toBe("2028");
  expect(el.shadowRoot!.querySelector("opening-hours-year")).toBe(year);
  history.replaceState(null, "", "/manage/opening-hours/view/year/year/2025");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await expect.poll(() => yearHeading(el)).toBe("2025");
  expect(el.shadowRoot!.querySelector("opening-hours-year")).toBe(year);
  history.replaceState(null, "", "/manage/opening-hours/view/year/year/2027-13");
  window.dispatchEvent(new PopStateEvent("popstate"));
  await expect.poll(() => yearHeading(el)).toBe("2026");
  expect(years).toEqual(["2027", "2028", "2025", "2026"]);
});

describe("Year venue year fallback", () => {
  /** At 2027-01-01T12:00Z the venue's business day is still 2026-12-31; the browser's is 2027. */
  function venueModel(readable = true, timeZone = "Pacific/Pago_Pago") {
    return {
      ...model(),
      businessDayClock: { timeZone, dayCutover: "06:00", cutoverChanges: [] },
      timeZone,
      clockReadable: readable,
    };
  }
  function yearRequest(years: string[], opening: () => OpeningHoursModel) {
    return (async (path: string) => {
      const asked = /\/opening-hours\/year\?year=(\d+)$/.exec(path);
      if (asked) {
        years.push(asked[1]!);
        return yearRead(Number(asked[1]));
      }
      if (path.endsWith("/special-days")) return [];
      return opening();
    }) as DashboardRequest;
  }
  it("replaces the browser's year with the venue's year when no year is chosen", async () => {
    vi.setSystemTime(new Date("2027-01-01T12:00:00Z"));
    history.replaceState(null, "", "/manage/opening-hours/view/year");
    const years: string[] = [];
    const el = await mount(yearRequest(years, () => venueModel()));
    await expect.poll(() => yearHeading(el)).toBe("2026");
    expect(years).toEqual(["2026"]);
    expect(location.pathname).toBe("/manage/opening-hours/view/year");
  });
  it("uses the venue's year after an invalid-year popstate", async () => {
    vi.setSystemTime(new Date("2027-01-01T12:00:00Z"));
    history.replaceState(null, "", "/manage/opening-hours/view/year/year/2028");
    const el = await mount(yearRequest([], () => venueModel()));
    await expect.poll(() => yearHeading(el)).toBe("2028");
    history.replaceState(null, "", "/manage/opening-hours/view/year/year/2028x");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await expect.poll(() => yearHeading(el)).toBe("2026");
  });
  it("keeps a valid explicit year across later venue-date reads", async () => {
    vi.setSystemTime(new Date("2027-01-01T12:00:00Z"));
    history.replaceState(null, "", "/manage/opening-hours/view/year/year/2028");
    let timeZone = "Pacific/Pago_Pago";
    const years: string[] = [];
    const el = await mount(yearRequest(years, () => venueModel(true, timeZone)));
    await expect.poll(() => yearHeading(el)).toBe("2028");
    timeZone = "Pacific/Kiritimati";
    el.api.rereadWatches();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(yearHeading(el)).toBe("2028");
    expect(new Set(years)).toEqual(new Set(["2028"]));
  });
  it("keeps an operator's year choice when the venue's first readable date arrives", async () => {
    vi.setSystemTime(new Date("2027-01-01T12:00:00Z"));
    history.replaceState(null, "", "/manage/opening-hours/view/year");
    let readable = false;
    const el = await mount(yearRequest([], () => venueModel(readable)));
    await expect.poll(() => yearHeading(el)).toBe("2027");
    el.shadowRoot!.querySelector("opening-hours-year")!
      .shadowRoot!.querySelector<HTMLElement>("[data-test=next-year]")!
      .click();
    await expect.poll(() => yearHeading(el)).toBe("2028");
    readable = true;
    el.api.rereadWatches();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    expect(yearHeading(el)).toBe("2028");
    expect(location.pathname).toBe("/manage/opening-hours/view/year/year/2028");
    history.replaceState(null, "", "/manage/opening-hours/view/year/year/2028x");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await expect.poll(() => yearHeading(el)).toBe("2026");
  });
});

describe("Year special-day actions", () => {
  const stored = {
    id: "annual/day",
    name: "Anniversary",
    repeatsYearly: true,
    dates: [
      { date: "2025-10-13", closedAllDay: false },
      { date: "2025-10-14", closedAllDay: true },
    ],
    paint: [
      {
        departmentId: "restaurant",
        date: "2025-10-13",
        ranges: [{ periodId: "lunch", startsAt: "12:00", endsAt: "16:00" }],
      },
    ],
    zonePaint: [],
  };
  const feast = {
    id: "feast/2025",
    name: "Public feast",
    repeatsYearly: false,
    dates: [{ date: "2025-10-12", closedAllDay: true, holidayName: "Public feast" }],
    paint: [],
    zonePaint: [],
  };
  const olderFeast = {
    id: "feast/2024",
    name: "Public feast",
    repeatsYearly: false,
    dates: [{ date: "2024-10-12", closedAllDay: false }],
  };
  async function yearMount(
    options: {
      withFeast?: boolean;
      refuse?: unknown;
      readFails?: boolean;
      listFails?: boolean;
      oneOff?: boolean;
    } = {},
  ) {
    const {
      withFeast = false,
      refuse,
      readFails = false,
      listFails = false,
      oneOff = false,
    } = options;
    history.replaceState(null, "", "/manage/opening-hours/view/year/year/2026");
    const writes: unknown[][] = [];
    const created = new Map<string, SpecialDayDetail>();
    let reads = 0;
    let stationReads = 0;
    const el = await mount((async (path, method, body) => {
      if (method !== "GET") {
        writes.push([path, method, body]);
        if (refuse) throw refuse;
        if (method === "DELETE") return undefined;
        const saved = savedDay(path, method, body);
        if (method === "POST") created.set(saved.id, saved);
        return saved;
      }
      const createdDay = created.get(decodeURIComponent(path.split("/").pop()!));
      if (path.includes("/special-days/") && createdDay) return structuredClone(createdDay);
      if (path.includes("/hours?")) stationReads++;
      if (path.includes("/opening-hours/month?")) return { days: [] };
      if (path.endsWith("/special-days") && listFails) throw { code: "connection.failed" };
      if (path.endsWith("/special-days"))
        return withFeast
          ? [
              { ...olderFeast },
              { id: feast.id, name: feast.name, repeatsYearly: false, dates: feast.dates },
              { id: stored.id, name: stored.name, repeatsYearly: true, dates: stored.dates },
            ]
          : [{ id: stored.id, name: stored.name, repeatsYearly: true, dates: stored.dates }];
      if (path.endsWith("/special-days/annual%2Fday")) {
        if (readFails) throw { code: "connection.failed" };
        return { ...structuredClone(stored), repeatsYearly: !oneOff };
      }
      if (path.endsWith("/special-days/feast%2F2025")) return structuredClone(feast);
      if (path.endsWith("/opening-hours/year?year=2026")) {
        reads++;
        return yearRead(2026, [
          {
            date: "2026-10-13",
            seasonId: null,
            specialDay: { id: stored.id, name: stored.name },
            holidays: [],
            tone: "special_day",
            closed: false,
          },
          {
            date: "2026-10-12",
            seasonId: null,
            specialDay: null,
            holidays: [
              {
                id: "public",
                date: "2026-10-12",
                name: "Public feast",
                scope: "national",
                sourceId: "official",
              },
            ],
            tone: "public_holiday",
            closed: false,
          },
        ]);
      }
      return model();
    }) as DashboardRequest);
    const cal = el.shadowRoot!.querySelector("opening-hours-year")!;
    await expect
      .poll(() => cal.shadowRoot!.querySelector("td[data-date='2026-10-13']"))
      .not.toBeNull();
    return { el, cal, writes, reads: () => reads, stationReads: () => stationReads };
  }
  async function action(
    cal: HTMLElementTagNameMap["opening-hours-year"],
    date: string,
    kind: string,
  ) {
    const trigger = cal.shadowRoot!.querySelector<HTMLElement>(`td[data-date='${date}'] button`);
    expect(trigger, "the year offers the date").not.toBeNull();
    trigger!.click();
    await cal.updateComplete;
    const button = cal.shadowRoot!.querySelector<HTMLElement>(`[data-test=special-${kind}]`);
    expect(button, `${kind} offered for ${date}`).not.toBeNull();
    button!.click();
  }
  function field(form: SpecialDayPainter, name: string) {
    return form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>(
      `wt-input[name=${name}]`,
    )!;
  }
  async function change(form: SpecialDayPainter, name: string, value: string) {
    field(form, name).dispatchEvent(
      new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
    );
    await settle(form);
  }
  const save = (form: SpecialDayPainter) => painterSave(form).click();

  it("Edit opens the stored special day in the painter and a name change sends its dates unchanged and no paint", async () => {
    const { el, cal, writes, reads, stationReads } = await yearMount();
    await action(cal, "2026-10-13", "edit");
    const form = await specialPainter(el);
    expect(form.specialDayId).toBe("annual/day");
    expect(field(form, "name").value).toBe("Anniversary");
    await change(form, "name", "New anniversary");
    save(form);
    await expect
      .poll(() => writes)
      .toEqual([
        [
          "/management-api/venue-service/special-days/annual%2Fday",
          "PUT",
          {
            expectedClockRevision: 0,
            name: "New anniversary",
            repeatsYearly: true,
            dates: stored.dates,
          },
        ],
      ]);
    await expect.poll(() => painterSave(form).disabled).toBe(true);
    await expect.poll(reads).toBe(2);
    expect(stationReads()).toBe(0);
  });
  it("a public holiday opens the painter pre-filled with its name and date and creates a special day", async () => {
    const { el, cal, writes, reads } = await yearMount();
    await action(cal, "2026-10-12", "add");
    const form = await specialPainter(el);
    expect(form.shadowRoot!.querySelector("[data-test=add-to]")).toBeNull();
    expect(field(form, "name").value).toBe("Public feast");
    save(form);
    await expect
      .poll(() => writes)
      .toEqual([
        [
          "/management-api/venue-service/special-days",
          "POST",
          {
            expectedClockRevision: 0,
            name: "Public feast",
            repeatsYearly: false,
            dates: [{ date: "2026-10-12", closedAllDay: false }],
          },
        ],
      ]);
    await expect.poll(reads).toBe(2);
  });
  it("Add to <name> opens the venue's latest same-named special day with the date added, written only on Save", async () => {
    const { el, cal, writes, reads } = await yearMount({ withFeast: true });
    await action(cal, "2026-10-12", "add");
    let form = await specialPainter(el);
    await expect.poll(() => form.shadowRoot!.querySelector("[data-test=add-to]")).not.toBeNull();
    expect(form.shadowRoot!.querySelector("[data-test=add-to]")!.textContent).toContain(
      "Add to Public feast",
    );
    form.shadowRoot!.querySelector<HTMLElement>("[data-test=add-to]")!.click();
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/special-day/special-day/feast%2F2025");
    form = await specialPainter(el);
    await expect.poll(() => painterChips(form)).toEqual(["2025-10-12", "2026-10-12"]);
    expect(writes).toEqual([]);
    save(form);
    await expect
      .poll(() => writes)
      .toEqual([
        [
          "/management-api/venue-service/special-days/feast%2F2025",
          "PUT",
          {
            expectedClockRevision: 0,
            name: "Public feast",
            repeatsYearly: false,
            dates: [
              { date: "2025-10-12", closedAllDay: true },
              { date: "2026-10-12", closedAllDay: false },
            ],
          },
        ],
      ]);
    await expect.poll(reads).toBe(2);
  });
  it("opens a public holiday's painter with no offer when the special-day list cannot be read", async () => {
    const { el, cal } = await yearMount({ withFeast: true, listFails: true });
    await action(cal, "2026-10-12", "add");
    const form = await specialPainter(el);
    expect(form.shadowRoot!.querySelector("[data-test=add-to]")).toBeNull();
    expect(field(form, "name").value).toBe("Public feast");
    expect(el.shadowRoot!.querySelector("[data-test=special-read-error]")).toBeNull();
  });
  it("shows a refused save of the date Add to added beside Save, keeping the painter open", async () => {
    const { el, cal, writes } = await yearMount({
      withFeast: true,
      refuse: { code: "hours.clock_changed" },
    });
    await action(cal, "2026-10-12", "add");
    let form = await specialPainter(el);
    await expect.poll(() => form.shadowRoot!.querySelector("[data-test=add-to]")).not.toBeNull();
    form.shadowRoot!.querySelector<HTMLElement>("[data-test=add-to]")!.click();
    await expect.poll(() => painterChips(form)).toEqual(["2025-10-12", "2026-10-12"]);
    form = await specialPainter(el);
    save(form);
    await expect.poll(() => writes.length).toBe(1);
    await expect.poll(() => frame(form).refusal).toBe(t("hours.clock_changed"));
    expect(el.shadowRoot!.querySelector("special-day-painter")).toBe(form);
  });
  it("shows the holiday-name note when a date added in the painter is a holiday the year shows", async () => {
    const { el, cal } = await yearMount();
    await action(cal, "2026-10-11", "add");
    const form = await specialPainter(el);
    expect(form.shadowRoot!.querySelector("[data-test=holiday-note]")).toBeNull();
    form.shadowRoot!.querySelector<HTMLElement>("[data-test=add-dates]")!.click();
    await settle(form);
    form.shadowRoot!.querySelector("add-dates-calendar")!.dispatchEvent(
      new CustomEvent("add-dates", {
        detail: { dates: ["2026-10-12"] },
        bubbles: true,
        composed: true,
      }),
    );
    await settle(form);
    expect(form.shadowRoot!.querySelector("[data-test=holiday-note]")).not.toBeNull();
  });
  it("says in the painter when the special day cannot be read", async () => {
    const { el, cal } = await yearMount({ readFails: true });
    await action(cal, "2026-10-13", "edit");
    const form = await specialPainter(el);
    expect(frame(form).refusal).toBe(t("special.load_error"));
    expect(el.shadowRoot!.querySelector("[data-test=special-read-error]")).toBeNull();
  });
  it("says when the special day to delete cannot be read, and clears it on another view", async () => {
    const { el, cal } = await yearMount({ readFails: true });
    await action(cal, "2026-10-13", "delete");
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=special-read-error]")?.textContent)
      .toContain("Opening hours could not be loaded.");
    expect(el.shadowRoot!.querySelector("[data-test=delete-special-day]")).toBeNull();
    cal.dispatchEvent(new CustomEvent("year-month-open", { detail: { date: "2026-12-01" } }));
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=special-read-error]"))
      .toBeNull();
  });
  it("Make on a plain date creates a special day in the painter and refreshes the year", async () => {
    const { el, cal, writes, reads } = await yearMount();
    await action(cal, "2026-10-16", "add");
    const form = await specialPainter(el);
    await change(form, "name", "World cup final");
    save(form);
    await expect
      .poll(() => writes)
      .toEqual([
        [
          "/management-api/venue-service/special-days",
          "POST",
          {
            expectedClockRevision: 0,
            name: "World cup final",
            repeatsYearly: false,
            dates: [{ date: "2026-10-16", closedAllDay: false }],
          },
        ],
      ]);
    await expect.poll(reads).toBe(2);
  });
  it("Delete names the repeating special day, warns that every year goes and refreshes", async () => {
    const { el, cal, writes, reads } = await yearMount();
    await action(cal, "2026-10-13", "delete");
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=delete-special-day]"))
      .not.toBeNull();
    const confirm = el.shadowRoot!.querySelector("[data-test=delete-special-day]")!;
    expect(confirm.textContent).toContain("Anniversary");
    expect(confirm.textContent).toContain("every year");
    expect(writes).toEqual([]);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-special-delete]")!.click();
    await expect
      .poll(() => writes)
      .toEqual([
        [
          "/management-api/venue-service/special-days/annual%2Fday",
          "DELETE",
          { expectedClockRevision: 0 },
        ],
      ]);
    await expect.poll(reads).toBe(2);
  });
  it("a refused Delete says so and stays open; Cancel then closes it without another write", async () => {
    const { el, cal, writes } = await yearMount({ refuse: { code: "hours.clock_changed" } });
    await action(cal, "2026-10-13", "delete");
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=delete-special-day]"))
      .not.toBeNull();
    const confirm = el.shadowRoot!.querySelector("[data-test=delete-special-day]")!;
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=confirm-special-delete]")!.click();
    await expect
      .poll(() => confirm.querySelector("[role=alert]")?.textContent)
      .toBe("The change could not be saved.");
    expect(writes).toHaveLength(1);
    expect(el.shadowRoot!.querySelector("[data-test=delete-special-day]")).toBe(confirm);
    confirm.querySelector<HTMLElement>("wt-button[slot=cancel]")!.click();
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=delete-special-day]"))
      .toBeNull();
    expect(writes).toHaveLength(1);
  });
  it("Delete names a one-off special day with no every-year warning", async () => {
    const { el, cal } = await yearMount({ oneOff: true });
    await action(cal, "2026-10-13", "delete");
    await expect
      .poll(() =>
        el.shadowRoot!.querySelector("[data-test=delete-special-day] p")?.textContent?.trim(),
      )
      .toBe("Delete Anniversary?");
  });
  it("closing the Delete confirmation from the dialog itself deletes nothing", async () => {
    const { el, cal, writes } = await yearMount();
    await action(cal, "2026-10-13", "delete");
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=delete-special-day]"))
      .not.toBeNull();
    el.shadowRoot!.querySelector("[data-test=delete-special-day]")!.dispatchEvent(
      new CustomEvent("wt-close", { bubbles: true, composed: true }),
    );
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=delete-special-day]"))
      .toBeNull();
    expect(writes).toEqual([]);
  });
});

it("pre-fills the holiday's name when the sender names only the date's own holidays", async () => {
  history.replaceState(null, "", "/manage/opening-hours/view/year");
  const el = await mount((async (path, method) => {
    if (method !== "GET") throw new Error(`unexpected ${method} ${path}`);
    if (path.endsWith("/special-days")) return [];
    if (path.includes("/opening-hours/year?")) return yearRead(2026);
    return structuredClone(model());
  }) as DashboardRequest);
  const child = el.shadowRoot!.querySelector("opening-hours-year")!;
  child.dispatchEvent(
    new CustomEvent("special-day-action", {
      detail: {
        kind: "open",
        date: "2026-11-04",
        holidays: [
          {
            id: "h",
            date: "2026-11-04",
            name: "Town feast",
            scope: "local",
            sourceId: "official",
          },
        ],
        returnTo: () => child,
      },
      bubbles: true,
      composed: true,
    }),
  );
  const editor = await specialPainter(el);
  expect(
    editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=name]")!
      .value,
  ).toBe("Town feast");
});
it("a special-day painter opened from the Year keeps its revision through a passive replacement", async () => {
  const data = model();
  data.clockRevision = 7;
  const calendar = { clockRevision: 7 };
  const writes: unknown[] = [];
  let openingReads = 0;
  history.replaceState(null, "", "/manage/opening-hours/view/year");
  const el = await mount((async (path, method, body) => {
    if (method === "GET") {
      if (path.endsWith("/opening-hours")) openingReads++;
      if (path.endsWith("/special-days")) return [];
      if (path.includes("/opening-hours/year?"))
        return yearRead(2026, [], { clockRevision: calendar.clockRevision });
      return structuredClone(data);
    }
    writes.push(body);
    throw { code: "hours.clock_changed" };
  }) as DashboardRequest);
  const child = el.shadowRoot!.querySelector("opening-hours-year")!;
  child.dispatchEvent(
    new CustomEvent("special-day-action", {
      detail: { kind: "open", date: "2026-11-04", holidays: [], returnTo: () => child },
      bubbles: true,
      composed: true,
    }),
  );
  const editor = await specialPainter(el);
  editor.shadowRoot!.querySelector("wt-input[name=name]")!.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "Festival" },
      bubbles: true,
      composed: true,
    }),
  );
  await settle(editor);
  data.clockRevision = 8;
  calendar.clockRevision = 8;
  data.departments[0]!.name = "Updated Restaurant";
  el.api.rereadWatches();
  await expect.poll(() => openingReads).toBe(2);
  await el.updateComplete;
  await expect.poll(() => editor.model.departments[0]!.name).toBe("Updated Restaurant");
  painterSave(editor).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({
    name: "Festival",
    dates: [{ date: "2026-11-04", closedAllDay: false }],
    expectedClockRevision: 7,
  });
  await expect.poll(() => frame(editor).refusal).toBe(t("hours.clock_changed"));
});

describe("Year view", () => {
  type YearModel = OpeningHoursYear;
  function yearModel(year: number, overrides: Partial<YearModel> = {}): YearModel {
    return {
      businessDayClock: { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] },
      clockRevision: 4,
      currentBusinessDay: "2026-10-12",
      pending: null,
      year,
      timeZone: "Europe/Madrid",
      today: "2026-10-12",
      seasons: [{ id: "all", name: "All year", startsOn: "01-01", lastDay: "12-31" }],
      days: [
        {
          date: `${year}-10-13`,
          seasonId: "all",
          specialDay: { id: "annual/day", name: "Anniversary" },
          holidays: [],
          tone: "special_day",
          closed: false,
        },
      ],
      publicHolidaysAvailable: true,
      missingHolidays: [],
      holidayCoverage: [],
      area: {
        addressKey: "fixture-address",
        readiness: "ready",
        options: [
          { key: "bcn", name: "Barcelona" },
          { key: "gir", name: "Girona" },
        ],
        required: false,
        chosen: "bcn",
      },
      ...overrides,
    };
  }
  async function yearMount(address: string, readOnly = false, failYear = 0) {
    vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
    history.replaceState(null, "", address);
    const years: string[] = [];
    const writes: unknown[][] = [];
    let openingReads = 0;
    let listReads: unknown[] = [];
    let failures = failYear;
    const el = await mount(
      (async (path: string, method: string, body: unknown, options) => {
        if (method !== "GET") {
          writes.push([path, method, body]);
          return { id: "new" };
        }
        if (path.includes("/opening-hours/month?")) {
          const { monthModel } = await import("../testing/opening-hours-month-fixture.js");
          return monthModel({ month: new URL(path, location.href).searchParams.get("month")! });
        }
        const asked = /\/opening-hours\/year\?year=(\d+)$/.exec(path);
        if (asked) {
          years.push(asked[1]!);
          if (failures-- > 0) throw { code: "connection.failed" };
          return yearModel(Number(asked[1]));
        }
        if (path.endsWith("/special-days")) {
          listReads = [...listReads, options];
          return [
            { id: "annual/day", name: "Anniversary", repeatsYearly: true, dates: [] },
            { id: "later", name: "Later fair", repeatsYearly: true, dates: [] },
          ];
        }
        if (path.endsWith("/opening-hours")) openingReads++;
        return model();
      }) as DashboardRequest,
      readOnly,
    );
    const view = () => el.shadowRoot!.querySelector("opening-hours-year");
    return {
      el,
      view,
      years,
      writes,
      openingReads: () => openingReads,
      listReads: () => listReads,
    };
  }
  const tabs = (el: Screen) =>
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-tabs"]>("wt-tabs")!;

  it("opens on the venue's current year when the address names no view and no week parameter", async () => {
    const { el, view, years } = await yearMount("/manage/opening-hours");
    expect(tabs(el).value).toBe("year");
    expect(tabs(el).items.map((item) => item.key)).toEqual(["year"]);
    expect(tabs(el).items[0]!.label).toBe("Year");
    await expect.poll(() => view()?.model?.year).toBe(2026);
    expect(years).toEqual(["2026"]);
    expect(el.shadowRoot!.querySelector("[name=departmentId]")).toBeNull();
    expect(el.shadowRoot!.querySelector("hours-calendar")).toBeNull();
    expect(location.pathname).toBe("/manage/opening-hours");
  });

  it.each([
    ["a department", "/manage/opening-hours/department/restaurant"],
    ["a season", "/manage/opening-hours/season/winter"],
    ["a zone", "/manage/opening-hours/zone/z1"],
    ["an unknown view", "/manage/opening-hours/view/nonsense"],
  ])("opens the painter over the Year when the address names %s", async (_, address) => {
    const { el, years } = await yearMount(address);
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/season/department/restaurant");
    expect(tabs(el).value).toBe("year");
    expect(el.shadowRoot!.querySelector("season-painter")!.departmentId).toBe("restaurant");
    await expect.poll(() => years).toEqual(["2026"]);
  });

  it("hands the year view its model, the season writes and the area writes, and every special day once a season dialog opens", async () => {
    const { el, view, years, listReads } = await yearMount(
      "/manage/opening-hours/view/year/year/2027",
    );
    await expect.poll(() => view()?.model?.year).toBe(2027);
    expect(view()!.api).toBe(el.api);
    expect(view()!.readOnly).toBe(false);
    const chips = view()!.shadowRoot!.querySelector("season-chips")!;
    expect(chips.clockRevision).toBe(4);
    el.api.rereadWithSpecialDays();
    await expect.poll(() => years).toEqual(["2027", "2027"]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(listReads()).toEqual([]);
    expect(view()!.specialDays).toEqual([]);
    chips
      .shadowRoot!.querySelector<HTMLElement>("[data-season=all] [data-test=season-edit]")!
      .click();
    await expect
      .poll(() => view()!.specialDays)
      .toEqual([
        { id: "annual/day", name: "Anniversary" },
        { id: "later", name: "Later fair" },
      ]);
    expect(listReads()).toEqual([{ passive: true }]);
  });

  async function heldMount(address: string, hold: (path: string) => boolean) {
    vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
    history.replaceState(null, "", address);
    const held: { path: string; release: (value: unknown) => void }[] = [];
    const el = await mount((async (path: string) => {
      const asked = /\/opening-hours\/year\?year=(\d+)$/.exec(path);
      const answer = asked
        ? yearModel(Number(asked[1]))
        : path.endsWith("/special-days")
          ? []
          : model();
      if (!hold(path)) return answer;
      return new Promise<unknown>((release) => held.push({ path, release }));
    }) as DashboardRequest);
    const view = () => el.shadowRoot!.querySelector("opening-hours-year")!;
    return { el, view, held };
  }

  it.each(["slow", "instant"])(
    "keeps keyboard focus on › while the next year loads (%s read)",
    async (speed) => {
      const { el, view, held } = await heldMount(
        "/manage/opening-hours/view/year/year/2027",
        (path) => speed === "slow" && path.endsWith("year=2028"),
      );
      await expect.poll(() => view().model?.year).toBe(2027);
      const next = () => view().shadowRoot!.querySelector<HTMLElement>("[data-test=next-year]")!;
      const focused = () => view().shadowRoot!.activeElement?.getAttribute("data-test");
      next().focus();
      expect(focused()).toBe("next-year");
      next().click();
      await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/year/year/2028");
      if (speed === "slow") {
        await expect.poll(() => held.length).toBe(1);
        await el.updateComplete;
        await view().updateComplete;
        expect(focused()).toBe("next-year");
        held[0]!.release(yearModel(2028));
      }
      await expect.poll(() => view().model?.year).toBe(2028);
      await view().updateComplete;
      expect(el.shadowRoot!.activeElement).toBe(view());
      expect(focused()).toBe("next-year");
    },
  );

  it("steps ‹ and › from the year asked for while that year is still loading", async () => {
    const { view } = await heldMount("/manage/opening-hours/view/year/year/2027", (path) =>
      /year=20(28|29)$/.test(path),
    );
    await expect.poll(() => view().model?.year).toBe(2027);
    const press = (test: string) =>
      userEvent.click(view().shadowRoot!.querySelector<HTMLElement>(`[data-test=${test}]`)!);
    await press("next-year");
    await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/year/year/2028");
    await press("next-year");
    await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/year/year/2029");
    expect(view().model?.year).toBe(2027);
    await press("previous-year");
    await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/year/year/2028");
  });

  it("stops drawing the last year when the next year cannot be read", async () => {
    vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
    history.replaceState(null, "", "/manage/opening-hours/view/year/year/2027");
    const el = await mount((async (path: string) => {
      const asked = /\/opening-hours\/year\?year=(\d+)$/.exec(path);
      if (asked?.[1] === "2028") throw { code: "connection.failed" };
      if (asked) return yearModel(Number(asked[1]));
      return path.endsWith("/special-days") ? [] : model();
    }) as DashboardRequest);
    const view = () => el.shadowRoot!.querySelector("opening-hours-year")!;
    await expect.poll(() => view().model?.year).toBe(2027);
    view().shadowRoot!.querySelector<HTMLElement>("[data-test=next-year]")!.click();
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=year-read-error]")?.textContent)
      .toBe("Opening hours could not be loaded. It will be tried again.");
    await el.updateComplete;
    expect(view().model).toBeUndefined();
    expect(view().shadowRoot!.querySelector("table, [data-test=year]")).toBeNull();
  });

  it("applies only the newest special-day list when an older read answers last", async () => {
    const { view, held } = await heldMount("/manage/opening-hours/view/year/year/2027", (path) =>
      path.endsWith("/special-days"),
    );
    await expect.poll(() => view().model?.year).toBe(2027);
    const chips = view().shadowRoot!.querySelector("season-chips")!;
    const open = () =>
      chips
        .shadowRoot!.querySelector<HTMLElement>("[data-season=all] [data-test=season-edit]")!
        .click();
    open();
    await expect.poll(() => held.length).toBe(1);
    await chips.updateComplete;
    chips
      .shadowRoot!.querySelector("season-dialog")!
      .dispatchEvent(new CustomEvent("season-close"));
    await chips.updateComplete;
    open();
    await expect.poll(() => held.length).toBe(2);
    const list = (id: string, name: string) => [{ id, name, repeatsYearly: true, dates: [] }];
    held[1]!.release(list("new", "New fair"));
    await expect.poll(() => view().specialDays).toEqual([{ id: "new", name: "New fair" }]);
    held[0]!.release(list("old", "Old fair"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await view().updateComplete;
    expect(view().specialDays).toEqual([{ id: "new", name: "New fair" }]);
  });

  it("drops the year from the address when a tab is chosen, as a month's name does", async () => {
    const { el, view } = await yearMount("/manage/opening-hours/view/year/year/2027?keep=yes");
    await expect.poll(() => view()?.model?.year).toBe(2027);
    tabs(el).dispatchEvent(new CustomEvent("wt-tab-change", { detail: { value: "year" } }));
    await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/year");
    expect(location.search).toBe("?keep=yes");
    await expect.poll(() => view()?.model?.year).toBe(2026);
  });

  it("opens the Year from an old Calendar address", async () => {
    const { el, view } = await yearMount("/manage/opening-hours/view/calendar");
    expect(tabs(el).value).toBe("year");
    await expect.poll(() => view()?.model?.year).toBe(2026);
  });

  it("opens the Year from an old Calendar address that names a month", async () => {
    const { el, view, years } = await yearMount(
      "/manage/opening-hours/view/calendar/month/2027-02",
    );
    expect(tabs(el).value).toBe("year");
    await expect.poll(() => view()?.model?.year).toBe(2026);
    expect(years).toEqual(["2026"]);
  });

  it.each(["0000", "9999"])(
    "opens the current year when the address names the out-of-range year %s",
    async (year) => {
      const { view, years } = await yearMount(`/manage/opening-hours/view/year/year/${year}`);
      await expect.poll(() => view()?.model?.year).toBe(2026);
      expect(years).toEqual(["2026"]);
    },
  );

  it("passes read-only to the year view", async () => {
    const { view } = await yearMount("/manage/opening-hours/view/year", true);
    await expect.poll(() => view()?.model).toBeDefined();
    expect(view()!.readOnly).toBe(true);
  });

  it("steps years through the address, reads each, and falls back to the current year on a bad one", async () => {
    const { view, years } = await yearMount("/manage/opening-hours/view/year/year/2027?keep=yes");
    await expect.poll(() => view()?.model?.year).toBe(2027);
    const shown = view()!;
    shown.shadowRoot!.querySelector<HTMLElement>("[data-test=next-year]")!.click();
    await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/year/year/2028");
    expect(location.search).toBe("?keep=yes");
    await expect.poll(() => view()?.model?.year).toBe(2028);
    view()!.shadowRoot!.querySelector<HTMLElement>("[data-test=previous-year]")!.click();
    await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/year/year/2027");
    await expect.poll(() => view()?.model?.year).toBe(2027);
    history.replaceState(null, "", "/manage/opening-hours/view/year/year/20x7");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await expect.poll(() => view()?.model?.year).toBe(2026);
    expect(view()).toBe(shown);
    expect(years).toEqual(["2027", "2028", "2027", "2026"]);
  });

  it("opens that month when a month's name is chosen", async () => {
    const { el, view } = await yearMount("/manage/opening-hours/view/year/year/2027");
    await expect.poll(() => view()?.model?.year).toBe(2027);
    view()!.shadowRoot!.querySelectorAll<HTMLElement>("[data-test=month-name]")[2]!.click();
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/month/month/2027-03");
    await expect
      .poll(() => el.shadowRoot!.querySelector("opening-hours-month")?.month)
      .toBe("2027-03");
    expect(tabs(el).value).toBe("year");
  });

  it("re-reads the year and the opening hours after a season change", async () => {
    const { view, years, openingReads } = await yearMount("/manage/opening-hours/view/year");
    await expect.poll(() => view()?.model?.year).toBe(2026);
    const before = openingReads();
    view()!
      .shadowRoot!.querySelector("season-chips")!
      .dispatchEvent(new CustomEvent("season-changed", { bubbles: true, composed: true }));
    await expect.poll(() => years).toEqual(["2026", "2026"]);
    await expect.poll(openingReads).toBe(before + 1);
  });

  it("re-reads the year after the year view saves the holiday area", async () => {
    const { view, years, writes } = await yearMount("/manage/opening-hours/view/year");
    await expect.poll(() => view()?.model?.year).toBe(2026);
    await view()!.updateComplete;
    view()!
      .shadowRoot!.querySelector("[name=holidayArea]")!
      .dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "gir" }, bubbles: true, composed: true }),
      );
    await expect
      .poll(() => writes)
      .toEqual([["/management-api/venue-service/holiday-area", "PUT", { areaKey: "gir" }]]);
    await expect.poll(() => years).toEqual(["2026", "2026"]);
  });

  it("says when the year cannot be read, and clears it once a reread succeeds", async () => {
    const { el, view } = await yearMount("/manage/opening-hours/view/year", false, 1);
    const alert = () =>
      el.shadowRoot!.querySelector("[slot=year] [data-test=year-read-error]")?.textContent;
    await expect.poll(alert).toBe("Opening hours could not be loaded. It will be tried again.");
    expect(view()!.model).toBeUndefined();
    expect(view()!.shadowRoot!.querySelector("table, [data-test=year]")).toBeNull();
    el.api.rereadWithSpecialDays();
    await expect.poll(() => view()?.model?.year).toBe(2026);
    expect(alert()).toBeUndefined();
  });

  it("+ Special day opens an empty special-day painter", async () => {
    const { el, view, writes } = await yearMount("/manage/opening-hours/view/year");
    await expect.poll(() => view()?.model?.year).toBe(2026);
    view()!.shadowRoot!.querySelector<HTMLElement>("[data-test=add-special-day]")!.click();
    const form = await specialPainter(el);
    expect(form.specialDayId).toBeNull();
    expect(form.date).toBeNull();
    expect(
      form.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-input"]>("wt-input[name=name]")!
        .value,
    ).toBe("");
    expect(writes).toEqual([]);
  });
});

describe("Month view", () => {
  const company: SpecialDayDetail = {
    id: "company",
    name: "Company dinners",
    repeatsYearly: false,
    dates: [{ date: "2026-12-14", closedAllDay: false }],
    paint: [],
    zonePaint: [],
  };
  async function monthMount(
    address: string,
    readOnly = false,
    adjust: (data: OpeningHoursModel) => void = () => {},
  ) {
    vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
    history.replaceState(null, "", address);
    const { DEPARTMENTS, monthModel } = await import("../testing/opening-hours-month-fixture.js");
    const data: OpeningHoursModel = { ...model(), departments: structuredClone(DEPARTMENTS) };
    adjust(data);
    const months: string[] = [];
    const writes: unknown[][] = [];
    let failures = 0;
    const el = await mount(
      (async (path: string, method: string, body: unknown) => {
        if (method !== "GET") {
          writes.push([path, method, body]);
          return savedDay(path, method, body);
        }
        const asked = /\/opening-hours\/month\?month=([\d-]+)$/.exec(path);
        if (asked) {
          months.push(asked[1]!);
          if (failures-- > 0) throw { code: "connection.failed" };
          return monthModel({ month: asked[1]! });
        }
        if (path.endsWith("/special-days"))
          return [
            { id: "company", name: "Company dinners", repeatsYearly: false, dates: company.dates },
            { id: "xmas", name: "Christmas Day", repeatsYearly: true, dates: [] },
          ];
        if (path.endsWith("/special-days/company")) return structuredClone(company);
        if (path.includes("/opening-hours/year?")) return yearRead(2026);
        return structuredClone(data);
      }) as DashboardRequest,
      readOnly,
    );
    const view = () => el.shadowRoot!.querySelector("opening-hours-month");
    return {
      el,
      view,
      data,
      months,
      writes,
      failNext: (count: number) => (failures = count),
    };
  }
  const tabs = (el: Screen) =>
    el.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-tabs"]>("wt-tabs")!;
  const dateButton = (view: HTMLElementTagNameMap["opening-hours-month"], date: string) =>
    view.shadowRoot!.querySelector<HTMLElement>(`td[data-date="${date}"] button`)!;
  async function shown(
    view: () => HTMLElementTagNameMap["opening-hours-month"] | null,
    month = "2026-12",
  ) {
    await expect.poll(() => view()?.model?.month).toBe(month);
    await view()!.updateComplete;
    return view()!;
  }
  async function ordinary(el: Screen, view: HTMLElementTagNameMap["opening-hours-month"]) {
    dateButton(view, "2026-12-10").click();
    await expect.poll(() => el.shadowRoot!.querySelector("ordinary-date-dialog")?.open).toBe(true);
    const dialog = el.shadowRoot!.querySelector("ordinary-date-dialog")!;
    await dialog.updateComplete;
    return dialog;
  }

  it("draws the month the address names from that month's read, under the Year tab", async () => {
    const { el, view, data, months } = await monthMount(
      "/manage/opening-hours/view/month/month/2026-12",
    );
    const month = await shown(view);
    expect(months).toEqual(["2026-12"]);
    expect(month.month).toBe("2026-12");
    expect(month.departments).toEqual(data.departments);
    expect(month.departmentId).toBe("");
    expect(month.readOnly).toBe(false);
    expect(month.api).toBe(el.api);
    expect(tabs(el).value).toBe("year");
    expect(tabs(el).items.map((item) => item.key)).toEqual(["year"]);
    expect(el.shadowRoot!.querySelector("[slot=year] opening-hours-month")).toBe(month);
    expect(el.shadowRoot!.querySelector("opening-hours-year")).toBeNull();
    expect(el.shadowRoot!.querySelector("[name=departmentId]")).toBeNull();
  });

  it.each([
    ["no month", "/manage/opening-hours/view/month"],
    ["a month that is not one", "/manage/opening-hours/view/month/month/2026-13"],
    ["the first year's January", "/manage/opening-hours/view/month/month/0100-01"],
  ])("opens the venue's current month when the address names %s", async (_, address) => {
    const { view, months } = await monthMount(address);
    await shown(view, "2026-10");
    expect(months).toEqual(["2026-10"]);
  });

  it("steps months through the address, goes back to the year, and writes the chosen department", async () => {
    const { view, months } = await monthMount(
      "/manage/opening-hours/view/month/month/2026-12?keep=yes",
    );
    await shown(view);
    view()!.shadowRoot!.querySelector<HTMLElement>("[data-test=next-month]")!.click();
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/month/month/2027-01");
    expect(location.search).toBe("?keep=yes");
    await shown(view, "2027-01");
    view()!.shadowRoot!.querySelector<HTMLElement>("[data-test=previous-month]")!.click();
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/month/month/2026-12");
    await shown(view);
    view()!
      .shadowRoot!.querySelector("[name=departmentId]")!
      .dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "bar" }, bubbles: true, composed: true }),
      );
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/month/department/bar/month/2026-12");
    await expect.poll(() => view()?.departmentId).toBe("bar");
    view()!
      .shadowRoot!.querySelector("[name=departmentId]")!
      .dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "all" }, bubbles: true, composed: true }),
      );
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/month/month/2026-12");
    await expect.poll(() => view()?.departmentId).toBe("");
    view()!.shadowRoot!.querySelector<HTMLElement>("[data-test=year-back]")!.click();
    await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/year/year/2026");
    await expect.poll(view).toBeNull();
    expect(months).toEqual(["2026-12", "2027-01", "2026-12"]);
  });

  it("says when the month cannot be read, and clears it once a reread succeeds", async () => {
    vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
    const { el, view, failNext } = await monthMount("/manage/opening-hours/view/year");
    failNext(1);
    tabs(el).dispatchEvent(new CustomEvent("wt-tab-change", { detail: { value: "year" } }));
    history.replaceState(null, "", "/manage/opening-hours/view/month/month/2026-12");
    window.dispatchEvent(new PopStateEvent("popstate"));
    const alert = () =>
      el.shadowRoot!.querySelector("[slot=year] [data-test=month-read-error]")?.textContent;
    await expect.poll(alert).toBe("Opening hours could not be loaded. It will be tried again.");
    expect(view()!.model).toBeUndefined();
    el.api.rereadWithSpecialDays();
    await expect.poll(() => view()?.model?.month).toBe("2026-12");
    expect(alert()).toBeUndefined();
  });

  it("opens the browser's current month when the venue's clock cannot be read", async () => {
    const { view, months } = await monthMount("/manage/opening-hours/view/month", false, (data) => {
      data.clockReadable = false;
      vi.setSystemTime(new Date("2027-03-05T12:00:00Z"));
    });
    await shown(view, "2027-03");
    expect(months).toEqual(["2027-03"]);
  });

  it("takes the browser's own month, not UTC's, when the venue's clock cannot be read", async () => {
    // Fails only in a browser east of UTC: there this moment is still February in UTC; at UTC both read March.
    const { view, months } = await monthMount("/manage/opening-hours/view/month", false, (data) => {
      data.clockReadable = false;
      vi.setSystemTime(new Date(2027, 2, 1, 0, 30));
    });
    await shown(view, "2027-03");
    expect(months).toEqual(["2027-03"]);
  });

  it("keeps the month drawn beside the message when a later reread of it fails", async () => {
    const { el, view, failNext } = await monthMount(
      "/manage/opening-hours/view/month/month/2026-12",
    );
    await shown(view);
    failNext(1);
    el.api.rereadWithSpecialDays();
    const alert = () =>
      el.shadowRoot!.querySelector("[slot=year] [data-test=month-read-error]")?.textContent;
    await expect.poll(alert).toBe("Opening hours could not be loaded. It will be tried again.");
    expect(view()!.model?.month).toBe("2026-12");
  });

  it.each([
    ["Edit the week", "edit-week"],
    ["Make this a special day", "make-special"],
  ])(
    "does nothing with %s when the screen has gone before the dialog sends it",
    async (_, test) => {
      const { el, view, writes } = await monthMount(
        "/manage/opening-hours/view/month/month/2026-12",
      );
      const dialog = await ordinary(el, await shown(view));
      const sent = new Promise((resolve) =>
        dialog.addEventListener(
          test === "edit-week" ? "ordinary-date-edit-week" : "ordinary-date-make-special",
          resolve,
          { once: true },
        ),
      );
      dialog.shadowRoot!.querySelector<HTMLElement>(`[data-test=${test}]`)!.click();
      el.remove();
      await sent;
      await el.updateComplete;
      expect(location.pathname).toBe("/manage/opening-hours/view/month/month/2026-12");
      expect(el.shadowRoot!.querySelector("special-day-painter")).toBeNull();
      expect(writes).toEqual([]);
    },
  );

  it("does nothing with Add to a special day when the screen has gone before the dialog sends it", async () => {
    const { el, view, writes } = await monthMount("/manage/opening-hours/view/month/month/2026-12");
    const dialog = await ordinary(el, await shown(view));
    await expect.poll(() => dialog.specialDays.length).toBe(2);
    dialog.shadowRoot!.querySelector("[name=specialDayId]")!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "company" },
        bubbles: true,
        composed: true,
      }),
    );
    await dialog.updateComplete;
    const sent = new Promise((resolve) =>
      dialog.addEventListener("ordinary-date-add-to-special", resolve, { once: true }),
    );
    dialog.shadowRoot!.querySelector<HTMLElement>("[data-test=add-to-special]")!.click();
    el.remove();
    await sent;
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("special-day-painter")).toBeNull();
    expect(location.pathname).toBe("/manage/opening-hours/view/month/month/2026-12");
    expect(writes).toEqual([]);
  });

  it("an ordinary date opens its dialog with the date's season and the venue's special days", async () => {
    const { el, view } = await monthMount("/manage/opening-hours/view/month/month/2026-12");
    const dialog = await ordinary(el, await shown(view));
    expect(dialog.date).toBe("2026-12-10");
    expect(dialog.season).toEqual({ id: "winter", name: "Winter" });
    expect(dialog.tint).toBe("2");
    await expect
      .poll(() => dialog.specialDays)
      .toEqual([
        { id: "company", name: "Company dinners" },
        { id: "xmas", name: "Christmas Day" },
      ]);
    expect(dialog.returnTo!()).toBe(dateButton(view()!, "2026-12-10"));
    dialog.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel");
    await expect.poll(() => el.shadowRoot!.querySelector("ordinary-date-dialog")).toBeNull();
  });

  const withWinter = (data: OpeningHoursModel) => {
    data.seasons = [
      { id: "autumn", name: "Autumn", startsOn: "09-01" },
      { id: "winter", name: "Winter", startsOn: "12-01" },
    ];
    data.currentSeasonId = "autumn";
  };
  it("Edit the Winter week opens the season painter on that season, keeping the month's department", async () => {
    const { el, view } = await monthMount(
      "/manage/opening-hours/view/month/department/bar/month/2026-12",
      false,
      withWinter,
    );
    const dialog = await ordinary(el, await shown(view));
    dialog.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-week]")!.click();
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/season/season/winter/department/bar");
    await expect
      .poll(() => el.shadowRoot!.querySelector("season-painter")?.seasonId)
      .toBe("winter");
    expect(el.shadowRoot!.querySelector("season-painter")!.departmentId).toBe("bar");
    expect(el.shadowRoot!.querySelector("opening-hours-month")).toBe(view());
    expect(el.shadowRoot!.querySelector("ordinary-date-dialog")?.open ?? false).toBe(false);
  });

  it("Edit the Winter week carries a department chosen in the month's picker, and none after All departments", async () => {
    const { el, view } = await monthMount(
      "/manage/opening-hours/view/month/month/2026-12",
      false,
      withWinter,
    );
    const pick = async (value: string, path: string) => {
      view()!
        .shadowRoot!.querySelector("[name=departmentId]")!
        .dispatchEvent(
          new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
        );
      await expect.poll(() => location.pathname).toBe(path);
    };
    await pick("bar", "/manage/opening-hours/view/month/department/bar/month/2026-12");
    let dialog = await ordinary(el, await shown(view));
    dialog.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-week]")!.click();
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/season/season/winter/department/bar");
    history.replaceState(null, "", "/manage/opening-hours/view/month/department/bar/month/2026-12");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await shown(view);
    await pick("all", "/manage/opening-hours/view/month/month/2026-12");
    dialog = await ordinary(el, await shown(view));
    dialog.shadowRoot!.querySelector<HTMLElement>("[data-test=edit-week]")!.click();
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/season/season/winter/department/rest");
    await expect
      .poll(() => el.shadowRoot!.querySelector("season-painter")?.departmentId)
      .toBe("rest");
  });

  it("Make this a special day opens a new special day holding the date", async () => {
    const { el, view, writes } = await monthMount("/manage/opening-hours/view/month/month/2026-12");
    const dialog = await ordinary(el, await shown(view));
    dialog.shadowRoot!.querySelector<HTMLElement>("[data-test=make-special]")!.click();
    const form = await specialPainter(el);
    expect(form.specialDayId).toBeNull();
    expect(form.date).toBe("2026-12-10");
    expect(writes).toEqual([]);
  });

  it("Add to a special day opens that special day with the date added, written only on Save", async () => {
    const { el, view, writes } = await monthMount("/manage/opening-hours/view/month/month/2026-12");
    const dialog = await ordinary(el, await shown(view));
    await expect.poll(() => dialog.specialDays.length).toBe(2);
    dialog.shadowRoot!.querySelector("[name=specialDayId]")!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "company" },
        bubbles: true,
        composed: true,
      }),
    );
    await dialog.updateComplete;
    dialog.shadowRoot!.querySelector<HTMLElement>("[data-test=add-to-special]")!.click();
    const form = await specialPainter(el);
    expect(form.specialDayId).toBe("company");
    await expect.poll(() => painterChips(form)).toEqual(["2026-12-10", "2026-12-14"]);
    const save = painterSave(form);
    expect(save.disabled).toBe(false);
    expect(writes).toEqual([]);
    save.click();
    await expect
      .poll(() => writes)
      .toEqual([
        [
          "/management-api/venue-service/special-days/company",
          "PUT",
          {
            expectedClockRevision: 0,
            name: "Company dinners",
            repeatsYearly: false,
            dates: [
              { date: "2026-12-10", closedAllDay: false },
              { date: "2026-12-14", closedAllDay: false },
            ],
          },
        ],
      ]);
    await expect.poll(() => painterSave(form).disabled).toBe(true);
  });

  it("a special date opens the painter on its special day, over the month", async () => {
    const { el, view } = await monthMount("/manage/opening-hours/view/month/month/2026-12");
    dateButton(await shown(view), "2026-12-14").click();
    const form = await specialPainter(el);
    expect(form.specialDayId).toBe("company");
    expect(location.pathname).toBe("/manage/opening-hours/view/special-day/special-day/company");
    expect(view()?.model?.month).toBe("2026-12");
    expect(tabs(el).value).toBe("year");
  });

  it.each([
    ["names no date", "/manage/opening-hours/view/date"],
    ["names a date that is not one", "/manage/opening-hours/view/date/date/2026-02-30"],
  ])("opens the Month of the venue's business day when an old date view %s", async (_, address) => {
    const { view, months } = await monthMount(address);
    await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/month");
    await expect.poll(() => view()?.month).toBe("2026-10");
    expect(months).toEqual(["2026-10"]);
  });

  it("passes read-only to the month and opens nothing from it", async () => {
    const { el, view } = await monthMount("/manage/opening-hours/view/month/month/2026-12", true);
    const month = await shown(view);
    expect(month.readOnly).toBe(true);
    month.dispatchEvent(
      new CustomEvent("ordinary-date-open", {
        detail: { date: "2026-12-10", seasonId: "winter", returnTo: () => null },
        bubbles: true,
        composed: true,
      }),
    );
    month.dispatchEvent(
      new CustomEvent("special-day-action", {
        detail: {
          kind: "open",
          date: "2026-12-14",
          specialDay: company,
          holidays: [],
          returnTo: () => null,
        },
        bubbles: true,
        composed: true,
      }),
    );
    await el.updateComplete;
    expect(el.shadowRoot!.querySelector("ordinary-date-dialog")?.open ?? false).toBe(false);
    expect(el.shadowRoot!.querySelector("special-day-painter")).toBeNull();
    expect(location.pathname).toBe("/manage/opening-hours/view/month/month/2026-12");
  });
});

describe("no Day tab and no real week", () => {
  it("offers no Real week switch and ignores a week in the address", async () => {
    history.replaceState(null, "", "/manage/opening-hours/view/week?week=2026-10-12");
    const el = await mount();
    await expect.poll(() => el.shadowRoot!.querySelector("season-painter")).not.toBeNull();
    expect(location.pathname).toBe("/manage/opening-hours/view/season/department/restaurant");
    expect(el.shadowRoot!.querySelector("[name=realWeek]")).toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=previous-week]")).toBeNull();
    expect(location.search).toBe("?week=2026-10-12");
  });

  it("opens the Year when the address names only a week", async () => {
    vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
    history.replaceState(null, "", "/manage/opening-hours?week=2026-10-12");
    const el = await mount((async (path: string) =>
      path.includes("/opening-hours/year?")
        ? yearRead(2026)
        : structuredClone(model())) as DashboardRequest);
    await expect.poll(() => el.shadowRoot!.querySelector("opening-hours-year")).not.toBeNull();
  });

  it("treats the retired Day view as an unknown view", async () => {
    history.replaceState(null, "", "/manage/opening-hours/view/day/date/2026-12-25");
    const el = await mount();
    await expect.poll(() => el.shadowRoot!.querySelector("season-painter")).not.toBeNull();
    expect(
      el
        .shadowRoot!.querySelector<HTMLElementTagNameMap["wt-tabs"]>("wt-tabs")!
        .items.map((item) => item.key),
    ).toEqual(["year"]);
  });
});

it("treats the retired Periods view as an unknown view", async () => {
  history.replaceState(null, "", "/manage/opening-hours/view/periods");
  const el = await mount();
  await expect.poll(() => el.shadowRoot!.querySelector("season-painter")).not.toBeNull();
  expect(
    el
      .shadowRoot!.querySelector<HTMLElementTagNameMap["wt-tabs"]>("wt-tabs")!
      .items.map((item) => item.key),
  ).toEqual(["year"]);
});

describe("the Calendar's module views", () => {
  registerCatalogue({
    en: { "test.view.staffing": "Staffing", "test.view.rota": "Rota" },
    es: { "test.view.staffing": "Personal", "test.view.rota": "Turnos" },
  });
  type Rendered = { host: CalendarViewHost; readOnly: boolean | undefined };
  let hostsSeen: Record<string, CalendarViewHost[]>;
  let renders: Rendered[];
  beforeEach(() => {
    hostsSeen = {};
    renders = [];
  });
  function stubView(id: string, order: number): DashboardCalendarView {
    return {
      id,
      labelKey: `test.view.${id}`,
      order,
      requiresPermission: `${id}.write`,
      create: (_ctx, host) => {
        (hostsSeen[id] ??= []).push(host);
        return {
          render: (readOnly) => {
            renders.push({ host, readOnly });
            return html`<p data-test="stub-${id}">${host.month} ${JSON.stringify(host.params)}</p>`;
          },
        };
      },
    };
  }
  const staffing = stubView("staffing", 10);
  const rota = stubView("rota", 20);
  async function mountCalendar(
    views: { view: DashboardCalendarView; canWrite: boolean }[] = [
      { view: staffing, canWrite: true },
      { view: rota, canWrite: true },
    ],
  ) {
    const el = document.createElement("dashboard-opening-hours-screen") as Screen & {
      calendar?: unknown;
    };
    const request = (async (path: string) =>
      path.includes("/opening-hours/year?")
        ? yearRead(2026)
        : path.includes("/opening-hours/month?")
          ? { days: [] }
          : structuredClone(model())) as DashboardRequest;
    el.api = new OpeningHoursApi(withSeasonDays(request));
    el.calendar = { ctx: { request }, views };
    applyTokens(el);
    hosts.push(el);
    document.body.append(el);
    await expect.poll(() => el.shadowRoot?.querySelector("h1")).not.toBeNull();
    await el.updateComplete;
    return el;
  }
  const switchLabels = (el: Screen) =>
    [...el.shadowRoot!.querySelectorAll("[data-test=calendar-switch] label")].map((label) =>
      label.textContent!.trim(),
    );
  const choose = (el: Screen, value: string) =>
    userEvent.click(
      el.shadowRoot!.querySelector<HTMLInputElement>(
        `[data-test=calendar-switch] input[value="${value}"]`,
      )!,
    );
  const checked = (el: Screen) =>
    el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=calendar-switch] input:checked")
      ?.value;

  it("draws no switch and titles the page Calendar when no module view is given", async () => {
    const el = await mountCalendar([]);
    await expect.poll(() => el.shadowRoot!.querySelector("wt-tabs")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=calendar-switch]")).toBeNull();
    expect(el.shadowRoot!.querySelector("h1")!.textContent).toBe("Calendar");
  });

  it("offers Opening hours first, then each view, with Opening hours chosen", async () => {
    const el = await mountCalendar();
    await expect.poll(() => el.shadowRoot!.querySelector("wt-tabs")).not.toBeNull();
    expect(switchLabels(el)).toEqual(["Opening hours", "Staffing", "Rota"]);
    expect(checked(el)).toBe("hours");
    expect(el.shadowRoot!.querySelector("[data-test=stub-staffing]")).toBeNull();
  });

  it("shows a chosen view in place of the own tabs, in the month holding today's business date", async () => {
    vi.setSystemTime(new Date("2026-12-15T12:00:00Z"));
    const el = await mountCalendar();
    await expect.poll(() => el.shadowRoot!.querySelector("wt-tabs")).not.toBeNull();
    await choose(el, "staffing");
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=stub-staffing]"))
      .not.toBeNull();
    expect(el.shadowRoot!.querySelector("wt-tabs")).toBeNull();
    expect(location.pathname).toBe("/manage/opening-hours/view/staffing");
    expect(checked(el)).toBe("staffing");
    expect(hostsSeen["staffing"]![0]!.month).toBe("2026-12");
    expect(hostsSeen["staffing"]![0]!.params).toEqual({});
  });

  it("carries the shown month from Opening hours' month into the view, and back", async () => {
    history.replaceState(null, "", "/manage/opening-hours/view/month/month/2027-03");
    const el = await mountCalendar();
    await expect.poll(() => el.shadowRoot!.querySelector("opening-hours-month")).not.toBeNull();
    await choose(el, "staffing");
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/staffing/month/2027-03");
    expect(hostsSeen["staffing"]![0]!.month).toBe("2027-03");
    await choose(el, "hours");
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/month/month/2027-03");
    await expect.poll(() => el.shadowRoot!.querySelector("opening-hours-month")).not.toBeNull();
    expect(checked(el)).toBe("hours");
  });

  it("moves to another address through host.open and hands the view its params", async () => {
    history.replaceState(null, "", "/manage/opening-hours/view/staffing");
    const el = await mountCalendar();
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=stub-staffing]"))
      .not.toBeNull();
    const host = hostsSeen["staffing"]![0]!;
    host.open("staffing", { week: "2026-11-30" });
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/staffing/week/2026-11-30");
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=stub-staffing]")!.textContent)
      .toContain('{"week":"2026-11-30"}');
    expect(host.params).toEqual({ week: "2026-11-30" });
    expect(hostsSeen["staffing"]).toHaveLength(1);
    host.open("rota", { week: "2026-12-07" });
    await expect.poll(() => el.shadowRoot!.querySelector("[data-test=stub-rota]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=stub-staffing]")).toBeNull();
    expect(host.params).toEqual({});
    host.open("hours", {});
    await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/year");
    await expect.poll(() => el.shadowRoot!.querySelector("wt-tabs")).not.toBeNull();
    history.back();
    await expect.poll(() => el.shadowRoot!.querySelector("[data-test=stub-rota]")).not.toBeNull();
    expect(hostsSeen["rota"]).toHaveLength(1);
  });

  it("opens the view an address names on load, with its params", async () => {
    history.replaceState(null, "", "/manage/opening-hours/view/staffing/week/2026-11-30");
    const el = await mountCalendar();
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=stub-staffing]"))
      .not.toBeNull();
    expect(hostsSeen["staffing"]![0]!.params).toEqual({ week: "2026-11-30" });
    expect(checked(el)).toBe("staffing");
    expect(el.shadowRoot!.querySelector("wt-tabs")).toBeNull();
  });

  it("hands a person who may read but not write the view canWrite false and a read-only render", async () => {
    history.replaceState(null, "", "/manage/opening-hours/view/staffing");
    const el = await mountCalendar([{ view: staffing, canWrite: false }]);
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=stub-staffing]"))
      .not.toBeNull();
    expect(hostsSeen["staffing"]![0]!.canWrite).toBe(false);
    expect(renders.at(-1)!.readOnly).toBe(true);
  });

  it("gives a writer canWrite true and an editable render", async () => {
    history.replaceState(null, "", "/manage/opening-hours/view/staffing");
    const el = await mountCalendar([{ view: staffing, canWrite: true }]);
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=stub-staffing]"))
      .not.toBeNull();
    expect(hostsSeen["staffing"]![0]!.canWrite).toBe(true);
    expect(renders.at(-1)!.readOnly).toBe(false);
    (el as Screen & { calendar?: unknown }).calendar = {
      ctx: { request: async () => ({}) },
      views: [],
    };
    expect(hostsSeen["staffing"]![0]!.canWrite).toBe(false);
  });

  it("never shows a view the person may not read, not even from its address", async () => {
    history.replaceState(null, "", "/manage/opening-hours/view/staffing");
    const el = await mountCalendar([{ view: rota, canWrite: true }]);
    await expect.poll(() => el.shadowRoot!.querySelector("wt-tabs")).not.toBeNull();
    expect(switchLabels(el)).toEqual(["Opening hours", "Rota"]);
    expect(el.shadowRoot!.querySelector("[data-test=stub-staffing]")).toBeNull();
    expect(hostsSeen["staffing"]).toBeUndefined();
  });

  it("ignores host.open naming a view it was not given", async () => {
    history.replaceState(null, "", "/manage/opening-hours/view/staffing");
    const el = await mountCalendar([{ view: staffing, canWrite: true }]);
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=stub-staffing]"))
      .not.toBeNull();
    hostsSeen["staffing"]![0]!.open("rota", {});
    await el.updateComplete;
    expect(location.pathname).toBe("/manage/opening-hours/view/staffing");
  });

  it("carries a view's month to the next view the switch chooses", async () => {
    history.replaceState(null, "", "/manage/opening-hours/view/staffing/month/2027-03");
    const el = await mountCalendar();
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=stub-staffing]"))
      .not.toBeNull();
    await choose(el, "rota");
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/rota/month/2027-03");
    expect(hostsSeen["rota"]![0]!.month).toBe("2027-03");
    await choose(el, "staffing");
    await expect
      .poll(() => location.pathname)
      .toBe("/manage/opening-hours/view/staffing/month/2027-03");
  });

  it("returns from a view with no month to Opening hours' year", async () => {
    history.replaceState(null, "", "/manage/opening-hours/view/staffing/week/2026-11-30");
    const el = await mountCalendar();
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=stub-staffing]"))
      .not.toBeNull();
    await choose(el, "hours");
    await expect.poll(() => location.pathname).toBe("/manage/opening-hours/view/year");
    await expect.poll(() => el.shadowRoot!.querySelector("opening-hours-year")).not.toBeNull();
  });

  it("leaves out a pair whose value is not a valid escape, and keeps the rest", async () => {
    history.replaceState(
      null,
      "",
      "/manage/opening-hours/view/staffing/area/%E0%A4%A/week/2026-11-30",
    );
    const el = await mountCalendar();
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=stub-staffing]"))
      .not.toBeNull();
    expect(hostsSeen["staffing"]![0]!.params).toEqual({ week: "2026-11-30" });
  });

  it("round-trips a value the path has to escape", async () => {
    history.replaceState(null, "", "/manage/opening-hours/view/staffing");
    const el = await mountCalendar();
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=stub-staffing]"))
      .not.toBeNull();
    const host = hostsSeen["staffing"]![0]!;
    host.open("staffing", { area: "station:a/b", week: "" });
    await expect.poll(() => host.params).toEqual({ area: "station:a/b", week: "" });
  });

  it("takes the browser's month when the venue's clock cannot be read", async () => {
    vi.setSystemTime(new Date("2027-05-15T12:00:00Z"));
    history.replaceState(null, "", "/manage/opening-hours/view/staffing");
    const unreadable = model();
    unreadable.clockReadable = false;
    const el = document.createElement("dashboard-opening-hours-screen") as Screen & {
      calendar?: unknown;
    };
    const request = (async () => structuredClone(unreadable)) as DashboardRequest;
    el.api = new OpeningHoursApi(request);
    el.calendar = { ctx: { request }, views: [{ view: staffing, canWrite: true }] };
    hosts.push(el);
    document.body.append(el);
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=stub-staffing]"))
      .not.toBeNull();
    expect(hostsSeen["staffing"]![0]!.month).toBe("2027-05");
  });

  it("does nothing on host.open once the screen has gone", async () => {
    history.replaceState(null, "", "/manage/opening-hours/view/staffing");
    const el = await mountCalendar();
    await expect
      .poll(() => el.shadowRoot!.querySelector("[data-test=stub-staffing]"))
      .not.toBeNull();
    el.remove();
    hostsSeen["staffing"]![0]!.open("rota", {});
    expect(location.pathname).toBe("/manage/opening-hours/view/staffing");
  });

  it("titles the Spanish page Calendario", async () => {
    setLocale("es");
    const el = await mountCalendar();
    expect(el.shadowRoot!.querySelector("h1")!.textContent).toBe("Calendario");
    expect(switchLabels(el)).toEqual(["Horario de apertura", "Personal", "Turnos"]);
  });
});
