import { page, userEvent } from "vitest/browser";
import { afterEach, expect, it, vi } from "vitest";
import { LiveData, type DashboardRequest } from "@waitron/dashboard-kit";
import { DASHBOARD_MODULES } from "@waitron/dashboard-modules";
import { leaveCoordinatorFor, type WtInput } from "@waitron/ui";
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
  seasons: [{ id: "spring", name: "Spring", startsOn: "03-01", colour: "green" }],
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
      timeZone: "Europe/Madrid",
      version: null,
      seasons: [],
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
  if (path.endsWith("/special-days/sd1"))
    return {
      id: "sd1",
      name: "Christmas dinners",
      repeatsYearly: false,
      dates: [{ date: "2026-12-14", closedAllDay: false }],
      paint: [],
      zonePaint: [],
    };
  if (path.includes("/opening-hours/season-days?"))
    return {
      days: url.searchParams
        .get("dates")!
        .split(",")
        .map((date) => ({ date, seasonId: "spring", dayCutover: "06:00", departments: [] })),
    };
  if (path.endsWith("/floor-plan-sets/period-choices")) return { departments: [] };
  if (path.endsWith("/menu-periods/painted-in"))
    return [{ periodId: "lunch", seasons: [{ id: "spring", name: "Spring" }], specialDays: [] }];
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
    request?: DashboardRequest;
    waitForScreen?: string;
  } = {},
) {
  await page.viewport(options.width ?? 1280, 800);
  history.replaceState(null, "", options.path ?? "/opening-hours/view/year");
  const session = {
    personId: "p1",
    roleIds: ["manager"],
    email: "ada@example.com",
    locale: options.locale ?? "en-GB",
    venueLocale: "en-GB",
    sessionDefault: "en-GB",
    venueName: "Search destination checks",
    permissions: options.permissions ?? ["venue.configure", "venue.view", "schedule.manage"],
    modules: options.modules ?? ["venue-service", "staffing"],
  };
  const getMe = vi.fn(async () => session);
  const liveData = new LiveData();
  const api = {
    getMe,
    liveData,
    listMenus: async () => model.menus,
    listLibraryProducts: async () => [],
    listCategories: async () => [],
    getMenuSettings: async () => ({}),
    getMenuStatuses: async () => ({}),
    getMenuStatus: async () => ({ state: "unpublished", clashes: 0 }),
    getMenuStructure: async () => {
      throw new Error("No editor model in this fixture");
    },
    getGoogleConfig: async () => ({ configured: false }),
    getVenueTheme: vi.fn().mockResolvedValue({ hash: "waitron", css: "", logo: null }),
    getLegalAbout: vi.fn().mockResolvedValue({ release: null, build: "test" }),
    getContentLanguages: async () => ({ defaultLanguage: "en", languages: ["en"] }),
    listAlerts: async () => ({ visible: false, alerts: [] }),
    getDiskStop: async () => ({ stopped: false, deleted: null }),
    getSalesOverview: () => new Promise(() => undefined),
  } as unknown as DashboardApi;
  const { el } = await mountWidget<DashboardApp>(
    "dashboard-app",
    { api, request: options.request ?? request },
    options.theme,
  );
  await vi.waitFor(() =>
    expect(
      el.shadowRoot!.querySelector(
        options.waitForScreen ??
          (options.path === "/menus"
            ? "dashboard-menus-screen"
            : options.path?.startsWith("/seasons")
              ? "dashboard-seasons-screen"
              : options.path?.startsWith("/periods")
                ? "periods-list"
                : "dashboard-opening-hours-screen"),
      ),
    ).not.toBeNull(),
  );
  if (options.width === 390)
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-toggle]")!);
  return { el, session, getMe, liveData };
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
const seasonRows = (screen: HTMLElement) =>
  (screen.shadowRoot!.querySelector("wt-data-table")?.rows as { name: string }[] | undefined)
    ?.map((row) => row.name)
    .join(" ") ?? "";
