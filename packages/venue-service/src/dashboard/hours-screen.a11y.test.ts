import { afterEach, describe, expect, test } from "vitest";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { chooseOption, cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { LocalHolidayModel } from "../holiday-types.js";
import type { HoursModel, WeekCell, WeekDay } from "../hours-types.js";
import { HoursApi } from "./hours-client.js";
import type { HoursScreen } from "./hours-screen.js";
import "./hours-screen.js";

const originalUrl = location.href;
afterEach(() => {
  cleanup();
  setLocale("en");
  history.replaceState(null, "", originalUrl);
});

const week = (cell: (weekday: number) => WeekCell): WeekDay[] =>
  [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, cell: cell(weekday) }));
const special = {
  id: "fiesta",
  date: "2026-10-12",
  name: "Fiesta Nacional",
  colour: "red" as const,
  kind: "working_day" as const,
  repeats: false,
  ownHours: false,
  closeWholeVenue: false,
};

function model(clockReadable = true): HoursModel {
  return {
    timeZone: "Europe/Madrid",
    dayCutover: "06:00",
    civilDate: clockReadable ? "2026-10-07" : null,
    clockReadable,
    departments: [],
    subjects: [
      { kind: "station", id: "restaurant", name: "Restaurant", active: true, isDefault: false },
      { kind: "station", id: "deli", name: "Deli", active: true, isDefault: false },
      { kind: "station", id: "terrace", name: "Terrace", active: false, isDefault: false },
      { kind: "station", id: "kitchen", name: "Kitchen", active: true, isDefault: true },
      { kind: "station", id: "bar", name: "Bar", active: true, isDefault: false },
    ],
    week: [
      {
        subject: { kind: "station", id: "restaurant" },
        days: week((d) =>
          d < 2
            ? { mode: "closed", periods: [] }
            : { mode: "periods", periods: [{ id: `r${d}`, opensAt: "12:00", closesAt: "16:00" }] },
        ),
      },
      {
        subject: { kind: "station", id: "deli" },
        days: week(() => ({ mode: "not_set", periods: [] })),
      },
      {
        subject: { kind: "station", id: "terrace" },
        days: week(() => ({ mode: "all_day", periods: [] })),
      },
      {
        subject: { kind: "station", id: "kitchen" },
        days: week(() => ({ mode: "not_set", periods: [] })),
      },
      {
        subject: { kind: "station", id: "bar" },
        days: week(() => ({ mode: "all_day", periods: [] })),
      },
    ],
    days: [{ date: special.date, specialDate: special, holidays: [], tone: "red" }],
    specialDates: [special],
    holidayCoverage: [],
    holidaySources: [],
    specialCells: [
      {
        specialDateId: "fiesta",
        cells: [
          { subject: { kind: "station", id: "deli" }, cell: { mode: "closed", periods: [] } },
        ],
      },
    ],
  };
}

function localModel(): LocalHolidayModel {
  const geography = {
    id: "g",
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
    geographies: [geography, { ...geography, id: "old", city: "Utrera", matchesVenue: false }],
    entries: [{ id: "e1", geographyId: "g", date: "2026-05-30", name: "San Fernando" }],
  };
}

async function mount(
  theme: "light" | "dark",
  options: {
    readOnly?: boolean;
    clockReadable?: boolean;
    refuse?: unknown;
    failRead?: boolean;
    pendingRead?: boolean;
  } = {},
): Promise<HoursScreen> {
  history.replaceState(null, "", "/manage/hours");
  await mountThemed("<div></div>", theme);
  const request = async (path: string, method: string) => {
    if (method === "GET") {
      if (options.pendingRead) return new Promise(() => {});
      if (options.failRead) throw { code: "connection.failed" };
      return path.endsWith("/local-holidays") ? localModel() : model(options.clockReadable);
    }
    if (options.refuse !== undefined) throw options.refuse;
    return undefined;
  };
  const el = document.createElement("dashboard-hours-screen");
  el.api = new HoursApi(request as unknown as DashboardRequest);
  el.readOnly = options.readOnly ?? false;
  host.append(el);
  await settle(el);
  return el;
}

