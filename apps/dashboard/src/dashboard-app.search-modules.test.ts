import { page, userEvent } from "vitest/browser";
import { afterEach, expect, it, vi } from "vitest";
import type { DashboardRequest } from "@waitron/dashboard-kit";
import { navigationGuardFor, leaveCoordinatorFor, type WtInput } from "@waitron/ui";
import type { DashboardApi } from "./api/client.js";
import type { DashboardApp } from "./dashboard-app.js";
import { cleanupWidgets, mountWidget, expectNoA11yViolations } from "./widgets/test-helpers.js";
import { setLocale } from "./i18n/t.js";
import "./dashboard-app.js";

const viewport: [number, number] = [window.innerWidth, window.innerHeight];
afterEach(async () => {
  cleanupWidgets();
  setLocale("es-ES");
  vi.restoreAllMocks();
  await page.viewport(...viewport);
});
const clock = { timeZone: "Europe/Madrid", dayCutover: "06:00", cutoverChanges: [] };
const model = {
  businessDayClock: clock,
  clockRevision: 0,
  currentBusinessDay: "2026-10-15",
  pending: null,
  timeZone: "Europe/Madrid",
  clockReadable: true,
  dayCutover: "06:00",
  menus: [{ id: "menu", name: "Lunch menu", active: true, includes: [] }],
  seasons: [{ id: "spring", name: "Spring", startsOn: "03-01" }],
  currentSeasonId: "spring",
  departments: [
    {
      id: "restaurant",
      name: "Restaurant",
      active: true,
      zones: [],
      periods: [
        {
          id: "lunch",
          name: "Lunch",
          colour: "blue",
          menuId: "menu",
          staffMenuIds: [],
          endOffsetMinutes: 0,
          weekdays: [1],
          routingUses: [],
        },
      ],
      seasonWeeks: [
        {
          seasonId: "spring",
          week: Array.from({ length: 7 }, (_, weekday) => ({ weekday, slots: [] })),
        },
      ],
    },
  ],
};
const request = (async (path: string) => {
  const url = new URL(path, location.origin);
  if (path.includes("/opening-hours/year?"))
    return {
      ...model,
      year: Number(url.searchParams.get("year")),
      today: "2026-10-15",
      days: [],
      publicHolidaysAvailable: true,
      missingHolidays: [],
      holidayCoverage: [],
      area: {
        addressKey: "fixture",
        readiness: "ready",
        options: [],
        required: false,
        chosen: null,
      },
      seasons: [{ id: "spring", name: "Spring", startsOn: "03-01", lastDay: "02-28" }],
    };
  if (path.includes("/staffing/month?"))
    return {
      month: url.searchParams.get("month"),
      today: "2026-10-15",
      areas: [],
      seasons: [],
      days: [],
    };
  if (path.includes("/staffing/rota?"))
    return {
      week: url.searchParams.get("week"),
      locationId: "location",
      timeZone: "Europe/Madrid",
      version: null,
      days: [],
      shifts: [],
      openSwaps: [],
      people: [],
      absences: [],
      areas: [],
      staffRoles: [],
    };
  if (path.includes("/roster/breaches?")) return { breaches: [], ruleset: null };
  if (path.endsWith("/special-days")) return [];
  if (path.endsWith("/routing"))
    return {
      zones: [],
      periods: [],
      categories: [],
      products: [],
      cells: [],
      defaultStationId: null,
      stations: [],
      canMakeDefault: true,
    };
  if (path.endsWith("/opening-hours")) return model;
  if (
    ["stations", "categories", "zones", "products", "printers", "devices"].some(
      (name) => path === `/management-api/${name}`,
    )
  )
    return [];
  throw new Error(`Unexpected search fixture request ${path}`);
}) as DashboardRequest;
async function mount(
  options: {
    path?: string;
    locale?: string;
    theme?: "light" | "dark";
    width?: number;
    permissions?: string[];
    modules?: string[];
  } = {},
) {
  await page.viewport(options.width ?? 1280, 800);
  history.replaceState(null, "", options.path ?? "/manage/opening-hours/view/year");
  const session = {
    personId: "p1",
    role: "manager",
    email: "ada@example.com",
    locale: options.locale ?? "en-GB",
    venueLocale: "en-GB",
    sessionDefault: "en-GB",
    venueName: "Search destination checks",
    permissions: options.permissions ?? ["venue_service.manage", "venue.view", "schedule.manage"],
    modules: options.modules ?? ["venue-service", "staffing"],
  };
  const getMe = vi.fn(async () => session);
  const api = {
    getMe,
    getGoogleConfig: async () => ({ configured: false }),
    getContentLanguages: async () => ({ defaultLanguage: "en", languages: ["en"] }),
    listAlerts: async () => ({ visible: false, alerts: [] }),
    getSalesOverview: () => new Promise(() => undefined),
  } as unknown as DashboardApi;
  const { el } = await mountWidget<DashboardApp>("dashboard-app", { api, request }, options.theme);
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector("dashboard-opening-hours-screen")).not.toBeNull(),
  );
  if (options.width === 390)
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-toggle]")!);
  return { el, session, getMe };
}
async function search(el: DashboardApp, term: string) {
  const input = el.shadowRoot!.querySelector<WtInput>("[data-test=nav-search]")!;
  input.focus();
  input.shadowRoot!.querySelector("input")!.select();
  await userEvent.keyboard(term);
  await el.updateComplete;
}
const result = (el: DashboardApp, id: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(`[data-search-destination="${id}"]`);
const calendar = (el: DashboardApp) =>
  el.shadowRoot!.querySelector("dashboard-opening-hours-screen")!;
it("opens the shipped Staffing, Rota person view and Routes tab from search", async () => {
  const { el } = await mount();
  await search(el, "staffing");
  await userEvent.click(result(el, "calendar:staffing")!);
  await vi.waitFor(() =>
    expect(
      calendar(el)
        .shadowRoot!.querySelector("staffing-month")
        ?.shadowRoot?.querySelector("[data-test=month]")?.textContent,
    ).toContain("2026"),
  );
  expect(location.pathname).toBe("/manage/opening-hours/view/staffing");
  await search(el, "by person");
  await userEvent.click(result(el, "calendar:rota:by-person")!);
  await vi.waitFor(() =>
    expect(
      calendar(el)
        .shadowRoot!.querySelector("staffing-rota")
        ?.shadowRoot?.querySelector("[data-test=by-person]")
        ?.getAttribute("aria-pressed"),
    ).toBe("true"),
  );
  expect(location.pathname).toBe("/manage/opening-hours/view/rota/mode/person");
  await search(el, "routes");
  await userEvent.click(result(el, "venue-service:prep:routing")!);
  await vi.waitFor(() =>
    expect(
      el
        .shadowRoot!.querySelector("dashboard-prep-stations-screen")
        ?.shadowRoot?.querySelector("wt-tabs")?.value,
    ).toBe("routing"),
  );
});
it("rebuilds destinations when modules and permissions change at the next session probe", async () => {
  const { el, session, getMe } = await mount();
  await search(el, "by person");
  expect(result(el, "calendar:rota:by-person")).not.toBeNull();
  session.permissions = ["venue.view"];
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.waitFor(() => expect(getMe.mock.calls.length).toBeGreaterThan(1));
  await vi.waitFor(() => expect(result(el, "calendar:rota:by-person")).toBeNull());
  await search(el, "staffing");
  expect(result(el, "calendar:staffing")).not.toBeNull();
  session.modules = ["venue-service"];
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.waitFor(() => expect(result(el, "calendar:staffing")).toBeNull());
});
it.each(["light", "dark"] as const)(
  "the shipped Seasons window is accessible in %s",
  async (theme) => {
    const { el } = await mount({ theme });
    await search(el, "seasons");
    await userEvent.click(result(el, "venue-service:seasons")!);
    await vi.waitFor(() =>
      expect(
        calendar(el).shadowRoot!.querySelector("[data-test=calendar-window] season-chips")
          ?.shadowRoot?.textContent,
      ).toContain("Spring"),
    );
    expect(location.pathname).toBe("/manage/opening-hours/view/year/window/seasons");
    await expectNoA11yViolations(
      calendar(el).shadowRoot!.querySelector("[data-test=calendar-window]")!,
    );
  },
);
it.each(["light", "dark"] as const)(
  "real search destinations fit phones and desktops in both languages (%s)",
  async (theme) => {
    for (const width of [390, 1280])
      for (const locale of ["en-GB", "es-ES"]) {
        const { el } = await mount({ theme, width, locale });
        await search(el, locale === "es-ES" ? "rutas" : "routes");
        const row = result(el, "venue-service:prep:routing")!;
        expect(row.checkVisibility()).toBe(true);
        await expect.poll(() => row.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
        await expect.poll(() => row.getBoundingClientRect().right).toBeLessThanOrEqual(width);
        expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
        await page.screenshot({
          path: `__screenshots__/a727-look/search-${theme}-${width}-${locale}.png`,
        });
        await search(el, locale === "es-ES" ? "temporadas" : "seasons");
        await userEvent.click(result(el, "venue-service:seasons")!);
        await vi.waitFor(() =>
          expect(
            calendar(el).shadowRoot!.querySelector("[data-test=calendar-window] season-chips")
              ?.shadowRoot?.textContent,
          ).toContain("Spring"),
        );
        const modal = calendar(el).shadowRoot!.querySelector("[data-test=calendar-window]")!;
        await vi.waitFor(() => expect(modal.shadowRoot!.querySelector("dialog")!.open).toBe(true));
        const native = modal.shadowRoot!.querySelector("dialog")!;
        await expect.poll(() => native.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
        await expect.poll(() => native.getBoundingClientRect().right).toBeLessThanOrEqual(width);
        await page.screenshot({
          path: `__screenshots__/a727-look/window-${theme}-${width}-${locale}.png`,
        });
        cleanupWidgets();
      }
  },
);

it("the real shell delegates window-only navigation without discarding the actual painter draft", async () => {
  const base = "/manage/opening-hours/view/season/season/spring/department/restaurant";
  const { el } = await mount({ path: base });
  await vi.waitFor(() =>
    expect(
      calendar(el)
        .shadowRoot!.querySelector("season-painter")
        ?.shadowRoot?.querySelector("paint-grid"),
    ).not.toBeNull(),
  );
  const painter = calendar(el).shadowRoot!.querySelector("season-painter")!;
  const grid = painter.shadowRoot!.querySelector("paint-grid")!;
  const painted = [{ periodId: "lunch", startsAt: "12:00", endsAt: "14:00" }];
  grid.dispatchEvent(
    new CustomEvent("paint-change", {
      detail: { key: "3", day: painted },
      bubbles: true,
      composed: true,
    }),
  );
  await painter.updateComplete;
  expect(grid.days.get("3")).toEqual(painted);
  expect(leaveCoordinatorFor(el)!.isDirty()).toBe(true);
  const opening = navigationGuardFor(window)!.write(`${base}/window/seasons`);
  await vi.waitFor(() =>
    expect(calendar(el).shadowRoot!.querySelector("[data-test=calendar-window]")).not.toBeNull(),
  );
  await opening;
  expect(el.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(calendar(el).shadowRoot!.querySelector("season-painter")).toBe(painter);
  expect(grid.days.get("3")).toEqual(painted);
  calendar(el).shadowRoot!.querySelector<HTMLElement>("[data-test=close-calendar-window]")!.click();
  await vi.waitFor(() => expect(location.pathname).toBe(base));
  expect(grid.days.get("3")).toEqual(painted);
  expect(leaveCoordinatorFor(el)!.isDirty()).toBe(true);
});
it("opening Calendar preserves an unrelated bookmark query and hash but removes stale station", async () => {
  const { el } = await mount({
    path: "/manage/opening-hours/view/year?source=bookmark&station=old#calendar",
  });
  await search(el, "seasons");
  await userEvent.click(result(el, "venue-service:seasons")!);
  await vi.waitFor(() =>
    expect(calendar(el).shadowRoot!.querySelector("[data-test=calendar-window]")).not.toBeNull(),
  );
  expect(location.search).toBe("?source=bookmark");
  expect(location.hash).toBe("#calendar");
});
it("settings destinations follow the real permitted panels rather than every enabled module", async () => {
  const { el, session } = await mount({
    modules: ["venue-service", "adjustments"],
    permissions: ["venue.view"],
  });
  await search(el, "adjustment");
  expect(result(el, "settings:adjustment-reasons")).toBeNull();
  session.permissions = ["venue.view", "adjustment.manage"];
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.waitFor(() => expect(result(el, "settings:adjustment-reasons")).not.toBeNull());
  await search(el, "tables");
  expect(
    el.shadowRoot!.querySelectorAll('[data-search-destination="settings:tables"]'),
  ).toHaveLength(1);
});