it("opens the shipped Staffing, Rota for everyone and Routes tab from search", async () => {
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
  expect(location.pathname).toBe("/opening-hours/view/staffing");
  await search(el, "everyone");
  await userEvent.click(result(el, "calendar:rota:everyone")!);
  await vi.waitFor(() =>
    expect(
      calendar(el)
        .shadowRoot!.querySelector("staffing-rota")
        ?.shadowRoot?.querySelector<HTMLElementTagNameMap["wt-combobox"]>("wt-combobox[name=area]")
        ?.value,
    ).toBe("everyone"),
  );
  expect(location.pathname).toBe("/opening-hours/view/rota/area/everyone");
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
  await search(el, "everyone");
  expect(result(el, "calendar:rota:everyone")).not.toBeNull();
  session.permissions = ["venue.view"];
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.waitFor(() => expect(getMe.mock.calls.length).toBeGreaterThan(1));
  await vi.waitFor(() => expect(result(el, "calendar:rota:everyone")).toBeNull());
  await search(el, "staffing");
  expect(result(el, "calendar:staffing")).not.toBeNull();
  session.modules = ["venue-service"];
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.waitFor(() => expect(result(el, "calendar:staffing")).toBeNull());
});
it.each(["light", "dark"] as const)(
  "the shipped Seasons page is accessible in %s",
  async (theme) => {
    const { el } = await mount({ theme });
    await search(el, "seasons");
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-seasons]")!);
    await vi.waitFor(() =>
      expect(seasonRows(el.shadowRoot!.querySelector("dashboard-seasons-screen")!)).toContain(
        "Spring",
      ),
    );
    expect(location.pathname).toBe("/seasons");
    await expectNoA11yViolations(el.shadowRoot!.querySelector("dashboard-seasons-screen")!);
  },
);
it.each(["light", "dark"] as const)(
  "searching peri finds and opens the Periods page (%s)",
  async (theme) => {
    const { el } = await mount({ theme });
    expect(el.shadowRoot!.querySelector("[data-test=nav-periods]")).not.toBeNull();
    await search(el, "peri");
    expect(el.shadowRoot!.querySelector("[data-test=nav-periods]")).not.toBeNull();
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-periods]")!);
    await vi.waitFor(() =>
      expect(
        el.shadowRoot!.querySelector("periods-list")?.shadowRoot?.querySelector("wt-data-table"),
      ).toBeTruthy(),
    );
    expect(location.pathname).toBe("/periods");
    await expectNoA11yViolations(el.shadowRoot!.querySelector("periods-list")!);
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
        await userEvent.click(
          el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-seasons]")!,
        );
        await vi.waitFor(() =>
          expect(seasonRows(el.shadowRoot!.querySelector("dashboard-seasons-screen")!)).toContain(
            "Spring",
          ),
        );
        const native = el.shadowRoot!.querySelector("dashboard-seasons-screen")!;
        await expect.poll(() => native.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
        await expect.poll(() => native.getBoundingClientRect().right).toBeLessThanOrEqual(width);
        await page.screenshot({
          path: `__screenshots__/a727-look/seasons-${theme}-${width}-${locale}.png`,
        });
        cleanupWidgets();
      }
  },
);

