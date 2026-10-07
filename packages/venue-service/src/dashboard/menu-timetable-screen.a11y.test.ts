import { afterEach, describe, expect, test } from "vitest";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import { chooseOption, cleanup, host } from "@waitron/ui/src/test-helpers.js";
import { expectNoA11yViolations, mountThemed } from "@waitron/ui/src/a11y-helpers.js";
import type { MenuSlot, MenuTimetableModel } from "../menu-timetable-types.js";
import { MenuTimetableApi } from "./menu-timetable-client.js";
import type { MenuTimetableScreen } from "./menu-timetable-screen.js";
import "./menu-timetable-screen.js";

const originalUrl = location.href;
afterEach(() => {
  cleanup();
  setLocale("en");
  history.replaceState(null, "", originalUrl);
});

const slot = (periodId: string, startsAt: string, endsAt: string): MenuSlot => ({
  periodId,
  startsAt,
  endsAt,
});

function model(clockReadable = true): MenuTimetableModel {
  const menus = ["Desayunos", "Almuerzo", "Bebidas", "Café", "Brunch de Navidad"];
  const weekday = [slot("mananas", "08:00", "12:00"), slot("mediodia", "13:00", "16:00")];
  return {
    menus: menus.map((name) => ({ id: name, name, active: true })),
    timeZone: "Europe/Madrid",
    clockReadable,
    civilDate: clockReadable ? "2026-10-07" : null,
    departments: [
      {
        id: "restaurant",
        name: "Restaurant",
        active: true,
        menuIds: menus,
        allDayMenuId: "Bebidas",
        periods: [
          {
            id: "brunch",
            name: "Brunch navideño",
            menuId: "Brunch de Navidad",
            uses: [{ kind: "special_date", specialDateId: "navidad", date: "2025-12-25" }],
          },
          {
            id: "mananas",
            name: "Mañanas",
            menuId: "Desayunos",
            uses: [{ kind: "week", weekday: 1 }],
          },
          { id: "mediodia", name: "Mediodía", menuId: "Almuerzo", uses: [] },
        ],
        week: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
          weekday: day,
          slots: day === 0 ? [] : weekday,
        })),
        zones: [
          {
            id: "barra",
            name: "Barra",
            active: true,
            allDayMenuId: null,
            periodMenus: [{ periodId: "mananas", menuId: "Café" }],
          },
          { id: "sala", name: "Sala", active: true, allDayMenuId: null, periodMenus: [] },
          { id: "terraza", name: "Terraza", active: false, allDayMenuId: "Café", periodMenus: [] },
        ],
      },
    ],
    specialDates: [
      {
        id: "navidad",
        date: "2025-12-25",
        name: "Navidad",
        timetables: [{ departmentId: "restaurant", slots: [slot("brunch", "11:00", "15:00")] }],
      },
      { id: "fiesta", date: "2026-10-12", name: "Fiesta Nacional", timetables: [] },
    ],
  };
}

async function mount(
  theme: "light" | "dark",
  options: {
    readOnly?: boolean;
    clockReadable?: boolean;
    refuse?: unknown;
    failRead?: boolean;
  } = {},
): Promise<MenuTimetableScreen> {
  history.replaceState(null, "", "/manage/menu-timetable");
  await mountThemed("<div></div>", theme);
  const request = async (_path: string, method: string) => {
    if (method === "GET") {
      if (options.failRead) throw { code: "connection.failed" };
      return model(options.clockReadable);
    }
    if (options.refuse !== undefined) throw options.refuse;
    return undefined;
  };
  const el = document.createElement("dashboard-menu-timetable-screen");
  el.api = new MenuTimetableApi(request as unknown as DashboardRequest);
  el.readOnly = options.readOnly ?? false;
  host.append(el);
  await settle(el);
  return el;
}

async function settle(el: MenuTimetableScreen) {
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

async function press(el: MenuTimetableScreen, selector: string) {
  const target = deep(el, selector)!;
  expect(target, selector).not.toBeNull();
  const menu = target.closest("wt-row-actions");
  if (menu) menu.shadowRoot!.querySelector<HTMLButtonElement>("button")!.click();
  target.click();
  await settle(el);
}

async function set(el: MenuTimetableScreen, name: string, value: string) {
  const field = deep(el, `[name="${name}"]`) as HTMLElement & { value: string };
  field.value = value;
  field.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value }, bubbles: true, composed: true }),
  );
  await settle(el);
}

const states: Record<string, (theme: "light" | "dark") => Promise<MenuTimetableScreen>> = {
  "a failed first read": async (theme) => {
    const el = await mount(theme, { failRead: true });
    expect(deep(el, '[data-test="page-alert"]')).not.toBeNull();
    return el;
  },
  "a department with its list, periods, week, special dates and zones": (theme) => mount(theme),
  "the same, read-only, whose clock cannot be read": (theme) =>
    mount(theme, { readOnly: true, clockReadable: false }),
  "the list editor holding a refusal that offers a normal week": async (theme) => {
    const el = await mount(theme, {
      refuse: {
        code: "department_menu.in_use",
        params: {
          departmentId: "restaurant",
          menuId: "Brunch de Navidad",
          uses: [
            { kind: "period", periodId: "brunch" },
            { kind: "zone_period", zoneId: "barra", periodId: "mananas" },
          ],
        },
      },
    });
    await press(el, '[data-test="edit-menus"]');
    await press(el, '[data-test="menu-row"]:last-child [data-test="remove-menu"]');
    await press(el, '[data-test="save-editor"]');
    expect(deep(el, '[data-test="list-refusal"]')).not.toBeNull();
    return el;
  },
  "a new period after a failed press": async (theme) => {
    const el = await mount(theme);
    await press(el, '[data-test="new-period"]');
    await press(el, '[data-test="save-editor"]');
    return el;
  },
  "a refused period delete naming a special date": async (theme) => {
    const el = await mount(theme, {
      refuse: {
        code: "menu_period.in_use",
        params: {
          periodId: "brunch",
          uses: [{ kind: "special_date", specialDateId: "navidad", date: "2025-12-25" }],
        },
      },
    });
    await press(el, '[data-test="delete-period"]');
    await press(el, '[data-test="save-editor"]');
    return el;
  },
  "a day's slots with an overlap and a missing period": async (theme) => {
    const el = await mount(theme);
    await press(el, 'tr[data-weekday="1"] button.cell');
    await set(el, "monday.periods.1.opensAt", "11:00");
    await press(el, '[data-test="add-period"]');
    await press(el, '[data-test="save-editor"]');
    return el;
  },
  "a special date's slots with a repeated time": async (theme) => {
    const el = await mount(theme);
    await press(el, '[data-test="edit-date-menus"]');
    await chooseOption(deep(el, '[name="date.mode"]')!, "periods");
    await settle(el);
    await set(el, "date.periods.0.opensAt", "01:00");
    return el;
  },
  "a zone choice refused": async (theme) => {
    const el = await mount(theme, { refuse: { code: "service_zone.not_found", params: {} } });
    await chooseOption(deep(el, '[name="zones.sala.periods.mananas.menuId"]')!, "Café");
    await settle(el);
    return el;
  },
};

describe.each(["light", "dark"] as const)("Menu timetable accessibility (%s)", (theme) => {
  test.each(Object.keys(states))("%s", async (state) => {
    setLocale("en");
    await states[state]!(theme);
    await expectNoA11yViolations(host);
  });
});