async function settle(el: HoursScreen) {
  for (let turn = 0; turn < 3; turn++) {
    await el.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function deep(el: Element, selector: string): HTMLElement | null {
  const search = (root: ParentNode): HTMLElement | null => {
    const found = root.querySelector<HTMLElement>(selector);
    if (found) return found;
    for (const child of root.querySelectorAll("*"))
      if (child.shadowRoot) {
        const inner = search(child.shadowRoot);
        if (inner) return inner;
      }
    return null;
  };
  return search(el.shadowRoot!);
}

async function press(el: HoursScreen, selector: string) {
  const target = deep(el, selector)!;
  expect(target, selector).not.toBeNull();
  const menu = target.closest("wt-row-actions");
  if (menu) menu.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
  target.click();
  await settle(el);
}

async function set(el: HoursScreen, name: string, value: string) {
  const field = deep(el, `[name="${name}"]`) as HTMLElement & { value: string };
  field.value = value;
  field.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await settle(el);
}

async function showTab(el: HoursScreen, key: string) {
  el.shadowRoot!.querySelector("wt-tabs")!
    .shadowRoot!.querySelector<HTMLButtonElement>(`[data-key="${key}"]`)!
    .click();
  await settle(el);
}

const states: Record<string, (theme: "light" | "dark") => Promise<HoursScreen>> = {
  "the first read still in flight": async (theme) => {
    const el = await mount(theme, { pendingRead: true });
    expect(el.shadowRoot!.querySelector("wt-tabs")).toBeNull();
    return el;
  },
  "a failed first read": async (theme) => {
    const el = await mount(theme, { failRead: true });
    expect(deep(el, '[data-test="page-alert"]')).not.toBeNull();
    return el;
  },
  "the week with inactive subjects shown": async (theme) => {
    const el = await mount(theme);
    deep(el, 'wt-switch[name="showInactive"]')!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { checked: true }, bubbles: true, composed: true }),
    );
    await settle(el);
    expect(deep(el, 'th[data-subject="station:terrace"]')).not.toBeNull();
    return el;
  },
  "a read-only week whose clock cannot be read": (theme) =>
    mount(theme, { readOnly: true, clockReadable: false }),
  "the special dates list with local holidays at its foot": async (theme) => {
    const el = await mount(theme);
    await showTab(el, "dates");
    expect(deep(el, '[data-test="local-entries"]')).not.toBeNull();
    return el;
  },
  "the special dates list and local holidays, read-only": async (theme) => {
    const el = await mount(theme, { readOnly: true });
    await showTab(el, "dates");
    return el;
  },
  "the calendar with a special date open": async (theme) => {
    const el = await mount(theme);
    await showTab(el, "calendar");
    await press(el, 'td[data-date="2026-10-12"] button');
    expect(deep(el, '[data-test="calendar-edit"]')).not.toBeNull();
    return el;
  },
  "a day's editor after a failed press": async (theme) => {
    const el = await mount(theme);
    await press(el, 'td[data-subject="station:restaurant"][data-weekday="2"] button');
    await set(el, "tuesday.periods.0.opensAt", "");
    await press(el, '[data-test="save-editor"]');
    expect(
      (deep(el, '[name="tuesday.periods.0.opensAt"]') as HTMLElement & { error: string }).error,
    ).not.toBe("");
    return el;
  },
  "the seven-day draft": async (theme) => {
    const el = await mount(theme);
    await press(el, 'td[data-subject="station:deli"][data-weekday="1"] button');
    return el;
  },
  "the seven-day draft's confirmation": async (theme) => {
    const el = await mount(theme);
    await press(el, 'td[data-subject="station:deli"][data-weekday="1"] button');
    await chooseOption(deep(el, '[name="monday.mode"]')!, "all_day");
    await settle(el);
    await press(el, '[data-test="save-editor"]');
    expect(deep(el, '[data-test="confirm-text"]')).not.toBeNull();
    return el;
  },
  "a whole-venue closure refused for its date": async (theme) => {
    const el = await mount(theme, {
      refuse: { code: "special_date.date_taken", params: { date: "2026-10-12" } },
    });
    await showTab(el, "dates");
    await press(el, '[data-test="close-venue"]');
    await set(el, "date", "2026-10-12");
    await set(el, "name", "Closed");
    await chooseOption(deep(el, '[name="colour"]')!, "grey");
    await settle(el);
    await press(el, '[data-test="save-editor"]');
    expect((deep(el, '[name="date"]') as HTMLElement & { error: string }).error).not.toBe("");
    return el;
  },
  "a duplicate with a target date missing": async (theme) => {
    const el = await mount(theme);
    await showTab(el, "dates");
    await press(el, '[data-test="duplicate-date"]');
    await press(el, '[data-test="add-target"]');
    await press(el, '[data-test="save-editor"]');
    return el;
  },
  "a refused delete": async (theme) => {
    const el = await mount(theme, {
      refuse: {
        code: "hours.invalid",
        params: { field: "date", date: "2026-10-13", subjectId: "bar" },
      },
    });
    await showTab(el, "dates");
    await press(el, '[data-test="delete-date"]');
    await press(el, '[data-test="save-editor"]');
    return el;
  },
};

describe.each(["light", "dark"] as const)("Hours accessibility (%s)", (theme) => {
  test.each(Object.keys(states))("%s", async (state) => {
    setLocale("en");
    await states[state]!(theme);
    await expectNoA11yViolations(host);
  });
});