it.each(["sidebar", "Back", "parent", "Cancel"])(
  "the real shell protects the Seasons draft on %s",
  async (way) => {
    const { el } = await mount();
    await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-seasons]")!);
    await vi.waitFor(() => expect(location.pathname).toBe("/seasons"));
    const seasonList = el.shadowRoot!.querySelector("dashboard-seasons-screen")!;
    await expect.poll(() => seasonList.shadowRoot!.querySelector("wt-data-table")).not.toBeNull();
    const table = seasonList.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    await userEvent.click(table.shadowRoot!.querySelector<HTMLElement>("button.row-activate")!);
    await expect.poll(() => location.pathname).toBe("/seasons/season/spring");
    const editor = () =>
      el
        .shadowRoot!.querySelector("dashboard-seasons-screen")
        ?.shadowRoot?.querySelector("seasons-window");
    await vi.waitFor(() => expect(editor()).toBeTruthy());
    const input = () => editor()!.shadowRoot!.querySelector<WtInput>("wt-input")!;
    input().dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "Late spring" },
        bubbles: true,
        composed: true,
      }),
    );
    await editor()!.updateComplete;
    expect(leaveCoordinatorFor(el)!.isDirty()).toBe(true);
    const leave = async () => {
      if (way === "Back") history.back();
      else if (way === "Cancel")
        await userEvent.click(
          editor()!.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel-seasons]")!,
        );
      else if (way === "parent")
        await userEvent.click(seasonList.shadowRoot!.querySelector<HTMLElement>("a.parent")!);
      else
        await userEvent.click(
          el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-periods]")!,
        );
    };
    await leave();
    const question = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
    await vi.waitFor(() => expect(question.open).toBe(true));
    await userEvent.click(question.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!);
    await vi.waitFor(() => expect(question.open).toBe(false));
    expect(location.pathname).toBe("/seasons/season/spring");
    expect(input().value).toBe("Late spring");
    await leave();
    await vi.waitFor(() => expect(question.open).toBe(true));
    await userEvent.click(
      question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!,
    );
    await vi.waitFor(() =>
      expect(location.pathname).toBe(way === "sidebar" ? "/periods" : "/seasons"),
    );
    expect(
      el.shadowRoot!.querySelector(way === "sidebar" ? "periods-list" : "dashboard-seasons-screen"),
    ).not.toBeNull();
    expect(leaveCoordinatorFor(el)!.isDirty()).toBe(false);
  },
);
it("Painted in opens its painter through the shell and Close returns to Periods", async () => {
  const { el } = await mount();
  await userEvent.click(el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-periods]")!);
  const chip = () =>
    el
      .shadowRoot!.querySelector("periods-list")
      ?.shadowRoot?.querySelector("wt-data-table")
      ?.shadowRoot?.querySelector<HTMLAnchorElement>("a[data-painted-in]");
  await vi.waitFor(() => expect(chip()).toBeTruthy());
  const navigation = vi.spyOn(history, "pushState");
  const back = vi.spyOn(history, "back");
  const preventNativeNavigation = (event: MouseEvent) => {
    if (event.composedPath().includes(chip()!)) event.preventDefault();
  };
  document.addEventListener("click", preventNativeNavigation);
  try {
    await userEvent.click(chip()!);
    await vi.waitFor(() =>
      expect(location.pathname).toBe(
        "/opening-hours/view/season/season/spring/department/restaurant",
      ),
    );
    expect(location.search).toBe("?back=/periods");
    expect(navigation).toHaveBeenCalledTimes(1);
    const painter = calendar(el).shadowRoot!.querySelector("season-painter")!;
    await vi.waitFor(() => expect(painter.shadowRoot?.querySelector("painter-frame")).toBeTruthy());
    const frame = painter.shadowRoot!.querySelector("painter-frame")!;
    await frame.updateComplete;
    await userEvent.click(frame.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!);
    await vi.waitFor(() => expect(location.pathname).toBe("/periods"));
    expect(back).toHaveBeenCalledTimes(1);
    expect(el.shadowRoot!.querySelector("periods-list")).not.toBeNull();
  } finally {
    document.removeEventListener("click", preventNativeNavigation);
  }
});
it("a direct Painted in address closes to Periods without stepping outside this document", async () => {
  const { el } = await mount({
    path: "/opening-hours/view/season/season/spring/department/restaurant?back=/periods",
  });
  const back = vi.spyOn(history, "back").mockImplementation(() => {});
  const painter = () => calendar(el).shadowRoot!.querySelector("season-painter");
  await vi.waitFor(() =>
    expect(painter()?.shadowRoot?.querySelector("painter-frame")).toBeTruthy(),
  );
  const frame = painter()!.shadowRoot!.querySelector("painter-frame")!;
  await frame.updateComplete;
  await userEvent.click(frame.shadowRoot!.querySelector<HTMLElement>("[data-test=cancel]")!);
  await vi.waitFor(() => expect(location.pathname).toBe("/periods"));
  expect(back).not.toHaveBeenCalled();
});
describe("inline period editing inside the real shell", () => {
  const seasonBase = "/opening-hours/view/season/season/spring/department/restaurant";
  const specialBase = "/opening-hours/view/special-day/special-day/sd1";
  async function openPeriodEditor(el: DashboardApp, painter: HTMLElement, base: string) {
    const pushed = vi.spyOn(history, "pushState");
    expect(painter.shadowRoot!.querySelector("[data-test=periods-link]")).toBeNull();
    await userEvent.click(painter.shadowRoot!.querySelector<HTMLElement>('[data-test^="edit-"]')!);
    await vi.waitFor(() =>
      expect(painter.shadowRoot!.querySelector("period-dialog")).not.toBeNull(),
    );
    expect(location.pathname).toBe(base);
    expect(pushed.mock.calls).toEqual([]);
    expect(el.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  }

  it.each([true, false])(
    "opens the period editor over the season painter, with paint %s, keeping the painter",
    async (dirty) => {
      const { el } = await mount({ path: seasonBase });
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
      if (dirty) {
        grid.dispatchEvent(
          new CustomEvent("paint-change", {
            detail: { key: "3", day: painted },
            bubbles: true,
            composed: true,
          }),
        );
        await painter.updateComplete;
      }
      expect(leaveCoordinatorFor(el)!.isDirty()).toBe(dirty);
      await openPeriodEditor(el, painter, seasonBase);
      expect(calendar(el).shadowRoot!.querySelector("season-painter")).toBe(painter);
      if (dirty) expect(grid.days.get("3")).toEqual(painted);
      expect(leaveCoordinatorFor(el)!.isDirty()).toBe(dirty);
    },
  );

  it("opens the period editor over the special-day painter, keeping its unsaved name", async () => {
    const { el } = await mount({ path: specialBase });
    await vi.waitFor(() =>
      expect(
        calendar(el)
          .shadowRoot!.querySelector("special-day-painter")
          ?.shadowRoot?.querySelector("wt-input[name=name]"),
      ).not.toBeNull(),
    );
    const painter = calendar(el).shadowRoot!.querySelector("special-day-painter")!;
    const name = () => painter.shadowRoot!.querySelector<WtInput>("wt-input[name=name]")!.value;
    await vi.waitFor(() => expect(name()).toBe("Christmas dinners"));
    painter.shadowRoot!.querySelector("wt-input[name=name]")!.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "Staff party" },
        bubbles: true,
        composed: true,
      }),
    );
    await painter.updateComplete;
    expect(leaveCoordinatorFor(el)!.isDirty()).toBe(true);
    await openPeriodEditor(el, painter, specialBase);
    expect(calendar(el).shadowRoot!.querySelector("special-day-painter")).toBe(painter);
    expect(name()).toBe("Staff party");
    expect(leaveCoordinatorFor(el)!.isDirty()).toBe(true);
  });
});
it("the Voids and comps page follows its permission rather than every enabled module", async () => {
  const { el, session } = await mount({
    modules: ["venue-service", "adjustments"],
    permissions: ["venue.view"],
  });
  const page = () => el.shadowRoot!.querySelector('[data-test="nav-adjustment-reasons"]');
  await search(el, "voids");
  expect(page()).toBeNull();
  session.permissions = ["venue.view", "adjustment.manage"];
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.waitFor(() => expect(page()).not.toBeNull());
  await search(el, "adjustment");
  expect(result(el, "settings:adjustment-reasons")).toBeNull();
  await search(el, "kitchen");
  expect(
    el.shadowRoot!.querySelectorAll('[data-search-destination="settings:kitchen"]'),
  ).toHaveLength(0);
  await search(el, "venue details");
  expect(result(el, "settings:venue-details")).not.toBeNull();
});

it.each(["parent", "Back", "sidebar", "Cancel"])(
  "the real shell protects a Periods page draft on %s",
  async (way) => {
    const { el } = await mount({ path: "/periods" });
    const screen = el.shadowRoot!.querySelector("periods-list")!;
    await expect.poll(() => screen.shadowRoot!.querySelector("wt-data-table")).not.toBeNull();
    const table = screen.shadowRoot!.querySelector("wt-data-table")!;
    await table.updateComplete;
    await userEvent.click(table.shadowRoot!.querySelector<HTMLElement>("button.row-activate")!);
    await expect.poll(() => location.pathname).toBe("/periods/period/lunch");
    const editor = screen.shadowRoot!.querySelector("period-dialog")!;
    await editor.updateComplete;
    const input = editor.shadowRoot!.querySelector<WtInput>("[name=name]")!;
    input.dispatchEvent(
      new CustomEvent("wt-change", {
        detail: { value: "Late lunch" },
        bubbles: true,
        composed: true,
      }),
    );
    await editor.updateComplete;
    const leave = async () => {
      if (way === "Back") history.back();
      else if (way === "Cancel")
        await userEvent.click(
          editor.shadowRoot!.querySelector<HTMLElement>("wt-button[slot=cancel]")!,
        );
      else if (way === "parent")
        await userEvent.click(screen.shadowRoot!.querySelector<HTMLElement>("a.parent")!);
      else
        await userEvent.click(
          el.shadowRoot!.querySelector<HTMLElement>("[data-test=nav-seasons]")!,
        );
    };
    await leave();
    const question = el.shadowRoot!.querySelector("wt-unsaved-changes")!;
    await expect.poll(() => question.open).toBe(true);
    await userEvent.click(question.shadowRoot!.querySelector<HTMLElement>("[data-choice=keep]")!);
    await expect.poll(() => question.open).toBe(false);
    expect(location.pathname).toBe("/periods/period/lunch");
    expect(
      el
        .shadowRoot!.querySelector("periods-list")!
        .shadowRoot!.querySelector("period-dialog")!
        .shadowRoot!.querySelector<WtInput>("[name=name]")!.value,
    ).toBe("Late lunch");
    await leave();
    await expect.poll(() => question.open).toBe(true);
    await userEvent.click(
      question.shadowRoot!.querySelector<HTMLElement>("[data-choice=discard]")!,
    );
    await expect.poll(() => location.pathname).toBe(way === "sidebar" ? "/seasons" : "/periods");
    expect(leaveCoordinatorFor(el)!.isDirty()).toBe(false);
  },
);

it("returns a dirty Periods editor to the list when a session refresh removes editing access", async () => {
  const { el, session, getMe } = await mount({ path: "/periods/period/lunch" });
  const screen = el.shadowRoot!.querySelector("periods-list")!;
  await expect.poll(() => screen.shadowRoot!.querySelector("period-dialog")).not.toBeNull();
  const editor = screen.shadowRoot!.querySelector("period-dialog")!;
  await editor.updateComplete;
  editor.shadowRoot!.querySelector<WtInput>("[name=name]")!.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { value: "Late lunch" },
      bubbles: true,
      composed: true,
    }),
  );
  await editor.updateComplete;
  expect(leaveCoordinatorFor(el)!.isDirty()).toBe(true);
  const reads = getMe.mock.calls.length;
  session.permissions = ["venue.view"];
  document.dispatchEvent(new Event("visibilitychange"));
  await expect.poll(() => getMe.mock.calls.length).toBeGreaterThan(reads);
  const current = () => el.shadowRoot!.querySelector("periods-list")!;
  await expect.poll(() => current()?.readOnly).toBe(true);
  await expect.poll(() => location.pathname).toBe("/periods");
  expect(screen.isConnected).toBe(false);
  expect(current().shadowRoot!.querySelector("period-dialog")).toBeNull();
  expect(current().shadowRoot!.querySelector("wt-data-table")!.closest("[hidden]")).toBeNull();
  expect(el.shadowRoot!.querySelector("wt-unsaved-changes")!.open).toBe(false);
  expect(leaveCoordinatorFor(el)!.isDirty()).toBe(false);
});

const openingHours = "/management-api/venue-service/opening-hours";
const usagePermissions = ["menu.manage", "venue.view", "venue.configure"];
const menusTable = (el: DashboardApp) =>
  el
    .shadowRoot!.querySelector("dashboard-menus-screen")
    ?.shadowRoot?.querySelector("wt-data-table");
const periodLink = (el: DashboardApp) =>
  menusTable(el)?.shadowRoot?.querySelector<HTMLAnchorElement>('a[href="/periods/period/lunch"]');

it("opens the exact period from Menus and follows changes passively while the list is open", async () => {
  const read = vi.fn(request);
  const { el, liveData } = await mount({
    path: "/menus",
    request: read as DashboardRequest,
    permissions: usagePermissions,
  });
  await expect.poll(() => periodLink(el)?.textContent?.trim()).toBe("Lunch");
  expect(read).toHaveBeenCalledWith(openingHours, "GET", undefined, { passive: true });
  const reads = () => read.mock.calls.filter(([path]) => path === openingHours).length;
  const first = reads();
  liveData.invalidate([{ type: "products" }]);
  await new Promise((resolve) => requestAnimationFrame(resolve));
  expect(reads()).toBe(first);
  liveData.invalidate([{ type: "menu_periods" }]);
  await expect.poll(reads).toBe(first + 1);

  await userEvent.click(periodLink(el)!);
  await expect.poll(() => location.pathname).toBe("/periods/period/lunch");
  const editor = () =>
    el.shadowRoot!.querySelector("periods-list")?.shadowRoot?.querySelector("period-dialog");
  await expect
    .poll(() => editor()?.shadowRoot?.querySelector<WtInput>("[name=name]")?.value)
    .toBe("Lunch");
  expect(reads()).toBe(first + 2);
  history.back();
  await expect.poll(() => location.pathname).toBe("/menus");
  await expect.poll(() => periodLink(el)).toBeTruthy();
  await userEvent.click(periodLink(el)!);
  await expect
    .poll(() => editor()?.shadowRoot?.querySelector("wt-button[slot=cancel]"))
    .toBeTruthy();
  await userEvent.click(
    editor()!.shadowRoot!.querySelector<HTMLElement>("wt-button[slot=cancel]")!,
  );
  await expect.poll(() => location.pathname).toBe("/periods");
  history.back();
  await expect
    .poll(() => menusTable(el)?.shadowRoot?.querySelector<HTMLElement>('[data-test="open-menu"]'))
    .toBeTruthy();
  await userEvent.click(
    menusTable(el)!.shadowRoot!.querySelector<HTMLElement>('[data-test="open-menu"]')!,
  );
  await expect.poll(() => location.pathname).toMatch(/^\/menus\/menu\/menu/);
  await expect.poll(() => menusTable(el)).toBeNull();
  const inEditor = reads();
  liveData.invalidate([{ type: "menu_periods" }]);
  await new Promise((resolve) => requestAnimationFrame(resolve));
  expect(reads()).toBe(inEditor);
});

it("keeps period names after edit access ends and stops the watch when read access ends", async () => {
  let finish!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const read = vi.fn(request);
  const { el, session, liveData } = await mount({
    path: "/menus",
    request: read as DashboardRequest,
    permissions: usagePermissions,
  });
  await expect.poll(() => periodLink(el)).toBeTruthy();
  session.permissions = ["menu.manage", "venue.view"];
  document.dispatchEvent(new Event("visibilitychange"));
  await expect.poll(() => periodLink(el)).toBeNull();
  const row = () => menusTable(el)?.shadowRoot?.querySelector('tr[data-row-key="menu"]');
  await expect
    .poll(() => [...(row()?.querySelectorAll("td") ?? [])][2]?.textContent)
    .toContain("Lunch");
  const reads = () => read.mock.calls.filter(([path]) => path === openingHours).length;
  read.mockImplementationOnce(() => pending);
  liveData.invalidate([{ type: "menu_periods" }]);
  await expect.poll(() => read.mock.results.at(-1)?.value === pending).toBe(true);
  session.permissions = ["menu.manage"];
  document.dispatchEvent(new Event("visibilitychange"));
  await expect.poll(() => menusTable(el)?.shadowRoot?.querySelectorAll("th").length).toBe(3);
  finish({
    ...model,
    departments: [
      {
        ...model.departments[0],
        periods: [{ ...model.departments[0]!.periods[0], name: "Stale period" }],
      },
    ],
  });
  await new Promise((resolve) => requestAnimationFrame(resolve));
  expect(row()?.textContent).not.toContain("Stale period");
  expect(menusTable(el)?.shadowRoot?.querySelectorAll("th")).toHaveLength(3);
  expect(periodLink(el)).toBeNull();
  const afterAccessEnded = reads();
  liveData.invalidate([{ type: "menu_periods" }]);
  await new Promise((resolve) => requestAnimationFrame(resolve));
  expect(reads()).toBe(afterAccessEnded);
});

it("does not read periods when the venue-service module is disabled", async () => {
  const read = vi.fn(request);
  const { el } = await mount({
    path: "/menus",
    request: read as DashboardRequest,
    permissions: usagePermissions,
    modules: [],
  });
  await expect
    .poll(() => menusTable(el)?.shadowRoot?.querySelector('tr[data-row-key="menu"]'))
    .toBeTruthy();
  expect(read.mock.calls.some(([path]) => path === openingHours)).toBe(false);
});

it("refuses to mount with two enabled menu usage providers", async () => {
  const contributions = DASHBOARD_MODULES as unknown as Record<string, unknown>[];
  const venue = contributions.find((entry) => entry.module === "venue-service")!;
  const duplicate = {
    module: "another",
    strings: { en: {}, es: {} },
    menuPeriodUsage: venue.menuPeriodUsage,
  };
  contributions.push(duplicate);
  try {
    const { el } = await mount({
      path: "/menus",
      permissions: usagePermissions,
      modules: ["venue-service", "another"],
      waitForScreen: "dashboard-login-screen",
    });
    expect(menusTable(el)).toBeUndefined();
  } finally {
    contributions.pop();
  }
});
