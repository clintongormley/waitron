import { page, userEvent } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "@waitron/ui/src/a11y-helpers.js";
import { LiveData, setLocale } from "@waitron/dashboard-kit";
import { registerIcons, applyTokens, type WtCombobox, type WtInput } from "@waitron/ui";
import type { PrepStationsApi, PrepStationsView, StationHealthSnapshot } from "./routing-client.js";
import type { PrepStationsScreen } from "./prep-stations-screen.js";
import type { WatcherView } from "./watchers-seen.js";
import "./prep-stations-screen.js";

registerIcons({
  kebab:
    "M6.7 3a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0M6.7 8a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0M6.7 13a1.3 1.3 0 1 0 2.6 0a1.3 1.3 0 1 0 -2.6 0",
  grip: "M6 3.5a1.1 1.1 0 1 1-2.2 0a1.1 1.1 0 0 1 2.2 0M12.2 3.5a1.1 1.1 0 1 1-2.2 0a1.1 1.1 0 0 1 2.2 0M6 8a1.1 1.1 0 1 1-2.2 0a1.1 1.1 0 0 1 2.2 0M12.2 8a1.1 1.1 0 1 1-2.2 0a1.1 1.1 0 0 1 2.2 0M6 12.5a1.1 1.1 0 1 1-2.2 0a1.1 1.1 0 0 1 2.2 0M12.2 12.5a1.1 1.1 0 1 1-2.2 0a1.1 1.1 0 0 1 2.2 0",
});
const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
  setLocale("en");
});
const view: PrepStationsView = {
  routing: {
    zones: [],
    categories: [
      { id: "drinks", name: "Drinks", parentId: null },
      { id: "cocktails", name: "Cocktails", parentId: "drinks" },
      { id: "food", name: "Food", parentId: null },
    ],
    products: [{ id: "bread", name: "Bread", categoryId: null }],
    cells: [
      {
        row: { kind: "category", categoryId: "cocktails" },
        zoneId: null,
        target: { kind: "station", stationId: "bar" },
      },
    ],
    canMakeDefault: true,
    defaultStationId: "bar",
    stations: [{ id: "bar", name: "Bar", active: true }],
    stationTimes: [
      {
        stationId: "bar",
        nextTransition: null,
        status: { open: true, why: "default" },
        hours: [],
        fallbackStationId: null,
        today: null,
        closedSendsTo: "bar",
      },
    ],
    todayEnds: { timeOfDay: "06:00", tomorrow: true },
    clockReadable: true,
  },
  stations: [
    {
      id: "bar",
      name: "Bar",
      active: true,
      isDefault: true,
      displayOrder: 1,
      warmAfterMinutes: 5,
      overdueAfterMinutes: 10,
      forgottenAfterMinutes: 15,
      timingDefaults: { warmAfterMinutes: 5, overdueAfterMinutes: 10, forgottenAfterMinutes: 15 },
      timingOverrides: {
        warmAfterMinutes: null,
        overdueAfterMinutes: null,
        forgottenAfterMinutes: null,
      },
      showsRestOfOrder: false,
    },
  ],
  categories: [
    { id: "drinks", name: "Drinks", parentId: null },
    { id: "cocktails", name: "Cocktails", parentId: "drinks" },
    { id: "food", name: "Food", parentId: null },
  ],
  zones: [],
  products: [{ id: "bread", name: "Bread" }],
  printers: [],
  stationPrinters: [],
  devices: [],
  watchers: [],
  disabledWatchers: [],
};
function api(overrides: Partial<PrepStationsApi> = {}): PrepStationsApi {
  const load = overrides.load ?? vi.fn().mockResolvedValue(view);
  return {
    load,
    readStationHealth: vi.fn(async () => {
      const loaded: PrepStationsView = (await vi.mocked(load).mock.results.at(-1)?.value) ?? view;
      return {
        capturedAt: "2026-10-05T12:00:00Z",
        stations: loaded.stations.map((station) => ({
          id: station.id,
          name: station.name,
          hasScreen: false,
          waiting: 0,
          preparing: null,
          ready: null,
          late: { warm: 0, overdue: 0, forgotten: 0 },
          oldestMinutes: null,
          items: [],
        })),
        outputsDown: { printersDown: [], screensDark: [] },
      };
    }),
    preview: vi.fn().mockResolvedValue([]),
    createStation: vi.fn(),
    updateStation: vi.fn(),
    deactivateStation: vi.fn(),
    setDefaultStation: vi.fn(),
    ...overrides,
  } as unknown as PrepStationsApi;
}
it("shows watcher table relationships and Tickets follow lines", async () => {
  setLocale("en");
  const pass = {
    id: "pass",
    name: "Pass",
    active: true,
    displayOrder: 0,
    everyStation: true,
    stationIds: [],
    everyZone: true,
    zoneIds: [],
    runsPass: true,
    printerIds: ["printer"],
  };
  const runner = {
    id: "runner",
    name: "Terrace runner",
    active: true,
    displayOrder: 1,
    everyStation: false,
    stationIds: ["bar"],
    everyZone: false,
    zoneIds: ["terrace"],
    runsPass: false,
    printerIds: [],
  };
  const a = api({
    load: vi.fn().mockResolvedValue({
      ...view,
      zones: [{ id: "terrace", name: "Terrace", active: true }],
      printers: [{ id: "printer", name: "Expo printer" }],
      devices: [
        {
          id: "device",
          label: "Pass screen",
          kind: "kds_station",
          active: true,
          kitchenScreens: [],
        },
      ],
      watchers: [pass, runner],
    }),
  });
  const el = await mount(a);
  expect(q(el, '[data-test="edit-watcher-follows-pass"]')?.textContent?.trim()).toBe(
    "every station",
  );
  expect(q(el, '[data-test="edit-watcher-zones-pass"]')?.textContent?.trim()).toBe(
    "every service zone",
  );
  expect(q(el, '[data-test="edit-watcher-pass-pass"]')?.textContent?.trim()).toBe("Yes");
  expect(q(el, '[data-test="watcher-screens-pass"]')).toBeNull();
  expect(q(el, '[data-test="edit-watcher-printers-pass"]')?.textContent).toContain("Expo printer");
  expect(q(el, '[data-test="edit-watcher-follows-runner"]')?.textContent?.trim()).toBe("Bar");
  expect(q(el, '[data-test="edit-watcher-zones-runner"]')?.textContent?.trim()).toBe("Terrace");
  const tickets = el.shadowRoot!.querySelector('[data-test="tickets-table"]')!;
  await (tickets as HTMLElement & { updateComplete: Promise<boolean> }).updateComplete;
  const follows = tickets.shadowRoot!.querySelector('[data-test="watchers-bar"]')!;
  expect(follows.textContent).toContain("Pass, Terrace runner");
  expect(follows.querySelector("a")?.getAttribute("href")).toBe(
    "/manage/prep-stations/view/watchers",
  );
  window.history.replaceState(null, "", "/manage?dashboard=prep-stations");
});

it("edits and confirms removal of a watcher", async () => {
  setLocale("en");
  const pass = {
    id: "pass",
    name: "Pass",
    active: true,
    displayOrder: 0,
    everyStation: true,
    stationIds: [],
    everyZone: true,
    zoneIds: [],
    runsPass: true,
    printerIds: [],
    inUse: true,
  };
  const a = api({
    load: vi.fn().mockResolvedValue({ ...view, watchers: [pass] }),
    updateWatcher: vi.fn(),
    removeWatcher: vi.fn(),
  });
  const el = await mount(a);
  q(el, '[data-test="rename-watcher-pass"]')!.click();
  await settle(el);
  const rename = q(el, '[data-test="watcher-rename-name"]') as WtInput;
  expect(rename.value).toBe("Pass");
  rename.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Expo" } }));
  await settle(el);
  q(el, '[data-test="save-watcher-name"]')!.click();
  await settle(el);
  expect(a.updateWatcher).toHaveBeenCalledWith("pass", {
    name: "Expo",
    everyStation: true,
    stationIds: [],
    everyZone: true,
    zoneIds: [],
    runsPass: true,
    displayOrder: 0,
  });
  q(el, '[data-test="remove-watcher-pass"]')!.click();
  await settle(el);
  expect(q(el, '[data-test="remove-watcher-modal"]')?.textContent).toContain("Disable Pass?");
  q(el, '[data-test="confirm-remove-watcher"]')!.click();
  await settle(el);
  expect(a.removeWatcher).toHaveBeenCalledWith("pass", { disable: true });
});

async function mount(a: PrepStationsApi, theme?: "light" | "dark"): Promise<PrepStationsScreen> {
  const host = document.createElement("div");
  applyTokens(host);
  if (theme) host.setAttribute("data-theme", theme);
  document.body.append(host);
  hosts.push(host);
  const el = document.createElement("dashboard-prep-stations-screen") as PrepStationsScreen;
  el.api = a;
  host.append(el);
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  return el;
}
async function settle(el: PrepStationsScreen) {
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}
async function editSaveField(el: PrepStationsScreen, field: HTMLElement, value: string | string[]) {
  field.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: typeof value === "string" ? { value } : { values: value, value: value[0] },
    }),
  );
  await settle(el);
}
const q = (el: PrepStationsScreen, s: string) =>
  el.shadowRoot!.querySelector<HTMLElement>(s) ??
  el
    .shadowRoot!.querySelector('[data-test="watchers-table"]')
    ?.shadowRoot?.querySelector<HTMLElement>(s) ??
  healthSummary(el)?.querySelector<HTMLElement>(s) ??
  null;
async function routingGrid(el: PrepStationsScreen) {
  const grid = el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
    '[slot="routing"] venue-routing-grid',
  );
  await grid?.updateComplete;
  return grid;
}
const gridCombo = (grid: HTMLElement, row: string, zone: string) =>
  grid.shadowRoot!.querySelector<WtCombobox>(
    `td[data-row="${row}"][data-zone="${zone}"] wt-combobox[name="routing-target"]`,
  );

it.each([
  ['wt-switch[name="showsRestOfOrder"]', ""],
  ['a[href="/manage/printing-rules"]', ""],
  ['a[href="/manage/devices"]', ""],
  ["", "Warm 5 min"],
  ["", "Watched by:"],
])(
  "keeps assignment and late-flag settings %s %s out of the Routing cards",
  async (selector, text) => {
    setLocale("en");
    const el = await mount(api({ load: vi.fn().mockResolvedValue(ticketView) }));
    const routing = el.shadowRoot!.querySelector('[slot="routing"]')!;
    expect(await routingGrid(el)).not.toBeNull();
    expect(routing.querySelector('[data-test="station-bar"]')).not.toBeNull();
    if (selector) expect(routing.querySelector(selector)).toBeNull();
    else expect(routing.textContent).not.toContain(text);
  },
);

it.each(["[name^=fallback-]", "[data-test^=change-fallback-]"])(
  "keeps fallback editing %s out of Routing while preserving category cells",
  async (selector) => {
    const next = withUpstairs({ open: false, why: "out_of_hours" });
    next.stations.push({ ...upstairs, id: "retired", name: "Retired", active: false });
    next.routing.stations.push({ id: "retired", name: "Retired", active: false });
    const el = await mount(api({ load: vi.fn().mockResolvedValue(next) }));
    const routing = el.shadowRoot!.querySelector('[slot="routing"]')!;
    const grid = (await routingGrid(el))!;
    expect(grid).not.toBeNull();
    expect(gridCombo(grid, "c:cocktails", "every")!.value).toBe("station:bar");
    expect(routing.querySelector(selector)).toBeNull();
  },
);

it.each([
  ["default-upstairs", "in_hours"],
  ["switch-off-upstairs", "in_hours"],
  ["switch-on-retired", "in_hours"],
] as const)("keeps station action %s in Stations rather than Routing", async (action, why) => {
  const next = withUpstairs({ open: true, why });
  next.stations.push({ ...upstairs, id: "retired", name: "Retired", active: false });
  next.routing.stations.push({ id: "retired", name: "Retired", active: false });
  const el = await mount(api({ load: vi.fn().mockResolvedValue(next) }));
  const routing = el.shadowRoot!.querySelector('[slot="routing"]')!;
  expect(await routingGrid(el)).not.toBeNull();
  expect(routing.querySelector('[data-test="station-upstairs"]')).not.toBeNull();
  expect(routing.querySelector(`[data-test="${action}"]`)).toBeNull();
  const moved = action
    .replace("default-", "make-default-")
    .replace("switch-off-", "disable-")
    .replace("switch-on-", "enable-");
  expect(healthSummary(el)!.querySelector(`[data-test="${moved}"]`)).not.toBeNull();
});

function settingsQ(el: PrepStationsScreen, selector: string) {
  return el
    .shadowRoot!.querySelector('[data-test="settings-table"]')!
    .shadowRoot!.querySelector<HTMLElement>(selector);
}
async function openSettingsFallback(el: PrepStationsScreen, stationId = "upstairs") {
  el.shadowRoot!.querySelector("wt-tabs")!.dispatchEvent(
    new CustomEvent("wt-tab-change", { detail: { value: "settings" } }),
  );
  await settle(el);
  settingsQ(el, `[data-test="edit-settings-fallback-${stationId}"]`)!.click();
  await settle(el);
  return settingsQ(el, '[data-test="settings-choice"]') as WtCombobox;
}
it("Settings retains disabled station fallback editing without enabling the station", async () => {
  setLocale("en");
  const next = withUpstairs({ open: false, why: "switched_off" });
  next.stations[1]!.active = false;
  next.stations[1]!.displayOrder = 0;
  next.routing.stations[1]!.active = false;
  const a = api({
    load: vi.fn().mockResolvedValue(next),
    setStationFallback: vi.fn(),
    activateStation: vi.fn(),
  });
  const el = await mount(a);
  const edit = settingsQ(el, '[data-test="edit-settings-fallback-upstairs"]');
  expect(edit).not.toBeNull();
  const rows = el
    .shadowRoot!.querySelector('[data-test="settings-table"]')!
    .shadowRoot!.querySelectorAll("tbody tr");
  expect(rows[0]!.textContent).toContain("Bar");
  expect(rows[0]!.textContent).not.toContain("Upstairs");
  expect(rows[1]!.textContent).toContain("Upstairs bar (Disabled)");
  const combo = await openSettingsFallback(el);
  expect(combo.value).toBe("bar");
  combo.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "" } }));
  await settle(el);
  settingsQ(el, '[data-test="save-settings-cell"]')!.click();
  await settle(el);
  expect(a.setStationFallback).not.toHaveBeenCalled();
  settingsQ(el, '[data-test="save-settings-cell"]')!.click();
  await settle(el);
  expect(a.setStationFallback).toHaveBeenCalledExactlyOnceWith("upstairs", null);
  expect(a.activateStation).not.toHaveBeenCalled();
  expect(a.updateStation).not.toHaveBeenCalled();
});

it("Settings keeps a retained disabled fallback quiet without rewriting its unchanged mapping", async () => {
  setLocale("en");
  const next = withUpstairs(
    { open: false, why: "out_of_hours" },
    { fallbackStationId: "old", closedSendsTo: null },
  );
  next.routing.stations.push({ id: "old", name: "Old bar", active: false });
  const a = api({
    load: vi.fn().mockResolvedValue(next),
    setStationFallback: vi.fn().mockRejectedValue({ code: "route.station_inactive" }),
  });
  const el = await mount(a);
  const combo = await openSettingsFallback(el);
  expect(combo.value).toBe("old");
  const save = settingsQ(
    el,
    '[data-test="save-settings-cell"]',
  ) as HTMLElementTagNameMap["wt-button"];
  expect(save.variant).toBe("secondary");
  expect(save.disabled).toBe(true);
  save.click();
  await settle(el);
  expect(a.setStationFallback).not.toHaveBeenCalled();
  expect(settingsQ(el, '[data-test="settings-fallback-confirmation"]')).toBeNull();
  expect((settingsQ(el, '[data-test="settings-choice"]') as WtCombobox).value).toBe("old");
});

it("Settings fallback retains the localized search prompt and empty-choice placeholder", async () => {
  setLocale("es");
  const el = await mount(
    api({ load: vi.fn().mockResolvedValue(withUpstairs({ open: true, why: "in_hours" })) }),
  );
  const combo = await openSettingsFallback(el);
  expect(combo.searchPlaceholder).toBe("Buscar estaciones");
  expect(combo.placeholder).toBe("Sin sustituta (el TPV pregunta)");
});

it.each(
  ([390, 1280] as const).flatMap((width) =>
    (["en", "es"] as const).flatMap((locale) =>
      (["light", "dark"] as const).map((theme) => ({ width, locale, theme })),
    ),
  ),
)("Routing handover renders in $locale $theme at $width px", async ({ width, locale, theme }) => {
  const previous = {
    width: window.innerWidth,
    height: window.innerHeight,
    body: document.body.style.background,
    canvas: document.documentElement.style.background,
  };
  try {
    await page.viewport(width, 900);
    expect(window.innerWidth).toBe(width);
    setLocale(locale);
    history.replaceState(null, "", "/manage/prep-stations/view/routing");
    const timed = withUpstairs({ open: false, why: "out_of_hours" });
    const visualView = {
      ...ticketView,
      stations: [...timed.stations, { ...upstairs, id: "retired", name: "Retired", active: false }],
      routing: {
        ...ticketView.routing,
        stations: [...timed.routing.stations, { id: "retired", name: "Retired", active: false }],
        stationTimes: timed.routing.stationTimes,
      },
    };
    const el = await mount(
      api({
        load: vi.fn().mockResolvedValue(visualView),
        readStationHealth: vi.fn().mockResolvedValue(
          healthFor(visualView, {
            printersDown: [
              {
                stationId: "upstairs",
                stationName: "Upstairs bar",
                printerId: "epson",
                printerName: "Epson",
                since: "2026-10-01T20:14:00",
              },
            ],
            screensDark: [{ stationId: "retired", stationName: "Retired", lastSeenAt: null }],
          }),
        ),
      }),
      theme,
    );
    const host = el.parentElement!;
    host.style.background = "var(--wt-color-bg)";
    const canvas = getComputedStyle(host).backgroundColor;
    document.body.style.background = canvas;
    document.documentElement.style.background = canvas;
    const tabs = el.shadowRoot!.querySelector("wt-tabs")!;
    expect(tabs.value).toBe("routing");
    const cocktails = gridCombo((await routingGrid(el))!, "c:cocktails", "every")!;
    expect(cocktails.label).toContain("Drinks › Cocktails");
    expect(cocktails.value).toBe("station:bar");
    await expectNoA11yViolations(el);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    await page.screenshot({
      path: `__screenshots__/look/routing-handover-${locale}-${theme}-${width}-routing.png`,
      element: el,
    });
    el.shadowRoot!.querySelector('[data-test="station-upstairs"]')!.scrollIntoView();
    await page.screenshot({
      path: `__screenshots__/look/routing-fallback-${locale}-${theme}-${width}-station.png`,
    });
    el.shadowRoot!.querySelector('[data-test="inactive-retired"]')!.scrollIntoView();
    await page.screenshot({
      path: `__screenshots__/look/routing-fallback-${locale}-${theme}-${width}-inactive.png`,
    });
    tabs.scrollIntoView();
    tabs.dispatchEvent(new CustomEvent("wt-tab-change", { detail: { value: "stations" } }));
    await settle(el);
    expect(healthRow(el, "upstairs").querySelector('[part="problem"]')?.textContent).toContain(
      "Epson",
    );
    expect(healthRow(el, "retired").querySelector('[part="problem"]')).not.toBeNull();
    const problem = healthRow(el, "upstairs").querySelector<HTMLElement>('[part="problem"]')!;
    const probe = document.createElement("span");
    probe.style.display = "inline-block";
    probe.style.width = "var(--wt-cell-name-max-width)";
    host.append(probe);
    expect(problem.getBoundingClientRect().width).toBeLessThanOrEqual(
      probe.getBoundingClientRect().width,
    );
    const message = document.createRange();
    message.selectNodeContents(problem);
    expect(message.getClientRects().length).toBeGreaterThan(1);
    probe.remove();
    await expectNoA11yViolations(el);
    await page.screenshot({
      path: `__screenshots__/look/routing-complete-${locale}-${theme}-${width}-stations.png`,
    });
    await page.elementLocator(q(el, '[data-test="new-station"]')!).click();
    await settle(el);
    expect(q(el, '[data-test="name"]')).not.toBeNull();
    expect(q(el, '[data-test="overdue"]')).not.toBeNull();
    await expectNoA11yViolations(el);
    await page.screenshot({
      path: `__screenshots__/look/routing-complete-${locale}-${theme}-${width}-create.png`,
    });
    q(el, "wt-modal")!.dispatchEvent(new CustomEvent("wt-close"));
    await settle(el);
    tabs.scrollIntoView();
    tabs.dispatchEvent(new CustomEvent("wt-tab-change", { detail: { value: "tickets" } }));
    await settle(el);
    const tickets = el.shadowRoot!.querySelector('[data-test="tickets-table"]')!;
    await (tickets as HTMLElement & { updateComplete: Promise<boolean> }).updateComplete;
    expect(tickets.shadowRoot!.querySelector('[data-test="screens-bar"]')!.textContent).toContain(
      "Bar screen",
    );
    expect(tickets.shadowRoot!.querySelector('[data-test="watchers-bar"]')!.textContent).toContain(
      "Pass",
    );
    await expectNoA11yViolations(el);
    await page.screenshot({
      path: `__screenshots__/look/routing-handover-${locale}-${theme}-${width}-tickets.png`,
    });
    tabs.dispatchEvent(new CustomEvent("wt-tab-change", { detail: { value: "settings" } }));
    await settle(el);
    const settings = el.shadowRoot!.querySelector('[data-test="settings-table"]')!;
    await (settings as HTMLElement & { updateComplete: Promise<boolean> }).updateComplete;
    const rest = settings.shadowRoot!.querySelector<HTMLElement>(
      '[data-test="edit-settings-rest-bar"]',
    )!;
    expect(rest.textContent?.trim()).toBe("No");
    await page.elementLocator(rest).click();
    await settle(el);
    const choice = settings.shadowRoot!.querySelector('[data-test="settings-choice"]')!;
    expect(choice.shadowRoot!.querySelector(".trigger .value")!.textContent?.trim()).toBe("No");
    await expectNoA11yViolations(el);
    await page.screenshot({
      path: `__screenshots__/look/routing-handover-${locale}-${theme}-${width}-settings.png`,
    });
    settings.shadowRoot!.querySelector<HTMLElement>('[data-test="cancel-settings-cell"]')!.click();
    await settle(el);
    expect(settings.shadowRoot!.querySelector('[data-test="settings-choice"]')).toBeNull();
    history.replaceState(null, "", "/manage");
  } finally {
    document.body.style.background = previous.body;
    document.documentElement.style.background = previous.canvas;
    await page.viewport(previous.width, previous.height);
  }
});
const upstairs = {
  ...view.stations[0]!,
  id: "upstairs",
  name: "Upstairs bar",
  isDefault: false,
  displayOrder: 2,
};
function withUpstairs(
  status: (typeof view.routing.stationTimes)[number]["status"],
  overrides: Partial<(typeof view.routing.stationTimes)[number]> = {},
): PrepStationsView {
  return {
    ...view,
    stations: [...view.stations.map((row) => ({ ...row })), { ...upstairs }],
    routing: {
      ...view.routing,
      stations: [...view.routing.stations, { id: "upstairs", name: "Upstairs bar", active: true }],
      stationTimes: [
        ...view.routing.stationTimes,
        {
          stationId: "upstairs",
          nextTransition: null,
          status,
          hours: [],
          fallbackStationId: "bar",
          today: null,
          closedSendsTo: "bar",
          ...overrides,
        },
      ],
    },
  };
}
it.each([
  [{ open: true, why: "in_hours" }, "Open now"],
  [{ open: true, why: "opened_by_hand" }, "Open now, opened by hand until 06:00 tomorrow"],
  [
    { open: false, why: "out_of_hours" },
    "Closed now: outside its opening hours. Its work goes to Bar.",
  ],
  [
    { open: false, why: "closed_by_hand" },
    "Closed now, closed by hand until 06:00 tomorrow. Its work goes to Bar.",
  ],
] as const)("shows station status %j", async (status, expected) => {
  setLocale("en");
  const el = await mount(api({ load: vi.fn().mockResolvedValue(withUpstairs(status)) }));
  expect(healthRow(el, "upstairs").textContent).toContain(expected);
  expect(healthRow(el, "bar").textContent).toContain("Always open");
  expect(healthRow(el, "bar").querySelector('[part="badge"]')?.textContent).toBe("Default");
  expect(q(el, '[data-test="edit-hours-bar"]')).toBeNull();
  expect(q(el, '[data-test="close-today-bar"]')).toBeNull();
});

it.each([
  ["management.request_invalid", { field: "showsRestOfOrder" }, true],
  ["station.not_found", {}, false],
] as const)(
  "shows a %s refusal in Settings without changing the saved station choice",
  async (code, params, fieldError) => {
    setLocale("en");
    const a = api({ updateStation: vi.fn().mockRejectedValue({ code, params }) });
    const el = await mount(a);
    const table = el.shadowRoot!.querySelector('[data-test="settings-table"]')!;
    await (table as HTMLElement & { updateComplete: Promise<boolean> }).updateComplete;
    const cell = (selector: string) => table.shadowRoot!.querySelector<HTMLElement>(selector)!;
    cell('[data-test="edit-settings-rest-bar"]').click();
    await settle(el);
    cell('[data-test="settings-choice"]').dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "yes" } }),
    );
    await settle(el);
    cell('[data-test="save-settings-cell"]').click();
    await settle(el);
    expect(a.updateStation).toHaveBeenCalledWith("bar", { showsRestOfOrder: true });
    const choice = cell('[data-test="settings-choice"]') as WtCombobox;
    expect(!!choice.error).toBe(fieldError);
    if (fieldError) expect(choice.error).toContain("could not be saved");
    else expect(cell("wt-form-actions").shadowRoot!.textContent).toContain("could not be saved");
    expect(cell('[data-test="save-settings-cell"]').hasAttribute("disabled")).toBe(false);
    cell('[data-test="cancel-settings-cell"]').click();
    await settle(el);
    expect(cell('[data-test="edit-settings-rest-bar"]').textContent?.trim()).toBe("No");
    cell('[data-test="edit-settings-rest-bar"]').click();
    await settle(el);
    expect((cell('[data-test="settings-choice"]') as WtCombobox).value).toBe("no");
  },
);

it("keeps station status and output problems in Stations instead of repeating them in Routing", async () => {
  setLocale("en");
  const next = withUpstairs({ open: false, why: "out_of_hours" });
  const outputs = {
    printersDown: [
      {
        stationId: "upstairs",
        stationName: "Upstairs bar",
        printerId: "epson",
        printerName: "Epson",
        since: "2026-10-01T20:14:00",
      },
    ],
    screensDark: [{ stationId: "upstairs", stationName: "Upstairs bar", lastSeenAt: null }],
  };
  const a = api({
    load: vi.fn().mockResolvedValue(next),
    readStationHealth: vi.fn().mockResolvedValue(healthFor(next, outputs)),
    listOutputsDown: vi.fn().mockResolvedValue(outputs),
  });
  const el = await mount(a);
  const routing = q(el, '[slot="routing"]')!;
  expect(routing.querySelector('[data-test="status-upstairs"]')).toBeNull();
  expect(routing.textContent).not.toContain("Printer Epson");
  expect(routing.textContent).not.toContain("has ever checked in");
  expect(healthRow(el, "upstairs").textContent).toContain("Printer Epson");
  expect(healthRow(el, "upstairs").textContent).toContain("has ever checked in");
  expect(healthRow(el, "upstairs").textContent).toContain("Closed now");
  expect(routing.querySelector('[data-test="station-upstairs"]')).not.toBeNull();
});
it("uses the health snapshot for output problems without a second management read", async () => {
  const a = api({
    listOutputsDown: vi.fn().mockResolvedValue({ printersDown: [], screensDark: [] }),
  });
  const el = await mount(a);
  expect(healthRow(el, "bar").textContent).toContain("Bar");
  expect(a.readStationHealth).toHaveBeenCalledTimes(1);
  expect(a.listOutputsDown).not.toHaveBeenCalled();
});
function healthFor(
  loaded: PrepStationsView,
  outputsDown: StationHealthSnapshot["outputsDown"],
): StationHealthSnapshot {
  return {
    capturedAt: "2026-10-05T12:00:00Z",
    stations: loaded.stations.map((station) => ({
      id: station.id,
      name: station.name,
      hasScreen: false,
      waiting: 0,
      preparing: null,
      ready: null,
      late: { warm: 0, overdue: 0, forgotten: 0 },
      oldestMinutes: null,
      items: [],
    })),
    outputsDown,
  };
}
function healthRow(el: PrepStationsScreen, stationId: string) {
  return healthSummary(el)!
    .querySelector(`[data-test="station-menu-${stationId}"]`)!
    .closest("tr")!;
}

it("keeps whole-station editing out of Routing while showing the grid", async () => {
  const a = api();
  const el = await mount(a);
  const routing = q(el, '[slot="routing"]')!;
  expect(routing.querySelector('[data-test="edit-bar"]')).toBeNull();
  expect(routing.querySelector("venue-routing-grid")).not.toBeNull();
  expect(q(el, '[data-test="rename-bar"]')).not.toBeNull();
  q(el, '[data-test="new-station"]')!.click();
  await settle(el);
  expect(q(el, '[data-test="name"]')).not.toBeNull();
  expect(q(el, '[data-test="displayOrder"]')).not.toBeNull();
  expect(q(el, '[data-test="overdue"]')).not.toBeNull();
  expect(a.updateStation).not.toHaveBeenCalled();
});

it("does not rename a station removed while its draft is open", async () => {
  const liveData = new LiveData();
  const load = vi
    .fn()
    .mockResolvedValueOnce(view)
    .mockResolvedValue({ ...view, stations: [] });
  const a = api({ liveData, load });
  const el = await mount(a);
  q(el, '[data-test="rename-bar"]')!.click();
  await settle(el);
  const input = q(el, '[data-test="station-rename"] wt-input') as WtInput;
  input.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Terrace bar" } }));
  await settle(el);
  const save = q(el, '[data-test="save-station-name"]')!;
  liveData.invalidate([{ type: "kitchen_stations", id: "bar" }]);
  await vi.waitFor(() => expect(q(el, '[data-test="rename-bar"]')).toBeNull());
  save.click();
  await settle(el);
  expect(a.updateStation).not.toHaveBeenCalled();
});

it("rejects unordered thresholds beside overdue in Settings and retains station disable", async () => {
  const a = api();
  const el = await mount(a);
  settingsQ(el, '[data-test="edit-settings-overdueAfterMinutes-bar"]')!.click();
  await settle(el);
  settingsQ(el, '[data-test="settings-minutes"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "5" } }),
  );
  await settle(el);
  settingsQ(el, '[data-test="save-settings-cell"]')!.click();
  await settle(el);
  expect((settingsQ(el, '[data-test="settings-minutes"]') as WtInput).error).not.toBe("");
  expect(a.updateStation).not.toHaveBeenCalled();
  q(el, '[data-test="disable-bar"]')!.click();
  await settle(el);
  q(el, '[data-test="confirm-station-action"]')!.click();
  await settle(el);
  expect(a.deactivateStation).toHaveBeenCalledWith("bar");
});

it("shows linked printers and kitchen screens in Tickets", async () => {
  const a = api({
    load: vi.fn().mockResolvedValue({
      ...view,
      printers: [{ id: "p1", name: "Bar printer" }],
      stationPrinters: [{ stationId: "bar", printerId: "p1" }],
      devices: [
        {
          id: "d1",
          label: "Bar display",
          kitchenScreens: [stationScreen([slot("bar", "Bar")])],
          kind: "kds_station",
          active: true,
        },
      ],
    }),
  });
  const el = await mount(a);
  const table = el.shadowRoot!.querySelector('[data-test="tickets-table"]')!;
  await (table as HTMLElement & { updateComplete: Promise<boolean> }).updateComplete;
  const printers = table.shadowRoot!.querySelector('[data-test="edit-printers-bar"]')!;
  const screens = table.shadowRoot!.querySelector('[data-test="screens-bar"]')!;
  expect(printers.textContent).toContain("Bar printer");
  expect(screens.textContent).toContain("Bar display");
  expect(screens.querySelector("a")?.getAttribute("href")).toBe("/manage/devices");
  expect(
    el
      .shadowRoot!.querySelector('[slot="routing"]')!
      .querySelector('a[href="/manage/printing-rules"]'),
  ).toBeNull();
});
it("creates a station from the modal with the chosen thresholds", async () => {
  const a = api();
  const el = await mount(a);
  q(el, '[data-test="new-station"]')!.click();
  await settle(el);
  q(el, '[data-test="name"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "Terrace" } }),
  );
  q(el, '[data-test="save-station"]')!.click();
  await settle(el);
  expect(a.createStation).toHaveBeenCalledWith({
    name: "Terrace",
    displayOrder: 0,
    warmAfterMinutes: 5,
    overdueAfterMinutes: 10,
    forgottenAfterMinutes: 15,
  });
});
it("makes a nondefault station the default", async () => {
  const changed = {
    ...view,
    stations: [
      ...view.stations,
      { ...view.stations[0]!, id: "terrace", name: "Terrace", isDefault: false, displayOrder: 2 },
    ],
  };
  const a = api({ load: vi.fn().mockResolvedValue(changed) });
  const el = await mount(a);
  q(el, '[data-test="make-default-terrace"]')!.click();
  await settle(el);
  expect(a.setDefaultStation).toHaveBeenCalledWith("terrace");
});
it.each([
  [
    "en",
    "date",
    "Bar would go back to its saved hours, which overlap a day next to the special date on Sun, 10 Jun 2096. Move or delete that special date on the Hours page first.",
  ],
  [
    "en",
    "opensAt",
    "Bar would go back to its saved hours, and its hours on the special date Sun, 10 Jun 2096 use a time the clock skips. Move or delete that special date on the Hours page first.",
  ],
  [
    "es",
    "date",
    "Bar volvería a su horario guardado, que se solapa con un día junto a la fecha especial del dom, 10 jun 2096. Cambia de día o borra primero esa fecha especial en la página Horarios.",
  ],
  [
    "es",
    "closesAt",
    "Bar volvería a su horario guardado, y su horario en la fecha especial del dom, 10 jun 2096 usa una hora que el reloj se salta. Cambia de día o borra primero esa fecha especial en la página Horarios.",
  ],
] as const)(
  "in %s, explains a Make default refused by the saved hours (%s) the default would resume",
  async (locale, field, message) => {
    setLocale(locale);
    const changed = {
      ...view,
      stations: [
        ...view.stations,
        { ...view.stations[0]!, id: "terrace", name: "Terrace", isDefault: false, displayOrder: 2 },
      ],
    };
    const a = api({
      load: vi.fn().mockResolvedValue(changed),
      setDefaultStation: vi.fn().mockRejectedValue({
        code: "hours.invalid",
        params: { field, date: "2096-06-10", subjectId: "bar" },
      }),
    });
    const el = await mount(a);
    q(el, '[data-test="make-default-terrace"]')!.click();
    await vi.waitFor(() => expect(q(el, '[role="alert"]')?.textContent?.trim()).toBe(message));
  },
);
it.each([
  ["a station it does not show", { field: "date", date: "2096-06-10", subjectId: "gone" }],
  ["no date", { field: "date", subjectId: "bar" }],
])("falls back to the generic message for an hours refusal naming %s", async (_, params) => {
  setLocale("en");
  const changed = {
    ...view,
    stations: [
      ...view.stations,
      { ...view.stations[0]!, id: "terrace", name: "Terrace", isDefault: false, displayOrder: 2 },
    ],
  };
  const a = api({
    load: vi.fn().mockResolvedValue(changed),
    setDefaultStation: vi.fn().mockRejectedValue({ code: "hours.invalid", params }),
  });
  const el = await mount(a);
  q(el, '[data-test="make-default-terrace"]')!.click();
  await vi.waitFor(() =>
    expect(q(el, '[role="alert"]')?.textContent?.trim()).toBe("The change could not be saved."),
  );
});
it("saves station name, order and thresholds through their individual controls", async () => {
  const next = withUpstairs({ open: true, why: "in_hours" });
  const a = api({ load: vi.fn().mockResolvedValue(next), reorderStations: vi.fn() });
  const el = await mount(a);
  q(el, '[data-test="rename-bar"]')!.click();
  await settle(el);
  q(el, 'wt-input[name="stationName"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "Terrace bar" } }),
  );
  await settle(el);
  q(el, '[data-test="save-station-name"]')!.click();
  await settle(el);
  expect(a.updateStation).toHaveBeenNthCalledWith(1, "bar", { name: "Terrace bar" });
  q(el, '[data-test="drag-bar"]')!.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, composed: true }),
  );
  await settle(el);
  expect(a.reorderStations).toHaveBeenCalledExactlyOnceWith(["upstairs", "bar"]);
  for (const [field, value, payload] of [
    ["warmAfterMinutes", "4", { warmAfterMinutes: 4 }],
    ["overdueAfterMinutes", "11", { overdueAfterMinutes: 11 }],
    ["forgottenAfterMinutes", "16", { forgottenAfterMinutes: 16 }],
  ] as const) {
    settingsQ(el, `[data-test="edit-settings-${field}-bar"]`)!.click();
    await settle(el);
    settingsQ(el, '[data-test="settings-minutes"]')!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value } }),
    );
    await settle(el);
    settingsQ(el, '[data-test="save-settings-cell"]')!.click();
    await settle(el);
    expect(a.updateStation).toHaveBeenLastCalledWith("bar", payload);
  }
  expect(a.updateStation).toHaveBeenCalledTimes(4);
});

it("places a taken-name refusal below Name", async () => {
  const a = api({ createStation: vi.fn().mockRejectedValue({ code: "station.name_taken" }) });
  const el = await mount(a);
  q(el, '[data-test="new-station"]')!.click();
  await settle(el);
  q(el, '[data-test="name"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "Bar" } }),
  );
  q(el, '[data-test="save-station"]')!.click();
  await settle(el);
  expect(q(el, '[data-field-error="name"]')?.textContent).toContain("already in use");
});
it("does not create an unnamed station", async () => {
  const a = api();
  const el = await mount(a);
  q(el, '[data-test="new-station"]')!.click();
  await settle(el);
  await editSaveField(el, q(el, 'wt-input[name="displayOrder"]')!, "2");
  q(el, '[data-test="save-station"]')!.click();
  await settle(el);
  expect(a.createStation).not.toHaveBeenCalled();
  expect(q(el, '[data-field-error="name"]')).not.toBeNull();
});
it("reports rejected station actions without exposing a code", async () => {
  const a = api({ deactivateStation: vi.fn().mockRejectedValue({ code: "station.not_found" }) });
  const el = await mount(a);
  q(el, '[data-test="disable-bar"]')!.click();
  await settle(el);
  q(el, '[data-test="confirm-station-action"]')!.click();
  await settle(el);
  expect(q(el, '[role="alert"]')?.textContent).toContain("could not be saved");
  expect(q(el, '[role="alert"]')?.textContent).not.toContain("station.not_found");
});
it("refreshes station cards after a kitchen-stations live change", async () => {
  const liveData = new LiveData();
  const changed = { ...view, stations: [{ ...view.stations[0]!, name: "New bar" }] };
  const load = vi.fn().mockResolvedValueOnce(view).mockResolvedValue(changed);
  const a = api({ liveData, load });
  const el = await mount(a);
  liveData.invalidate([{ type: "kitchen_stations", id: "bar" }]);
  await vi.waitFor(() =>
    expect(q(el, '[data-test="station-bar"]')?.textContent).toContain("New bar"),
  );
  expect(load).toHaveBeenCalledTimes(2);
});
it("creates a station with its name, order and thresholds when Enter is pressed in Order", async () => {
  const a = api();
  const el = await mount(a);
  q(el, '[data-test="new-station"]')!.click();
  await settle(el);
  q(el, '[data-test="name"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "Terrace bar" } }),
  );
  q(el, '[data-test="displayOrder"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "3" } }),
  );
  await settle(el);
  q(el, '[data-test="displayOrder"]')!
    .shadowRoot!.querySelector("input")!
    .dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        composed: true,
        cancelable: true,
      }),
    );
  await settle(el);
  expect(a.createStation).toHaveBeenCalledExactlyOnceWith({
    name: "Terrace bar",
    displayOrder: 3,
    warmAfterMinutes: 5,
    overdueAfterMinutes: 10,
    forgottenAfterMinutes: 15,
  });
  expect(a.updateStation).not.toHaveBeenCalled();
});

it("renames a station when Enter is pressed in its name field", async () => {
  const a = api({
    load: vi.fn().mockResolvedValue({
      ...view,
      stations: view.stations.map((station) => ({ ...station, name: "Before" })),
    }),
  });
  const el = await mount(a);
  q(el, '[data-test="rename-bar"]')!.click();
  await settle(el);
  await editSaveField(el, q(el, 'wt-input[name="stationName"]')!, "Bar");
  q(el, 'wt-input[name="stationName"]')!
    .shadowRoot!.querySelector("input")!
    .dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        composed: true,
        cancelable: true,
      }),
    );
  await settle(el);
  expect(a.updateStation).toHaveBeenCalledExactlyOnceWith("bar", { name: "Bar" });
});

it("does not save a nonnumeric threshold in Settings", async () => {
  const a = api();
  const el = await mount(a);
  settingsQ(el, '[data-test="edit-settings-overdueAfterMinutes-bar"]')!.click();
  await settle(el);
  settingsQ(el, '[data-test="settings-minutes"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "soon" } }),
  );
  await settle(el);
  settingsQ(el, '[data-test="save-settings-cell"]')!.click();
  await settle(el);
  expect(a.updateStation).not.toHaveBeenCalled();
  expect((settingsQ(el, '[data-test="settings-minutes"]') as WtInput).error).not.toBe("");
});

it("does not submit Enter for a rename draft whose station was removed by live refresh", async () => {
  const liveData = new LiveData();
  const load = vi
    .fn()
    .mockResolvedValueOnce(view)
    .mockResolvedValue({ ...view, stations: [] });
  const a = api({ liveData, load });
  const el = await mount(a);
  q(el, '[data-test="rename-bar"]')!.click();
  await settle(el);
  const input = q(el, 'wt-input[name="stationName"]')!.shadowRoot!.querySelector("input")!;
  liveData.invalidate([{ type: "kitchen_stations", id: "bar" }]);
  await vi.waitFor(() => expect(q(el, '[data-test="station-bar"]')).toBeNull());
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true, cancelable: true }),
  );
  await settle(el);
  expect(a.updateStation).not.toHaveBeenCalled();
});

it("guards repeated Enter rename saves while a station write is pending and allows retry", async () => {
  let reject!: (error: unknown) => void;
  const pending = new Promise((_, fail) => {
    reject = fail;
  });
  const updateStation = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(undefined);
  const a = api({
    updateStation,
    load: vi.fn().mockResolvedValue({
      ...view,
      stations: view.stations.map((station) => ({ ...station, name: "Before" })),
    }),
  });
  const el = await mount(a);
  q(el, '[data-test="rename-bar"]')!.click();
  await settle(el);
  await editSaveField(el, q(el, 'wt-input[name="stationName"]')!, "Bar");
  const input = q(el, 'wt-input[name="stationName"]')!.shadowRoot!.querySelector("input")!;
  const enter = () =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        composed: true,
        cancelable: true,
      }),
    );
  enter();
  enter();
  q(el, '[data-test="save-station-name"]')!.click();
  expect(updateStation).toHaveBeenCalledTimes(1);
  expect(updateStation).toHaveBeenCalledWith("bar", { name: "Bar" });
  reject({ code: "management.request_invalid" });
  await settle(el);
  enter();
  await settle(el);
  expect(updateStation).toHaveBeenCalledTimes(2);
  expect(updateStation).toHaveBeenLastCalledWith("bar", { name: "Bar" });
});

it("refuses negative order and invalid warm and forgotten thresholds together when creating", async () => {
  const a = api();
  const el = await mount(a);
  q(el, '[data-test="new-station"]')!.click();
  await settle(el);
  q(el, '[data-test="name"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "Terrace bar" } }),
  );
  for (const [field, value] of [
    ["displayOrder", "-1"],
    ["warmAfterMinutes", "0"],
    ["forgottenAfterMinutes", "10"],
  ]) {
    q(el, `[data-test="${field}"]`)!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value } }),
    );
  }
  await settle(el);
  q(el, '[data-test="save-station"]')!.click();
  await settle(el);
  for (const field of ["displayOrder", "warmAfterMinutes", "forgottenAfterMinutes"])
    expect(q(el, `[data-field-error="${field}"]`)).not.toBeNull();
  expect(a.createStation).not.toHaveBeenCalled();
  expect(a.updateStation).not.toHaveBeenCalled();
});

it("reports an initial routing load failure and recovers when live data refreshes", async () => {
  setLocale("en");
  const liveData = new LiveData();
  const a = api({
    liveData,
    load: vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(view),
  });
  const el = await mount(a);
  expect(q(el, '[role="alert"]')?.textContent).toContain("could not be loaded");
  liveData.invalidate([{ type: "kitchen_stations", id: "bar" }]);
  await vi.waitFor(() => expect(q(el, '[data-test="station-bar"]')).not.toBeNull());
  expect(q(el, '[role="alert"]')).toBeNull();
});

it("keeps a failed save's message through a later failed refresh and the recovery", async () => {
  setLocale("en");
  const liveData = new LiveData();
  const withTerrace = {
    ...view,
    stations: [
      ...view.stations,
      { ...view.stations[0]!, id: "terrace", name: "Terrace", isDefault: false, displayOrder: 2 },
    ],
  };
  const load = vi.fn().mockResolvedValue(withTerrace);
  const a = api({
    liveData,
    load,
    setDefaultStation: vi.fn().mockRejectedValue({ code: "connection.failed" }),
  });
  const el = await mount(a);
  load.mockRejectedValue({ code: "connection.failed" });
  liveData.refresh();
  await vi.waitFor(() =>
    expect(q(el, '[role="alert"]')?.textContent).toContain("could not be loaded"),
  );
  q(el, '[data-test="make-default-terrace"]')!.click();
  await vi.waitFor(() =>
    expect(q(el, '[role="alert"]')?.textContent).toContain("could not be saved"),
  );
  liveData.refresh();
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(3));
  await settle(el);
  load.mockResolvedValue(withTerrace);
  liveData.refresh();
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(4));
  await settle(el);
  expect(q(el, '[role="alert"]')?.textContent).toContain("could not be saved");
});

it("retains a disabled fallback in its editor but clears it for Disable", async () => {
  const next = withUpstairs(
    { open: false, why: "out_of_hours" },
    { fallbackStationId: "old", closedSendsTo: null },
  );
  next.routing.stations.push({ id: "old", name: "Old bar", active: false });
  const calls: string[] = [];
  const a = api({
    load: vi.fn().mockResolvedValue(next),
    setStationFallback: vi.fn(async (id, choice) => {
      calls.push(`fallback:${id}:${choice}`);
    }),
    deactivateStation: vi.fn(async (id) => {
      calls.push(`off:${id}`);
    }),
  });
  const el = await mount(a);
  const combo = (await openSettingsFallback(el)) as HTMLElement & {
    value: string;
    options: { value: string; label: string }[];
  };
  expect(combo.options).toContainEqual({ value: "old", label: "Old bar (disabled)" });
  expect(combo.value).toBe("old");
  settingsQ(el, '[data-test="cancel-settings-cell"]')!.click();
  await settle(el);
  q(el, '[data-test="disable-upstairs"]')!.click();
  await settle(el);
  expect((q(el, '[data-test="station-fallback"]') as typeof combo).value).toBe("");
  q(el, '[data-test="confirm-station-action"]')!.click();
  await settle(el);
  q(el, '[data-test="confirm-station-action"]')!.click();
  await settle(el);
  expect(calls).toEqual(["fallback:upstairs:null", "off:upstairs"]);
});

it.each(["opened_by_hand", "closed_by_hand"] as const)(
  "uses today before cutover for %s",
  async (why) => {
    const next = withUpstairs(
      why === "opened_by_hand" ? { open: true, why } : { open: false, why },
      { closedSendsTo: null },
    );
    next.routing.todayEnds = { timeOfDay: "06:00", tomorrow: false };
    const el = await mount(api({ load: vi.fn().mockResolvedValue(next) }));
    expect(healthRow(el, "upstairs").textContent).toContain("until 06:00 today");
    if (why === "closed_by_hand")
      expect(healthRow(el, "upstairs").textContent).toContain(
        "No replacement: the till will ask where to send its dishes.",
      );
    expect(q(el, '[data-test="change-fallback-bar"]')).toBeNull();
  },
);
it("reports unreadable venue time on every Stations row", async () => {
  const next = withUpstairs({ open: true, why: "in_hours" });
  next.routing.clockReadable = false;
  const el = await mount(api({ load: vi.fn().mockResolvedValue(next) }));
  for (const id of ["bar", "upstairs"])
    expect(healthRow(el, id).textContent).toContain(
      "Opening hours are not applied: the venue's time zone or day cutover cannot be read.",
    );
});
it.each([
  [true, true, "bar", "", "While Upstairs bar is closed, its work will go to Bar."],
  [false, true, "bar", "", "That starts now."],
  [
    false,
    false,
    "bar",
    "upstairs",
    "Bar is closed now as well, so for now it goes to Upstairs bar.",
  ],
  [
    false,
    false,
    "bar",
    null,
    "Bar is closed now as well and has no replacement, so for now the till will ask.",
  ],
  [
    true,
    true,
    "",
    null,
    "While Upstairs bar is closed, the till will ask where to send its dishes.",
  ],
] as const)(
  "confirms fallback with source open=%s target open=%s choice=%s",
  async (sourceOpen, targetOpen, choice, destination, expected) => {
    setLocale("en");
    const next = withUpstairs(
      sourceOpen ? { open: true, why: "in_hours" } : { open: false, why: "out_of_hours" },
      { fallbackStationId: choice ? null : "bar" },
    );
    next.routing.stationTimes[0] = {
      ...next.routing.stationTimes[0]!,
      status: targetOpen ? { open: true, why: "in_hours" } : { open: false, why: "out_of_hours" },
      closedSendsTo: destination || null,
    };
    const a = api({
      load: vi.fn().mockResolvedValue(next),
      setStationFallback: vi.fn(),
    });
    const el = await mount(a);
    const combo = (await openSettingsFallback(el)) as HTMLElement & {
      options: { value: string; label: string }[];
      placeholder: string;
    };
    expect(combo.options[0]).toEqual({ value: "", label: "No replacement (the till asks)" });
    expect(combo.placeholder).toBe("No replacement (the till asks)");
    expect(combo.options.filter((o) => o.value === "bar")).toEqual([
      { value: "bar", label: "Bar" },
    ]);
    combo.dispatchEvent(new CustomEvent("wt-change", { detail: { value: choice } }));
    await settle(el);
    settingsQ(el, '[data-test="save-settings-cell"]')!.click();
    await settle(el);
    expect(a.setStationFallback).not.toHaveBeenCalled();
    expect(settingsQ(el, '[data-test="settings-fallback-confirmation"]')!.textContent).toContain(
      expected,
    );
    if (sourceOpen)
      expect(
        settingsQ(el, '[data-test="settings-fallback-confirmation"]')!.textContent,
      ).not.toContain("That starts now.");
    settingsQ(el, '[data-test="save-settings-cell"]')!.click();
    await settle(el);
    if (choice) expect(a.setStationFallback).toHaveBeenCalledWith("upstairs", choice);
  },
);
it("saves no replacement as null", async () => {
  const a = api({
    load: vi.fn().mockResolvedValue(withUpstairs({ open: true, why: "in_hours" })),
    setStationFallback: vi.fn(),
  });
  const el = await mount(a);
  const combo = await openSettingsFallback(el);
  combo!.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "" } }));
  await settle(el);
  settingsQ(el, '[data-test="save-settings-cell"]')!.click();
  await settle(el);
  settingsQ(el, '[data-test="save-settings-cell"]')!.click();
  await settle(el);
  expect(a.setStationFallback).toHaveBeenCalledWith("upstairs", null);
});
it.each(["station.fallback_loop", "route.station_inactive"])(
  "puts %s beside the fallback",
  async (code) => {
    const a = api({
      load: vi
        .fn()
        .mockResolvedValue(
          withUpstairs({ open: false, why: "out_of_hours" }, { fallbackStationId: null }),
        ),
      setStationFallback: vi.fn().mockRejectedValue({ code }),
    });
    const el = await mount(a);
    const combo = await openSettingsFallback(el);
    combo!.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "bar" } }));
    await settle(el);
    settingsQ(el, '[data-test="save-settings-cell"]')!.click();
    await settle(el);
    settingsQ(el, '[data-test="save-settings-cell"]')!.click();
    await settle(el);
    expect((settingsQ(el, '[data-test="settings-choice"]') as WtCombobox).error).toContain(
      code === "station.fallback_loop"
        ? "loop"
        : "This station is disabled. Choose an active station.",
    );
  },
);
it("keeps the new fallback after a failed disable and reports the failure in the body", async () => {
  const calls: string[] = [];
  const next = withUpstairs({ open: true, why: "in_hours" }, { fallbackStationId: null });
  const a = api({
    load: vi.fn().mockResolvedValue(next),
    setStationFallback: vi.fn(async () => {
      calls.push("fallback");
    }),
    deactivateStation: vi.fn(async () => {
      calls.push("off");
      throw new Error("offline");
    }),
  });
  const el = await mount(a);
  q(el, '[data-test="disable-upstairs"]')!.click();
  await settle(el);
  q(el, '[data-test="station-fallback"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "bar" } }),
  );
  await settle(el);
  q(el, '[data-test="confirm-station-action"]')!.click();
  await settle(el);
  q(el, '[data-test="confirm-station-action"]')!.click();
  await settle(el);
  expect(calls).toEqual(["fallback", "off"]);
  expect(q(el, '[data-test="station-upstairs"]')).not.toBeNull();
  const alert = q(el, '[data-test="station-action-modal"]')!.querySelector('[role="alert"]')!;
  expect(alert.textContent).toContain("could not be saved");
  expect(alert.nextElementSibling?.localName).toBe("wt-form-actions");
});
it.each([
  {
    locale: "en",
    disable: "Disable",
    confirm: "Disable Upstairs bar? Its work will go to:",
    heading: "Disabled",
    hint: "Disabled: no replacement, the till asks",
    enable: "Enable",
  },
  {
    locale: "es-ES",
    disable: "Deshabilitar",
    confirm: "¿Deshabilitar Upstairs bar? Su trabajo irá a:",
    heading: "Deshabilitada",
    hint: "Deshabilitada: sin sustituta, el TPV pregunta",
    enable: "Habilitar",
  },
] as const)(
  "in $locale, offers Disable on a station and Enable on a disabled one",
  async ({ locale, disable, confirm, heading, hint, enable }) => {
    setLocale(locale);
    const on = await mount(
      api({ load: vi.fn().mockResolvedValue(withUpstairs({ open: true, why: "in_hours" })) }),
    );
    const off = q(on, '[data-test="disable-upstairs"]')!;
    expect(off.textContent!.trim()).toBe(disable);
    off.click();
    await settle(on);
    const modal = q(on, '[data-test="station-action-modal"]')!;
    expect(modal.getAttribute("heading")).toBe(disable);
    expect(modal.textContent).toContain(confirm);
    const next = withUpstairs({ open: false, why: "switched_off" }, { closedSendsTo: null });
    next.stations[1]!.active = false;
    next.routing.stations[1]!.active = false;
    const el = await mount(api({ load: vi.fn().mockResolvedValue(next) }));
    const row = healthRow(el, "upstairs");
    expect(row.querySelector('[part="badge"]')!.textContent!.trim()).toBe(heading);
    expect(q(el, '[data-test="inactive-upstairs"]')!.textContent).toContain(hint);
    const back = q(el, '[data-test="enable-upstairs"]')!;
    expect(back.textContent!.trim()).toBe(enable);
    back.click();
    await settle(el);
    expect(q(el, '[data-test="station-action-modal"]')!.getAttribute("heading")).toBe(enable);
  },
);
it("switches an inactive station on and keeps its dark-screen warning in its Stations row", async () => {
  const next = withUpstairs({ open: false, why: "switched_off" }, { closedSendsTo: null });
  next.stations[1]!.active = false;
  next.routing.stations[1]!.active = false;
  const a = api({
    load: vi.fn().mockResolvedValue(next),
    activateStation: vi.fn(),
    readStationHealth: vi.fn().mockResolvedValue(
      healthFor(next, {
        printersDown: [],
        screensDark: [{ stationId: "upstairs", stationName: "Upstairs bar", lastSeenAt: null }],
      }),
    ),
  });
  const el = await mount(a);
  expect(q(el, '[data-test="inactive-upstairs"]')!.textContent).toContain(
    "No replacement: the till asks.",
  );
  expect(healthRow(el, "upstairs").textContent).toContain("has ever checked in");
  expect(healthRow(el, "bar").textContent).not.toContain("has ever checked in");
  q(el, '[data-test="enable-upstairs"]')!.click();
  await settle(el);
  q(el, '[data-test="confirm-station-action"]')!.click();
  await settle(el);
  expect(a.activateStation).toHaveBeenCalledWith("upstairs");
});
it("shows each output warning only on its station", async () => {
  const next = withUpstairs({ open: true, why: "in_hours" });
  const a = api({
    load: vi.fn().mockResolvedValue(next),
    readStationHealth: vi.fn().mockResolvedValue(
      healthFor(next, {
        printersDown: [
          {
            stationId: "upstairs",
            stationName: "Upstairs bar",
            printerId: "epson",
            printerName: "Epson",
            since: "2026-10-01T20:14:00",
          },
        ],
        screensDark: [
          { stationId: "upstairs", stationName: "Upstairs bar", lastSeenAt: "2026-10-01T20:10:00" },
        ],
      }),
    ),
  });
  const el = await mount(a);
  const card = healthRow(el, "upstairs");
  expect(card.textContent).toContain(
    "Printer Epson has printed nothing since something sent to it at 20:14 got stuck.",
  );
  expect(card.textContent).toContain(
    "Dishes are waiting, and no kitchen screen here has checked in since 20:10.",
  );
  expect(healthRow(el, "bar").textContent).not.toContain("got stuck");
  expect(healthRow(el, "bar").textContent).not.toContain("Dishes are waiting");
});
it("refreshes output warnings every fifteen seconds and clears the timer when removed", async () => {
  const timers = new Map<ReturnType<typeof setInterval>, TimerHandler>();
  const original = window.setInterval.bind(window);
  const interval = vi.spyOn(window, "setInterval").mockImplementation((handler, delay, ...args) => {
    const id = original(handler, delay, ...args) as unknown as ReturnType<typeof setInterval>;
    if (delay === 15_000) timers.set(id, handler);
    return id;
  });
  const clear = vi.spyOn(window, "clearInterval");
  try {
    const next = withUpstairs({ open: true, why: "in_hours" });
    const a = api({
      load: vi.fn().mockResolvedValue(next),
      readStationHealth: vi
        .fn()
        .mockResolvedValueOnce(healthFor(next, { printersDown: [], screensDark: [] }))
        .mockResolvedValue(
          healthFor(next, {
            printersDown: [],
            screensDark: [{ stationId: "upstairs", stationName: "Upstairs bar", lastSeenAt: null }],
          }),
        ),
    });
    const el = await mount(a);
    expect(healthRow(el, "upstairs").textContent).not.toContain("has ever checked in");
    for (const handler of timers.values()) if (typeof handler === "function") handler();
    await settle(el);
    expect(healthRow(el, "upstairs").textContent).toContain("has ever checked in");
    el.remove();
    expect(
      [...timers.keys()].some((id) => clear.mock.calls.some(([cleared]) => cleared === id)),
    ).toBe(true);
  } finally {
    interval.mockRestore();
    clear.mockRestore();
  }
});

it("offers the fallback in Settings and confirms a changed selection", async () => {
  const a = api({
    load: vi.fn().mockResolvedValue(withUpstairs({ open: false, why: "out_of_hours" })),
    setStationFallback: vi.fn(),
  });
  const el = await mount(a);
  const combo = (await openSettingsFallback(el)) as HTMLElement & {
    value: string;
    options: { value: string; label: string }[];
  };
  expect(combo).not.toBeNull();
  expect(combo.value).toBe("bar");
  expect(combo.options[0]).toEqual({ value: "", label: "No replacement (the till asks)" });
  combo.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "" } }));
  await settle(el);
  settingsQ(el, '[data-test="save-settings-cell"]')!.click();
  await settle(el);
  expect(settingsQ(el, '[data-test="settings-fallback-confirmation"]')!.textContent).toContain(
    "While Upstairs bar is closed, the till will ask where to send its dishes.",
  );
  expect(a.setStationFallback).not.toHaveBeenCalled();
  settingsQ(el, '[data-test="save-settings-cell"]')!.click();
  await settle(el);
  expect(a.setStationFallback).toHaveBeenCalledWith("upstairs", null);
});

it("refreshes the saved fallback when the following disable fails", async () => {
  const server = withUpstairs(
    { open: false, why: "out_of_hours" },
    { fallbackStationId: null, closedSendsTo: null },
  );
  const a = api({
    load: vi.fn(async () => structuredClone(server)),
    setStationFallback: vi.fn(async () => {
      server.routing.stationTimes[1] = {
        ...server.routing.stationTimes[1]!,
        fallbackStationId: "bar",
        closedSendsTo: "bar",
      };
    }),
    deactivateStation: vi.fn().mockRejectedValue(new Error("offline")),
  });
  const el = await mount(a);
  q(el, '[data-test="disable-upstairs"]')!.click();
  await settle(el);
  q(el, '[data-test="station-fallback"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "bar" } }),
  );
  await settle(el);
  q(el, '[data-test="confirm-station-action"]')!.click();
  await settle(el);
  q(el, '[data-test="confirm-station-action"]')!.click();
  await settle(el);
  expect((await openSettingsFallback(el)).value).toBe("bar");
  expect(healthRow(el, "upstairs").textContent).toContain("Its work goes to Bar.");
  expect(
    q(el, '[data-test="station-action-modal"]')!.querySelector('[role="alert"]')!.textContent,
  ).toContain("could not be saved");
});

it("localizes the fallback search field in Spanish", async () => {
  setLocale("es-ES");
  const el = await mount(
    api({ load: vi.fn().mockResolvedValue(withUpstairs({ open: true, why: "in_hours" })) }),
  );
  const combo = await openSettingsFallback(el);
  combo.shadowRoot!.querySelector<HTMLElement>(".trigger")!.click();
  await settle(el);
  expect(combo.shadowRoot!.querySelector<HTMLInputElement>("input")!.placeholder).toBe(
    "Buscar estaciones",
  );
});

const healthSnapshot: StationHealthSnapshot = {
  capturedAt: "2026-10-05T12:00:00Z",
  outputsDown: { printersDown: [], screensDark: [] },
  stations: [
    {
      id: "bar",
      name: "Bar",
      hasScreen: true,
      waiting: 1,
      preparing: 0,
      ready: 0,
      late: { warm: 0, overdue: 0, forgotten: 0 },
      oldestMinutes: 4,
      items: [
        {
          id: "soup",
          name: "KITCHEN SOUP",
          orderId: "o1",
          orderNumber: 7,
          label: null,
          tableNames: ["Table 5"],
          state: "queued",
          queuedAt: "2026-10-05T11:56:00Z",
          remainingQuantity: "1.000",
          band: "fresh",
        },
      ],
    },
  ],
};
function healthSummary(el: PrepStationsScreen) {
  return el.shadowRoot
    ?.querySelector("prep-station-health-table")
    ?.shadowRoot?.querySelector("wt-data-table")?.shadowRoot;
}
it("subscribes dish health to ticket changes and retains an open station draft", async () => {
  const liveData = new LiveData();
  const readStationHealth = vi.fn().mockResolvedValue(healthSnapshot);
  const el = await mount(api({ liveData, readStationHealth }));
  expect(healthSummary(el)?.querySelector('[data-test="waiting-bar"]')?.textContent?.trim()).toBe(
    "1",
  );
  q(el, '[data-test="new-station"]')!.click();
  await settle(el);
  const name =
    el.shadowRoot!.querySelector<WtInput>('[name="stationName"]') ??
    el.shadowRoot!.querySelector<WtInput>('[name="name"]');
  expect(name).toBeTruthy();
  name!.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Draft station" } }));
  readStationHealth.mockResolvedValue({
    ...healthSnapshot,
    stations: [{ ...healthSnapshot.stations[0]!, waiting: 2 }],
  });
  liveData.invalidate([{ type: "ticket_items", id: "new-ticket" }]);
  await settle(el);
  expect(healthSummary(el)?.querySelector('[data-test="waiting-bar"]')?.textContent?.trim()).toBe(
    "2",
  );
  expect(name!.value).toBe("Draft station");
});
it("refreshes elapsed health without a write and releases both interests and clock on detach", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    const liveData = new LiveData();
    const readStationHealth = vi.fn().mockResolvedValue(healthSnapshot);
    const el = await mount(api({ liveData, readStationHealth }));
    expect(healthSummary(el)?.querySelector('[data-test="oldest-bar"]')?.textContent?.trim()).toBe(
      "4 min",
    );
    readStationHealth.mockResolvedValue({
      ...healthSnapshot,
      stations: [
        {
          ...healthSnapshot.stations[0]!,
          oldestMinutes: 5,
          late: { warm: 1, overdue: 0, forgotten: 0 },
        },
      ],
    });
    await vi.advanceTimersByTimeAsync(15_000);
    await settle(el);
    expect(healthSummary(el)?.querySelector('[data-test="oldest-bar"]')?.textContent?.trim()).toBe(
      "5 min",
    );
    expect(healthSummary(el)?.querySelector('[data-test="warm-bar"]')?.textContent?.trim()).toBe(
      "1",
    );
    el.remove();
    expect(liveData.interests).toEqual([]);
    const count = readStationHealth.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(readStationHealth).toHaveBeenCalledTimes(count);
  } finally {
    vi.useRealTimers();
  }
});
it("a health read failure stays until health recovers, while routing recovery retains an action refusal", async () => {
  const liveData = new LiveData();
  const readStationHealth = vi.fn().mockRejectedValue(new Error("offline"));
  const el = await mount(
    api({
      liveData,
      readStationHealth,
      createStation: vi.fn().mockRejectedValue(new Error("refused")),
    }),
  );
  expect(el.shadowRoot!.textContent).toContain("Prep stations could not be loaded.");
  liveData.invalidate([{ type: "categories" }]);
  await settle(el);
  expect(el.shadowRoot!.textContent).toContain("Prep stations could not be loaded.");
  readStationHealth.mockResolvedValue(healthSnapshot);
  liveData.invalidate([{ type: "ticket_items" }]);
  await settle(el);
  expect(el.shadowRoot!.textContent).not.toContain("Prep stations could not be loaded.");
  q(el, '[data-test="new-station"]')!.click();
  await settle(el);
  const name =
    el.shadowRoot!.querySelector<WtInput>('[name="stationName"]') ??
    el.shadowRoot!.querySelector<WtInput>('[name="name"]');
  name!.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "New bar" } }));
  await settle(el);
  q(el, '[data-test="save-station"]')!.click();
  await settle(el);
  liveData.invalidate([{ type: "ticket_items" }, { type: "categories" }]);
  await settle(el);
  expect(el.shadowRoot!.textContent).toContain("The change could not be saved.");
});
it("a health snapshot ahead of routing metadata leaves Today blank until the station's status arrives", async () => {
  const el = await mount(
    api({
      readStationHealth: vi.fn().mockResolvedValue(healthSnapshot),
      load: vi.fn().mockResolvedValue({ ...view, routing: { ...view.routing, stationTimes: [] } }),
    }),
  );
  const row = healthSummary(el)?.querySelector("tbody tr");
  expect(row).toBeTruthy();
  expect(row!.querySelectorAll("td")[1]?.textContent?.trim()).toBe("");
});

it("opens the default Stations tab and places Add station, the only create action, beside the tabs", async () => {
  setLocale("en");
  history.replaceState(null, "", "/manage/prep-stations");
  const el = await mount(api());
  const tabs = el.shadowRoot!.querySelector("wt-tabs");
  expect(tabs, "the page owns a tab strip").not.toBeNull();
  await tabs!.updateComplete;
  expect(tabs!.items).toEqual([
    { key: "stations", label: "Stations" },
    { key: "routing", label: "Routing" },
    { key: "tickets", label: "Tickets" },
    { key: "watchers", label: "Watchers" },
    { key: "settings", label: "Settings" },
  ]);
  expect(tabs!.value).toBe("stations");
  expect(location.pathname).toBe("/manage/prep-stations/view/stations");
  expect(q(el, '[data-test="new-station"]')!.closest('[slot="actions"]')).not.toBeNull();
  expect(q(el, '[data-test="new-station"]')!.textContent!.trim()).toBe("Add station");
  expect(
    [...q(el, '[slot="actions"]')!.children].map((child) => child.getAttribute("data-test")),
  ).toEqual(["new-station"]);
  expect(q(el, '[data-test="new-watcher"]')).toBeNull();
});

it.each(["tickets", "watchers", "settings"])(
  "opens the %s tab an old tester link names, and its next tab change drops the tester's product",
  async (tab) => {
    history.replaceState(null, "", `/manage/prep-stations/view/${tab}/test/bread`);
    const el = await mount(api());
    const tabs = el.shadowRoot!.querySelector("wt-tabs");
    expect(tabs, "the page owns a tab strip").not.toBeNull();
    await tabs!.updateComplete;
    expect(tabs!.value).toBe(tab);
    tabs!.shadowRoot!.querySelector<HTMLButtonElement>('[data-key="routing"]')!.click();
    await settle(el);
    expect(location.pathname).toBe("/manage/prep-stations/view/routing");
    expect(q(el, '[data-test="route-tester"]')).toBeNull();
    expect(await routingGrid(el)).not.toBeNull();
    expect(q(el, '[data-test="station-bar"]')!.closest('[slot="routing"]')).not.toBeNull();
  },
);

it("opens Routing from an old tester link that names it, and its next tab change writes no tester segment", async () => {
  history.replaceState(null, "", "/manage/prep-stations/view/routing/test/lager");
  const el = await mount(api());
  const tabs = el.shadowRoot!.querySelector("wt-tabs")!;
  await tabs.updateComplete;
  expect(tabs.value).toBe("routing");
  expect(await routingGrid(el)).not.toBeNull();
  expect(q(el, '[data-test="route-tester"]')).toBeNull();
  tabs.shadowRoot!.querySelector<HTMLButtonElement>('[data-key="watchers"]')!.click();
  await settle(el);
  expect(tabs.value).toBe("watchers");
  expect(location.pathname).toBe("/manage/prep-stations/view/watchers");
});

it("opens Stations from an old tester link that names no tab, and restores panels on Back without adding history entries", async () => {
  history.replaceState(null, "", "/manage/prep-stations/test/bread");
  const count = history.length;
  const el = await mount(api());
  const tabs = el.shadowRoot!.querySelector("wt-tabs");
  expect(tabs, "the page owns a tab strip").not.toBeNull();
  await tabs!.updateComplete;
  expect(tabs!.value).toBe("stations");
  expect(location.pathname).toBe("/manage/prep-stations/view/stations");
  expect(history.length).toBe(count);
  history.replaceState(null, "", "/manage/prep-stations/view/watchers");
  dispatchEvent(new PopStateEvent("popstate"));
  await settle(el);
  expect(tabs!.value).toBe("watchers");
  expect(history.length).toBe(count);
});

it("replaces invalid tabs with Stations and ignores nested tab changes", async () => {
  history.replaceState(null, "", "/manage/prep-stations/view/missing");
  const count = history.length;
  const el = await mount(api());
  const tabs = el.shadowRoot!.querySelector("wt-tabs");
  expect(tabs, "the page owns a tab strip").not.toBeNull();
  await tabs!.updateComplete;
  expect(tabs!.value).toBe("stations");
  expect(location.pathname).toBe("/manage/prep-stations/view/stations");
  expect(history.length).toBe(count);
  q(el, '[slot="routing"]')!.dispatchEvent(
    new CustomEvent("wt-tab-change", {
      detail: { value: "settings" },
      bubbles: true,
      composed: true,
    }),
  );
  await settle(el);
  expect(tabs!.value).toBe("stations");
  expect(location.pathname).toBe("/manage/prep-stations/view/stations");
});

it("has no station hours section, editor or Today actions", async () => {
  setLocale("en");
  const el = await mount(
    api({ load: vi.fn().mockResolvedValue(withUpstairs({ open: true, why: "in_hours" })) }),
  );
  expect(q(el, '[data-test="interim-station-hours"]')).toBeNull();
  for (const id of ["bar", "upstairs"]) expect(q(el, `[data-test="edit-hours-${id}"]`)).toBeNull();
  expect(customElements.get("station-hours-form")).toBeUndefined();
  expect(el.shadowRoot!.textContent).not.toContain("Edit hours");
  expect(healthRow(el, "upstairs").querySelector('[data-test="close-today-upstairs"]')).toBeNull();
  expect(q(el, '[data-test="station-action-modal"]')).toBeNull();
  expect(el.shadowRoot!.querySelector("station-hours-form")).toBeNull();
});

it("Today redraws the scheduled label when the next background read no longer carries the by-hand closure", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  try {
    setLocale("en");
    const closed = withUpstairs(
      { open: false, why: "closed_by_hand" },
      { today: "closed", nextTransition: { weekday: 6, timeOfDay: "01:00", daysAhead: 1 } },
    );
    const nextDay = withUpstairs(
      { open: true, why: "in_hours" },
      { today: null, nextTransition: { weekday: 6, timeOfDay: "01:00", daysAhead: 1 } },
    );
    const { el } = await mountToday(closed, {
      background: { load: vi.fn().mockResolvedValue(nextDay) } as unknown as PrepStationsApi,
    });
    const cell = () =>
      healthSummary(el)!.querySelectorAll("tbody tr")[1]!.querySelectorAll("td")[1]!;
    expect(cell().textContent).toContain(
      "Closed now, closed by hand until 06:00 tomorrow. Its work goes to Bar.",
    );
    expect(cell().querySelector("wt-button")).toBeNull();
    await vi.advanceTimersByTimeAsync(60_000);
    await settle(el);
    expect(cell().textContent).toContain("Open until 01:00 tomorrow");
    expect(cell().querySelector('[data-test="schedule-upstairs"]')).toBeNull();
    expect(cell().querySelector('[data-test="close-today-upstairs"]')).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it.each([
  {
    locale: "en",
    heading: "Category or product",
    field:
      "All categories, Every zone: Bar, the default station. Bar (default) — as an extra, follows its dish",
    disable: "Disable",
    enable: "Enable",
  },
  {
    locale: "es",
    heading: "Categoría o producto",
    field:
      "Todas las categorías, Todas las zonas: Bar, la estación predeterminada. Bar (predeterminada) — como extra, sigue a su plato",
    disable: "Deshabilitar",
    enable: "Habilitar",
  },
])(
  "uses category and Disable/Enable wording for retained stations and watchers ($locale)",
  async ({ locale, heading, field, disable, enable }) => {
    setLocale(locale);
    const disabled = { ...upstairs, active: false };
    const pass = {
      id: "pass",
      name: "Pass",
      active: true,
      displayOrder: 0,
      everyStation: true,
      stationIds: [],
      everyZone: true,
      zoneIds: [],
      runsPass: true,
      printerIds: [],
      inUse: true,
    };
    const el = await mount(
      api({
        load: vi
          .fn()
          .mockResolvedValue({ ...view, stations: [...view.stations, disabled], watchers: [pass] }),
      }),
    );
    const grid = (await routingGrid(el))!;
    expect(grid.shadowRoot!.querySelector("thead th")!.textContent!.trim()).toBe(heading);
    expect(q(el, '[data-test="disable-bar"]')!.textContent!.trim()).toBe(disable);
    expect(q(el, '[data-test="enable-upstairs"]')!.textContent!.trim()).toBe(enable);
    expect(q(el, '[data-test="remove-watcher-pass"]')!.textContent!.trim()).toBe(disable);
    expect(gridCombo(grid, "all", "every")!.label).toBe(field);
  },
);

it.each([
  { locale: "en", width: 310 },
  { locale: "en", width: 390 },
  { locale: "es", width: 310 },
  { locale: "es", width: 390 },
] as const)(
  "keeps half of a $width px tab row for the tabs, with the selected tab whole ($locale)",
  async ({ locale, width }) => {
    setLocale(locale);
    const el = await mount(
      api({
        load: vi.fn().mockResolvedValue(withUpstairs({ open: true, why: "in_hours" })),
        readStationHealth: vi.fn().mockResolvedValue(healthSnapshot),
      }),
    );
    el.parentElement!.style.width = `${width}px`;
    const tabs = el.shadowRoot!.querySelector("wt-tabs")!;
    await tabs.updateComplete;
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    const row = tabs.shadowRoot!.querySelector('[part="tab-row"]')!.getBoundingClientRect();
    const strip = tabs.shadowRoot!.querySelector("[role=tablist]")!.getBoundingClientRect();
    const selected = tabs
      .shadowRoot!.querySelector('[aria-selected="true"]')!
      .getBoundingClientRect();
    expect(tabs.querySelectorAll('[slot="actions"] wt-button')).toHaveLength(1);
    expect(strip.width).toBeGreaterThanOrEqual(row.width / 2 - 1);
    expect(selected.left).toBeGreaterThanOrEqual(strip.left - 1);
    expect(selected.right).toBeLessThanOrEqual(strip.right + 1);
  },
);

it.each([
  { locale: "en", theme: "light", width: 390 },
  { locale: "en", theme: "dark", width: 390 },
  { locale: "es", theme: "light", width: 390 },
  { locale: "es", theme: "dark", width: 390 },
  { locale: "en", theme: "light", width: 1280 },
  { locale: "en", theme: "dark", width: 1280 },
  { locale: "es", theme: "light", width: 1280 },
  { locale: "es", theme: "dark", width: 1280 },
] as const)(
  "keeps subject tabs accessible and inside the viewport ($locale/$theme/$width)",
  async ({ locale, theme, width }) => {
    const previous = {
      width: window.innerWidth,
      height: window.innerHeight,
      bodyBackground: document.body.style.background,
      canvasBackground: document.documentElement.style.background,
    };
    try {
      await page.viewport(width, 900);
      setLocale(locale);
      history.replaceState(null, "", "/manage/prep-stations");
      const el = await mount(
        api({
          load: vi.fn().mockResolvedValue(withUpstairs({ open: true, why: "in_hours" })),
          readStationHealth: vi.fn().mockResolvedValue(healthSnapshot),
        }),
        theme,
      );
      const themedHost = el.parentElement!;
      themedHost.style.background = "var(--wt-color-bg)";
      const canvas = getComputedStyle(themedHost).backgroundColor;
      document.body.style.background = canvas;
      document.documentElement.style.background = canvas;
      const tabs = el.shadowRoot!.querySelector("wt-tabs")!;
      await tabs.updateComplete;
      for (const key of ["stations", "routing", "tickets", "watchers", "settings"]) {
        const button = tabs.shadowRoot!.querySelector<HTMLButtonElement>(`[data-key="${key}"]`)!;
        await page.elementLocator(button).click();
        await settle(el);
        await tabs.updateComplete;
        expect(button.getAttribute("aria-selected")).toBe("true");
        expect(tabs.shadowRoot!.querySelectorAll('[role="tabpanel"]:not([hidden])')).toHaveLength(
          1,
        );
        expect(location.pathname).toBe(`/manage/prep-stations/view/${key}`);
        expect(tabs.getBoundingClientRect().right).toBeLessThanOrEqual(width);
        expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
        await expectNoA11yViolations(el.parentElement!);
      }
    } finally {
      document.body.style.background = previous.bodyBackground;
      document.documentElement.style.background = previous.canvasBackground;
      await page.viewport(previous.width, previous.height);
    }
  },
);

async function mountToday(
  next: PrepStationsView,
  overrides: Partial<PrepStationsApi> = {},
  theme?: "light" | "dark",
) {
  history.replaceState(null, "", "/manage/prep-stations/view/stations");
  const a = api({
    load: vi.fn().mockResolvedValue(next),
    readStationHealth: vi.fn().mockResolvedValue({
      ...healthSnapshot,
      stations: next.stations.map((station) => ({
        ...healthSnapshot.stations[0]!,
        id: station.id,
        name: station.name,
      })),
    }),
    ...overrides,
  });
  return { a, el: await mount(a, theme) };
}
it("Today leaves default and unscheduled stations always open without a closure action", async () => {
  setLocale("en");
  const { el } = await mountToday(withUpstairs({ open: true, why: "no_hours" }));
  const rows = healthSummary(el)!.querySelectorAll("tbody tr");
  for (const row of rows) {
    expect(row.querySelectorAll("td")[1]!.textContent!.trim()).toBe("Always open");
    expect(row.querySelectorAll("td")[1]!.querySelector("wt-button")).toBeNull();
  }
});
it("Today names the chosen destination without offering a schedule action", async () => {
  setLocale("en");
  const { el } = await mountToday(
    withUpstairs(
      { open: false, why: "closed_by_hand" },
      {
        today: "closed",
        fallbackStationId: "another-closed-station",
        closedSendsTo: "bar",
      },
    ),
  );
  const cell = healthSummary(el)!.querySelectorAll("tbody tr")[1]!.querySelectorAll("td")[1]!;
  expect(cell.textContent).toContain("Its work goes to Bar.");
  expect(cell.querySelector("wt-button")).toBeNull();
  expect(q(el, '[data-test="station-action-modal"]')).toBeNull();
});
it("Today offers no hours action for disabled stations or an unreadable venue clock", async () => {
  setLocale("en");
  const next = withUpstairs({ open: false, why: "switched_off" });
  next.stations[1]!.active = false;
  next.routing.clockReadable = false;
  const { el } = await mountToday(next);
  const cells = [...healthSummary(el)!.querySelectorAll("tbody tr")].map(
    (row) => row.querySelectorAll("td")[1]!,
  );
  expect(cells[0]!.textContent).toContain("cannot be read");
  expect(cells[1]!.textContent!.trim()).toBe("Disabled");
  for (const cell of cells) expect(cell.querySelector("wt-button")).toBeNull();
});
it.each([
  ["en", "light", 390],
  ["en", "dark", 390],
  ["es", "light", 390],
  ["es", "dark", 390],
  ["en", "light", 1280],
  ["en", "dark", 1280],
  ["es", "light", 1280],
  ["es", "dark", 1280],
] as const)("Today status remains accessible in %s %s at %ipx", async (locale, theme, width) => {
  const previous = {
    width: window.innerWidth,
    height: window.innerHeight,
    body: document.body.style.background,
    canvas: document.documentElement.style.background,
  };
  try {
    await page.viewport(width, 900);
    expect(window.innerWidth).toBe(width);
    setLocale(locale);
    history.replaceState(null, "", "/manage/prep-stations");
    const next = withUpstairs(
      { open: true, why: "in_hours" },
      {
        hours: [{ weekday: 1, opensAt: "12:00", closesAt: "01:00" }],
        nextTransition: { weekday: 2, timeOfDay: "01:00", daysAhead: 1 },
      },
    );
    const closed = { ...upstairs, id: "closed", name: "Kitchen", displayOrder: 3 };
    next.stations.push(closed);
    next.routing.stationTimes.push({
      ...next.routing.stationTimes[1]!,
      stationId: "closed",
      status: { open: false, why: "closed_by_hand" },
      today: "closed",
    });
    const { el } = await mountToday(next, {}, theme);
    const host = el.parentElement!;
    host.style.background = "var(--wt-color-bg)";
    const canvas = getComputedStyle(host).backgroundColor;
    document.body.style.background = canvas;
    document.documentElement.style.background = canvas;
    const summary = healthSummary(el)!;
    expect(summary.querySelector('[data-test="close-today-upstairs"]')).toBeNull();
    expect(summary.querySelector('[data-test="schedule-closed"]')).toBeNull();
    expect(summary.textContent).toContain(
      locale === "en" ? "Open until 01:00 tomorrow" : "Abierta hasta las 01:00 mañana",
    );
    expect(summary.textContent).toContain(
      locale === "en" ? "Its work goes to Bar." : "Su trabajo va a Bar.",
    );
    expect(el.getBoundingClientRect().right).toBeLessThanOrEqual(width);
    await expectNoA11yViolations(host);
    await page.screenshot({ path: `__screenshots__/a8-stations-${locale}-${theme}-${width}.png` });
    const fallback = await openSettingsFallback(el);
    expect(fallback.label).toBe(
      locale === "en"
        ? "Upstairs bar: Outside its hours, work goes to"
        : "Upstairs bar: Fuera de su horario, el trabajo va a",
    );
    await expectNoA11yViolations(host);
    fallback.scrollIntoView({ block: "nearest", inline: "end" });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(fallback.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
    expect(fallback.getBoundingClientRect().right).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `__screenshots__/a8-settings-${locale}-${theme}-${width}.png` });
  } finally {
    document.body.style.background = previous.body;
    document.documentElement.style.background = previous.canvas;
    await page.viewport(previous.width, previous.height);
  }
});

it.each([
  ["en", true, 1, "Open until 01:00 tomorrow"],
  ["es", true, 1, "Abierta hasta las 01:00 mañana"],
  ["en", false, 0, "Opens at 12:00"],
  ["es", false, 0, "Abre a las 12:00"],
  ["en", false, 3, "Opens at 12:00 on Monday"],
  ["es", false, 3, "Abre a las 12:00 el Lunes"],
] as const)(
  "Today shows the next scheduled transition in %s (open=%s, days=%i)",
  async (locale, open, daysAhead, expected) => {
    setLocale(locale);
    const { el } = await mountToday(
      withUpstairs(open ? { open: true, why: "in_hours" } : { open: false, why: "out_of_hours" }, {
        nextTransition: {
          weekday: daysAhead === 3 ? 1 : open ? 6 : 5,
          timeOfDay: open ? "01:00" : "12:00",
          daysAhead,
        },
      }),
    );
    const cell = healthSummary(el)!.querySelectorAll("tbody tr")[1]!.querySelectorAll("td")[1]!;
    expect(cell.textContent).toContain(expected);
    expect(
      cell.querySelector(`[data-test="${open ? "close" : "open"}-today-upstairs"]`),
    ).toBeNull();
  },
);

it.each([false, true])(
  "Today changes at a schedule boundary without a database event (live=%s)",
  async (live) => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      setLocale("en");
      const before = withUpstairs(
        { open: false, why: "out_of_hours" },
        {
          hours: [{ weekday: 5, opensAt: "12:00", closesAt: "01:00" }],
          nextTransition: { weekday: 5, timeOfDay: "12:00", daysAhead: 0 },
        },
      );
      const after = withUpstairs(
        { open: true, why: "in_hours" },
        {
          hours: before.routing.stationTimes[1]!.hours,
          nextTransition: { weekday: 6, timeOfDay: "01:00", daysAhead: 1 },
        },
      );
      const backgroundLoad = vi.fn().mockResolvedValue(after);
      const { el } = await mountToday(before, {
        ...(live ? { liveData: new LiveData() } : {}),
        background: { load: backgroundLoad } as unknown as PrepStationsApi,
      });
      expect(healthSummary(el)!.querySelector('[data-test="open-today-upstairs"]')).toBeNull();
      expect(healthSummary(el)!.textContent).toContain("Opens at 12:00");
      await vi.advanceTimersByTimeAsync(60_000);
      await settle(el);
      const cell = healthSummary(el)!.querySelectorAll("tbody tr")[1]!.querySelectorAll("td")[1]!;
      expect(cell.textContent).toContain("Open until 01:00 tomorrow");
      expect(cell.querySelector('[data-test="close-today-upstairs"]')).toBeNull();
      expect(cell.querySelector('[data-test="open-today-upstairs"]')).toBeNull();
      el.remove();
      const count = backgroundLoad.mock.calls.length;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(backgroundLoad).toHaveBeenCalledTimes(count);
    } finally {
      vi.useRealTimers();
    }
  },
);

it.each([
  ["en", "Rename", "Disable", "Enable"],
  ["es", "Cambiar nombre", "Deshabilitar", "Habilitar"],
])(
  "Stations row menus identify their row and use retained-state wording in %s",
  async (locale, rename, disable, enable) => {
    setLocale(locale as "en" | "es");
    const next = withUpstairs({ open: true, why: "in_hours" });
    next.stations.push({ ...upstairs, id: "retired", name: "Retired", active: false });
    const { el } = await mountToday(next);
    const summary = healthSummary(el)!;
    const menu = summary.querySelector('wt-row-actions[data-test="station-menu-upstairs"]');
    expect(menu).not.toBeNull();
    expect(menu!.getAttribute("label")).toContain("Upstairs bar");
    expect(menu!.querySelector('[data-test="rename-upstairs"]')!.textContent).toContain(rename);
    expect(menu!.querySelector('[data-test="disable-upstairs"]')!.textContent).toContain(disable);
    expect(menu!.querySelector('[data-test="make-default-upstairs"]')).not.toBeNull();
    expect(summary.querySelector('[data-test="make-default-bar"]')).toBeNull();
    expect(summary.querySelector('[data-test="enable-retired"]')!.textContent).toContain(enable);
    expect(summary.querySelector('[data-test="disable-retired"]')).toBeNull();
    expect(summary.querySelector('[data-test="make-default-retired"]')).toBeNull();
  },
);
it("renames from Stations without submitting timing settings and closes before a failed refresh", async () => {
  const next = withUpstairs({ open: true, why: "in_hours" });
  const load = vi.fn().mockResolvedValueOnce(next).mockRejectedValue({ code: "connection.failed" });
  const { el, a } = await mountToday(next, { load });
  const action = healthSummary(el)!.querySelector<HTMLElement>('[data-test="rename-upstairs"]');
  expect(action).not.toBeNull();
  action!.click();
  await settle(el);
  const name = q(el, 'wt-input[name="stationName"]') as WtInput;
  expect(name).not.toBeNull();
  name.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Cold kitchen" } }));
  await settle(el);
  q(el, '[data-test="save-station-name"]')!.click();
  await settle(el);
  expect(a.updateStation).toHaveBeenCalledWith("upstairs", { name: "Cold kitchen" });
  expect(q(el, '[data-test="station-rename"]')).toBeNull();
  expect(q(el, '[role="alert"]')!.textContent).toContain("could not be loaded");
});
it("keeps a refused station name editable, marks duplicates and validates a corrected blank locally", async () => {
  const { el, a } = await mountToday(withUpstairs({ open: true, why: "in_hours" }), {
    updateStation: vi
      .fn()
      .mockRejectedValueOnce({ code: "station.name_taken" })
      .mockResolvedValue(undefined),
  });
  const action = healthSummary(el)!.querySelector<HTMLElement>('[data-test="rename-upstairs"]');
  expect(action).not.toBeNull();
  action!.click();
  await settle(el);
  await editSaveField(el, q(el, 'wt-input[name="stationName"]')!, "Renamed upstairs");
  q(el, '[data-test="save-station-name"]')!.click();
  await settle(el);
  expect(q(el, '[data-test="station-rename"]')).not.toBeNull();
  expect((q(el, 'wt-input[name="stationName"]') as WtInput).error).toContain("already");
  expect(q(el, '[data-test="save-station-name"]')!.hasAttribute("disabled")).toBe(false);
  const name = q(el, 'wt-input[name="stationName"]')!;
  name.dispatchEvent(new CustomEvent("wt-change", { detail: { value: " " } }));
  await settle(el);
  q(el, '[data-test="save-station-name"]')!.click();
  await settle(el);
  expect(a.updateStation).toHaveBeenCalledTimes(1);
  expect(q(el, '[data-test="save-station-name"]')!.hasAttribute("disabled")).toBe(true);
  name.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "New name" } }));
  await settle(el);
  name
    .shadowRoot!.querySelector("input")!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
  await settle(el);
  expect(a.updateStation).toHaveBeenLastCalledWith("upstairs", { name: "New name" });
  expect(q(el, '[data-test="station-rename"]')).toBeNull();
});
it("Stations row actions reuse default and retained disable/enable writes", async () => {
  const next = withUpstairs({ open: true, why: "in_hours" });
  const { el, a } = await mountToday(next, { activateStation: vi.fn() });
  const makeDefault = healthSummary(el)!.querySelector<HTMLElement>(
    '[data-test="make-default-upstairs"]',
  );
  expect(makeDefault).not.toBeNull();
  makeDefault!.click();
  await settle(el);
  expect(a.setDefaultStation).toHaveBeenCalledWith("upstairs");
  healthSummary(el)!.querySelector<HTMLElement>('[data-test="disable-upstairs"]')!.click();
  await settle(el);
  expect(a.deactivateStation).not.toHaveBeenCalled();
  q(el, '[data-test="confirm-station-action"]')!.click();
  await settle(el);
  expect(a.deactivateStation).not.toHaveBeenCalled();
  q(el, '[data-test="confirm-station-action"]')!.click();
  await settle(el);
  expect(a.deactivateStation).toHaveBeenCalledWith("upstairs");
  next.stations[1]!.active = false;
  await (el as unknown as { requestUpdate(): void }).requestUpdate();
  await settle(el);
  healthSummary(el)!.querySelector<HTMLElement>('[data-test="enable-upstairs"]')!.click();
  await settle(el);
  q(el, '[data-test="confirm-station-action"]')!.click();
  await settle(el);
  expect(a.activateStation).toHaveBeenCalledWith("upstairs");
});

it("reorders Stations with the keyboard, retains focus and leaves routing cells unchanged", async () => {
  const next = withUpstairs({ open: true, why: "in_hours" });
  const order = vi.fn().mockImplementation(async (ids: string[]) => {
    ids.forEach((id, index) => {
      next.stations.find((station) => station.id === id)!.displayOrder = index;
    });
  });
  const { el } = await mountToday(next, { reorderStations: order } as Partial<PrepStationsApi>);
  const handle = healthSummary(el)!.querySelector<HTMLButtonElement>('[data-test="drag-upstairs"]');
  expect(handle).not.toBeNull();
  handle!.focus();
  handle!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  await settle(el);
  expect(order).toHaveBeenCalledWith(["upstairs", "bar"]);
  expect(
    [...healthSummary(el)!.querySelectorAll("tbody tr")].map((row) =>
      row.querySelector("wt-row-actions")!.getAttribute("data-test"),
    ),
  ).toEqual(["station-menu-upstairs", "station-menu-bar"]);
  expect(healthSummary(el)!.activeElement?.getAttribute("data-test")).toBe("drag-upstairs");
  expect(next.routing.cells).toEqual(view.routing.cells);
  expect(next.routing.defaultStationId).toBe(view.routing.defaultStationId);
});
it("restores the Stations order after refusal and never moves disabled rows", async () => {
  const next = withUpstairs({ open: true, why: "in_hours" });
  next.stations.push({ ...upstairs, id: "retired", name: "Retired", active: false });
  const order = vi.fn().mockRejectedValue({ code: "connection.failed" });
  const { el } = await mountToday(next, { reorderStations: order } as Partial<PrepStationsApi>);
  expect(healthSummary(el)!.querySelector('[data-test="drag-retired"]')).toBeNull();
  const handle = healthSummary(el)!.querySelector<HTMLButtonElement>('[data-test="drag-upstairs"]');
  expect(handle).not.toBeNull();
  handle!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  await settle(el);
  expect(order).toHaveBeenCalledWith(["upstairs", "bar"]);
  expect(
    [...healthSummary(el)!.querySelectorAll("tbody tr")].map((row) =>
      row.querySelector("wt-row-actions")!.getAttribute("data-test"),
    ),
  ).toEqual(["station-menu-bar", "station-menu-upstairs", "station-menu-retired"]);
  expect(q(el, '[role="alert"]')!.textContent).toContain("could not be saved");
});
it("persists a pointer reorder once on release and releases the drag on disconnect", async () => {
  const next = withUpstairs({ open: true, why: "in_hours" });
  const order = vi.fn().mockResolvedValue(undefined);
  const { el } = await mountToday(next, { reorderStations: order } as Partial<PrepStationsApi>);
  const summary = healthSummary(el)!;
  const handle = summary.querySelector<HTMLButtonElement>('[data-test="drag-upstairs"]');
  expect(handle).not.toBeNull();
  const target = summary
    .querySelector('[data-test="station-menu-bar"]')!
    .closest("tr")!
    .getBoundingClientRect();
  handle!.dispatchEvent(
    new PointerEvent("pointerdown", {
      pointerId: 91,
      clientY: handle!.getBoundingClientRect().top,
      bubbles: true,
    }),
  );
  document.dispatchEvent(
    new PointerEvent("pointermove", { pointerId: 91, clientY: target.top + target.height / 2 }),
  );
  await settle(el);
  expect(order).not.toHaveBeenCalled();
  document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 91 }));
  await settle(el);
  expect(order).toHaveBeenCalledExactlyOnceWith(["upstairs", "bar"]);
  const nextHandle = healthSummary(el)!.querySelector<HTMLButtonElement>(
    '[data-test="drag-upstairs"]',
  )!;
  nextHandle.dispatchEvent(
    new PointerEvent("pointerdown", {
      pointerId: 92,
      clientY: nextHandle.getBoundingClientRect().top,
      bubbles: true,
    }),
  );
  el.remove();
  document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 92 }));
  expect(order).toHaveBeenCalledTimes(1);
  expect(document.body.style.cursor).not.toBe("grabbing");
});

it("keeps a general rename refusal below the field and permits retry", async () => {
  const { el, a } = await mountToday(withUpstairs({ open: true, why: "in_hours" }), {
    updateStation: vi
      .fn()
      .mockRejectedValueOnce({ code: "connection.failed" })
      .mockResolvedValue(undefined),
  });
  healthSummary(el)!.querySelector<HTMLElement>('[data-test="rename-upstairs"]')!.click();
  await settle(el);
  await editSaveField(el, q(el, 'wt-input[name="stationName"]')!, "Renamed upstairs");
  q(el, '[data-test="save-station-name"]')!.click();
  await settle(el);
  expect((q(el, 'wt-input[name="stationName"]') as WtInput).error).toBe("");
  expect(q(el, '[data-test="station-rename"]')!.textContent).toContain("could not be saved");
  q(el, '[data-test="save-station-name"]')!.click();
  await settle(el);
  expect(a.updateStation).toHaveBeenCalledTimes(2);
  expect(q(el, '[data-test="station-rename"]')).toBeNull();
});
it("announces the reordered station and its position to a screen reader", async () => {
  const { el } = await mountToday(withUpstairs({ open: true, why: "in_hours" }), {
    reorderStations: vi.fn().mockResolvedValue(undefined),
  });
  healthSummary(el)!
    .querySelector<HTMLElement>('[data-test="drag-upstairs"]')!
    .dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  await settle(el);
  expect(q(el, '[data-test="station-order-status"]')?.textContent?.trim()).toBe(
    "Upstairs bar is now 1 of 2.",
  );
});

it.each([
  ["en", "light", 390],
  ["en", "dark", 390],
  ["es", "light", 390],
  ["es", "dark", 390],
  ["en", "light", 1280],
  ["en", "dark", 1280],
  ["es", "light", 1280],
  ["es", "dark", 1280],
] as const)(
  "Stations menus and rename remain accessible in %s %s at %ipx",
  async (locale, theme, width) => {
    const previous = {
      width: window.innerWidth,
      height: window.innerHeight,
      body: document.body.style.background,
      canvas: document.documentElement.style.background,
    };
    try {
      await page.viewport(width, 900);
      setLocale(locale);
      history.replaceState(null, "", "/manage/prep-stations");
      const next = withUpstairs({ open: true, why: "in_hours" });
      next.stations.push({ ...upstairs, id: "retired", name: "Retired", active: false });
      next.routing.stations.push({ id: "retired", name: "Retired", active: false });
      const { el } = await mountToday(next, {}, theme);
      expect(window.innerWidth).toBe(width);
      const host = el.parentElement!;
      host.style.background = "var(--wt-color-bg)";
      document.body.style.background = getComputedStyle(host).backgroundColor;
      document.documentElement.style.background = getComputedStyle(host).backgroundColor;
      const menu = healthSummary(el)!.querySelector(
        'wt-row-actions[data-test="station-menu-upstairs"]',
      )!;
      await page.elementLocator(menu.shadowRoot!.querySelector("button")!).click();
      await settle(el);
      await expectNoA11yViolations(host);
      await page.screenshot({
        path: `__screenshots__/look/station-actions-${locale}-${theme}-${width}-menu.png`,
      });
      const rename = menu.querySelector<HTMLElement>('[data-test="rename-upstairs"]')!;
      await page.elementLocator(rename).click();
      await settle(el);
      expect(menu.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(false);
      expect(
        q(el, '[data-test="station-rename"]')!.getBoundingClientRect().right,
      ).toBeLessThanOrEqual(width);
      await expectNoA11yViolations(host);
      await page.screenshot({
        path: `__screenshots__/look/station-actions-${locale}-${theme}-${width}-rename.png`,
      });
      q(el, '[data-test="station-rename"]')!
        .querySelector<HTMLElement>('wt-button[slot="cancel"]')!
        .click();
      await settle(el);
      const disabledMenu = healthSummary(el)!.querySelector(
        'wt-row-actions[data-test="station-menu-retired"]',
      )!;
      await page.elementLocator(disabledMenu.shadowRoot!.querySelector("button")!).click();
      await settle(el);
      expect(disabledMenu.querySelector('[data-test="enable-retired"]')).not.toBeNull();
      expect(disabledMenu.querySelector('[data-test="disable-retired"]')).toBeNull();
      await expectNoA11yViolations(host);
      await page.screenshot({
        path: `__screenshots__/look/station-actions-${locale}-${theme}-${width}-disabled-menu.png`,
      });
    } finally {
      document.body.style.background = previous.body;
      document.documentElement.style.background = previous.canvas;
      await page.viewport(previous.width, previous.height);
    }
  },
);

const slot = (id: string, name: string, available = true) => ({
  id,
  name,
  available,
  switchedOff: false,
});
const stationScreen = (
  stations: ReturnType<typeof slot>[],
  kind: "station" | "pass" | "pass_monitor" = "station",
) => ({
  kind,
  available: true,
  everyStation: false,
  everyZone: true,
  profileEveryStation: true,
  stations,
  zones: null,
});
const ticketView: PrepStationsView = {
  ...view,
  stations: [...view.stations, upstairs],
  printers: [
    { id: "old", name: "Old printer", active: true },
    { id: "next", name: "Next printer", active: true },
    { id: "watcher", name: "Pass printer", active: true, watcherId: "pass" },
    { id: "disabled", name: "Disabled printer", active: false },
  ],
  stationPrinters: [{ stationId: "bar", printerId: "old" }],
  devices: [
    {
      id: "current",
      label: "Bar screen",
      kitchenScreens: [stationScreen([slot("bar", "Bar")])],
      kind: "kds_station",
      active: true,
    },
    {
      id: "elsewhere",
      label: "Other screen",
      kitchenScreens: [stationScreen([slot("upstairs", "Upstairs bar")])],
      kind: "kds_station",
      active: true,
    },
    {
      id: "off",
      label: "Disabled screen",
      kitchenScreens: [stationScreen([slot("bar", "Bar")])],
      kind: "kds_station",
      active: false,
    },
  ],
  watchers: [
    {
      id: "pass",
      name: "Pass",
      active: true,
      displayOrder: 0,
      everyStation: false,
      stationIds: ["bar"],
      everyZone: true,
      zoneIds: [],
      runsPass: true,
      printerIds: ["watcher"],
      inUse: true,
    },
  ],
};
async function mountTickets(overrides: Partial<PrepStationsApi> = {}) {
  history.replaceState(null, "", "/manage/prep-stations/view/tickets");
  const a = api({
    load: vi.fn().mockResolvedValue(ticketView),
    setStationPrinters: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });
  const el = await mount(a);
  await settle(el);
  const table = el.shadowRoot!.querySelector<HTMLElement>(
    'wt-data-table[data-test="tickets-table"]',
  );
  expect(table, "Tickets lists station outputs").not.toBeNull();
  await (table as HTMLElement & { updateComplete: Promise<boolean> }).updateComplete;
  return { el, a, table: table! };
}
const ticketQ = (table: HTMLElement, selector: string) =>
  table.shadowRoot!.querySelector<HTMLElement>(selector);

it("Tickets names each station's printed and current screen outputs with separate relationship links", async () => {
  const { table } = await mountTickets();
  expect(table.shadowRoot!.textContent).toContain("Old printer");
  const bar = ticketQ(table, '[data-test="screens-bar"]')!;
  expect(bar.textContent).toContain("Bar screen");
  expect(bar.textContent).not.toContain("Other screen");
  expect(bar.textContent).not.toContain("Disabled screen");
  expect(bar.querySelector("a")!.getAttribute("href")).toBe("/manage/devices");
  const watchers = ticketQ(table, '[data-test="watchers-bar"]')!;
  expect(watchers.textContent).toContain("Pass");
  expect(watchers.querySelector("a")!.getAttribute("href")).toBe(
    "/manage/prep-stations/view/watchers",
  );
  expect(ticketQ(table, '[data-test="watchers-upstairs"]')!.textContent).not.toContain("Pass");
  expect(bar.querySelector("wt-combobox")).toBeNull();
  expect(watchers.querySelector("wt-combobox")).toBeNull();
});

it.each([
  {
    locale: "en",
    bar: ["Bar screen — station screen", "Pass — pass screen", "Till 2 — station screen"],
    upstairs: ["Other screen — station screen", "Pass — pass screen", "Expo — pass monitor"],
  },
  {
    locale: "es",
    bar: [
      "Bar screen — pantalla de estación",
      "Pass — pantalla de pase",
      "Till 2 — pantalla de estación",
    ],
    upstairs: [
      "Other screen — pantalla de estación",
      "Pass — pantalla de pase",
      "Expo — monitor de pase",
    ],
  },
])(
  "Tickets names every device whose kitchen screen shows the station, with the screen's kind ($locale)",
  async ({ locale, bar, upstairs }) => {
    const server = structuredClone(ticketView);
    server.devices.push(
      {
        id: "pass",
        label: "Pass",
        kind: "kds_station",
        active: true,
        kitchenScreens: [
          stationScreen([slot("bar", "Bar"), slot("upstairs", "Upstairs bar")], "pass"),
        ],
      },
      {
        id: "till-grill",
        label: "Till 2",
        kind: "till",
        active: true,
        kitchenScreens: [stationScreen([slot("bar", "Bar")])],
      },
      { id: "till-none", label: "Till 1", kind: "till", active: true, kitchenScreens: [] },
      {
        id: "expo",
        label: "Expo",
        kind: "kds_station",
        active: true,
        kitchenScreens: [
          stationScreen(
            [slot("bar", "Bar", false), slot("upstairs", "Upstairs bar")],
            "pass_monitor",
          ),
        ],
      },
    );
    setLocale(locale);
    const { table } = await mountTickets({ load: vi.fn().mockResolvedValue(server) });
    const names = (id: string) =>
      [
        ...ticketQ(table, `[data-test="screens-${id}"]`)!.querySelectorAll(
          "[data-test=screen-device]",
        ),
      ].map((device) => device.textContent!.trim());
    expect(names("bar")).toEqual(bar);
    expect(names("upstairs")).toEqual(upstairs);
  },
);

it("Tickets opens its printer cell as a multi-select, explains unavailable choices and saves once", async () => {
  const { el, a, table } = await mountTickets();
  ticketQ(table, '[data-test="edit-printers-bar"]')!.click();
  await settle(el);
  const combo = ticketQ(table, '[data-test="station-printers-bar"]') as WtCombobox;
  expect(combo.multiple).toBe(true);
  expect(combo.values).toEqual(["old"]);
  expect(combo.options.find((o) => o.value === "watcher")).toMatchObject({
    disabled: true,
    description: "Used by watcher Pass",
  });
  expect(combo.options.find((o) => o.value === "disabled")).toMatchObject({
    disabled: true,
    description: "Disabled",
  });
  combo.dispatchEvent(
    new CustomEvent("wt-change", {
      detail: { values: ["old", "next"] },
      bubbles: true,
      composed: true,
    }),
  );
  await settle(el);
  expect(a.setStationPrinters).not.toHaveBeenCalled();
  ticketQ(table, '[data-test="save-printers-bar"]')!.click();
  await vi.waitFor(() =>
    expect(a.setStationPrinters).toHaveBeenCalledExactlyOnceWith("bar", ["old", "next"]),
  );
  await settle(el);
  expect(ticketQ(table, '[data-test="station-printers-bar"]')).toBeNull();
});

it("Tickets cancels a pending selection without submitting it", async () => {
  const { el, a, table } = await mountTickets();
  ticketQ(table, '[data-test="edit-printers-bar"]')!.click();
  await settle(el);
  ticketQ(table, '[data-test="station-printers-bar"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { values: ["next"] } }),
  );
  await settle(el);
  ticketQ(table, '[data-test="cancel-printers-bar"]')!.click();
  await settle(el);
  expect(a.setStationPrinters).not.toHaveBeenCalled();
  expect(ticketQ(table, '[data-test="edit-printers-bar"]')!.textContent).toContain("Old printer");
});

it("Tickets retains a refused set beside its field and allows correction and retry", async () => {
  const save = vi
    .fn()
    .mockRejectedValueOnce({ code: "printer.makes_and_watches" })
    .mockResolvedValue(undefined);
  const { el, table } = await mountTickets({ setStationPrinters: save });
  ticketQ(table, '[data-test="edit-printers-bar"]')!.click();
  await settle(el);
  ticketQ(table, '[data-test="station-printers-bar"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { values: ["next"] } }),
  );
  await settle(el);
  ticketQ(table, '[data-test="save-printers-bar"]')!.click();
  await vi.waitFor(() => expect(ticketQ(table, '[data-field-error="printerIds"]')).not.toBeNull());
  expect((ticketQ(table, '[data-test="station-printers-bar"]') as WtCombobox).values).toEqual([
    "next",
  ]);
  expect(
    (ticketQ(table, '[data-test="save-printers-bar"]') as HTMLElement & { disabled: boolean })
      .disabled,
  ).toBe(false);
  ticketQ(table, '[data-test="save-printers-bar"]')!.click();
  await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  await settle(el);
  expect(ticketQ(table, '[data-test="station-printers-bar"]')).toBeNull();
});

it("Tickets closes after the write succeeds even if its following refresh fails", async () => {
  const load = vi.fn().mockResolvedValueOnce(ticketView).mockRejectedValue(new Error("offline"));
  const { el, table } = await mountTickets({ load });
  ticketQ(table, '[data-test="edit-printers-bar"]')!.click();
  await settle(el);
  await editSaveField(el, ticketQ(table, '[data-test="station-printers-bar"]')!, ["next"]);
  ticketQ(table, '[data-test="save-printers-bar"]')!.click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.textContent).toContain("Prep stations could not be loaded."),
  );
  expect(ticketQ(table, '[data-test="station-printers-bar"]')).toBeNull();
  expect(el.shadowRoot!.textContent).not.toContain("The change could not be saved.");
});

it("Tickets lets a retained disabled printer be removed, then refuses to offer it again", async () => {
  const retained = {
    ...ticketView,
    stationPrinters: [{ stationId: "bar", printerId: "disabled" }],
  };
  const { el, a, table } = await mountTickets({ load: vi.fn().mockResolvedValue(retained) });
  ticketQ(table, '[data-test="edit-printers-bar"]')!.click();
  await settle(el);
  const combo = ticketQ(table, '[data-test="station-printers-bar"]') as WtCombobox;
  await combo.updateComplete;
  expect(combo.options.find((o) => o.value === "disabled")!.disabled).toBe(false);
  combo.shadowRoot!.querySelector<HTMLButtonElement>(".trigger")!.click();
  await combo.updateComplete;
  const choice = [...combo.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')].find(
    (option) => option.textContent?.includes("Disabled printer"),
  )!;
  choice.click();
  await settle(el);
  expect(combo.values).toEqual([]);
  expect(combo.options.find((o) => o.value === "disabled")!.disabled).toBe(true);
  ticketQ(table, '[data-test="save-printers-bar"]')!.click();
  await vi.waitFor(() => expect(a.setStationPrinters).toHaveBeenCalledExactlyOnceWith("bar", []));
});

it("Tickets keeps a failed selection editable while reporting a general refusal at the page", async () => {
  const { el, table } = await mountTickets({
    setStationPrinters: vi.fn().mockRejectedValue({ code: "connection.failed" }),
  });
  ticketQ(table, '[data-test="edit-printers-bar"]')!.click();
  await settle(el);
  await editSaveField(el, ticketQ(table, '[data-test="station-printers-bar"]')!, ["next"]);
  ticketQ(table, '[data-test="save-printers-bar"]')!.click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.textContent).toContain("The change could not be saved."),
  );
  expect((ticketQ(table, '[data-test="station-printers-bar"]') as WtCombobox).error).toBe("");
  expect(
    (ticketQ(table, '[data-test="save-printers-bar"]') as HTMLElement & { disabled: boolean })
      .disabled,
  ).toBe(false);
});

it("Tickets preserves an open printer draft when mappings refresh live", async () => {
  const liveData = new LiveData();
  const load = vi
    .fn()
    .mockResolvedValueOnce(ticketView)
    .mockResolvedValue({ ...ticketView, stationPrinters: [] });
  const { el, a, table } = await mountTickets({ liveData, load });
  ticketQ(table, '[data-test="edit-printers-bar"]')!.click();
  await settle(el);
  ticketQ(table, '[data-test="station-printers-bar"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { values: ["old", "next"] } }),
  );
  await settle(el);
  liveData.invalidate([{ type: "station_printers", id: "bar" }]);
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  await settle(el);
  const retained = ticketQ(table, '[data-test="station-printers-bar"]') as WtCombobox | null;
  expect(retained, "mapping refresh retains the editable selection").not.toBeNull();
  expect(retained!.values).toEqual(["old", "next"]);
  ticketQ(table, '[data-test="save-printers-bar"]')!.click();
  await vi.waitFor(() =>
    expect(a.setStationPrinters).toHaveBeenCalledExactlyOnceWith("bar", ["old", "next"]),
  );
});

it.each([
  ["en", "light", 390],
  ["en", "dark", 390],
  ["es", "light", 390],
  ["es", "dark", 390],
  ["en", "light", 1280],
  ["en", "dark", 1280],
  ["es", "light", 1280],
  ["es", "dark", 1280],
] as const)(
  "Tickets picker and refusal are accessible in %s %s at %ipx",
  async (locale, theme, width) => {
    const previous = {
      width: window.innerWidth,
      height: window.innerHeight,
      body: document.body.style.background,
      canvas: document.documentElement.style.background,
    };
    try {
      await page.viewport(width, 900);
      setLocale(locale);
      const save = vi.fn().mockRejectedValue({ code: "printer.makes_and_watches" });
      const { el, table } = await mountTickets({ setStationPrinters: save });
      const host = el.parentElement!;
      host.setAttribute("data-theme", theme);
      host.style.background = "var(--wt-color-bg)";
      document.body.style.background = getComputedStyle(host).backgroundColor;
      document.documentElement.style.background = getComputedStyle(host).backgroundColor;
      await expectNoA11yViolations(host);
      ticketQ(table, '[data-test="edit-printers-bar"]')!.click();
      await settle(el);
      const combo = ticketQ(table, '[data-test="station-printers-bar"]') as WtCombobox;
      await combo.updateComplete;
      await page.elementLocator(combo.shadowRoot!.querySelector(".trigger")!).click();
      await combo.updateComplete;
      const list = combo.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
      expect(list.matches(":popover-open")).toBe(true);
      expect(list.getBoundingClientRect().right).toBeLessThanOrEqual(width);
      await expectNoA11yViolations(host);
      await page.elementLocator(combo.shadowRoot!.querySelector(".trigger")!).click();
      await editSaveField(el, combo, ["next"]);
      ticketQ(table, '[data-test="save-printers-bar"]')!.click();
      await vi.waitFor(() => expect(combo.error).not.toBe(""));
      expect(combo.getBoundingClientRect().right).toBeLessThanOrEqual(width);
      await expectNoA11yViolations(host);
    } finally {
      document.body.style.background = previous.body;
      document.documentElement.style.background = previous.canvas;
      await page.viewport(previous.width, previous.height);
    }
  },
);

it.each([
  ["en", "2 printers", "No results"],
  ["es", "2 impresoras", "Sin resultados"],
])("Tickets localises multiple choices and an empty search in %s", async (locale, count, empty) => {
  setLocale(locale!);
  const { el, table } = await mountTickets();
  ticketQ(table, '[data-test="edit-printers-bar"]')!.click();
  await settle(el);
  const combo = ticketQ(table, '[data-test="station-printers-bar"]') as WtCombobox;
  combo.dispatchEvent(new CustomEvent("wt-change", { detail: { values: ["old", "next"] } }));
  await settle(el);
  await combo.updateComplete;
  expect(combo.shadowRoot!.querySelector(".trigger")!.textContent).toContain(count);
  combo.shadowRoot!.querySelector<HTMLButtonElement>(".trigger")!.click();
  await combo.updateComplete;
  const search = combo.shadowRoot!.querySelector<HTMLInputElement>(".search")!;
  search.value = "missing printer";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  await combo.updateComplete;
  expect(combo.shadowRoot!.querySelector(".empty")!.textContent).toContain(empty);
});

it("Tickets retains station printer memberships independently for each station", async () => {
  setLocale("en");
  const { el, a, table } = await mountTickets();
  expect(ticketQ(table, '[data-test="edit-printers-bar"]')!.textContent).toContain("Old printer");
  expect(ticketQ(table, '[data-test="edit-printers-upstairs"]')!.textContent).toContain("None");
  for (const [stationId, ids, label] of [
    ["bar", ["old"], "Bar: Printed on"],
    ["upstairs", [], "Upstairs bar: Printed on"],
  ] as const) {
    ticketQ(table, `[data-test="edit-printers-${stationId}"]`)!.click();
    await settle(el);
    const combo = ticketQ(table, `[data-test="station-printers-${stationId}"]`) as WtCombobox;
    expect(combo.values).toEqual(ids);
    expect(combo.getAttribute("name")).toBe("printerIds");
    expect(combo.label).toBe(label);
    await combo.updateComplete;
    combo.shadowRoot!.querySelector<HTMLButtonElement>(".trigger")!.click();
    await combo.updateComplete;
    expect(combo.shadowRoot!.querySelector<HTMLButtonElement>(".trigger")!.name).toBe("printerIds");
    const options = [...combo.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')];
    const old = options.find((o) => o.textContent?.includes("Old printer"))!;
    const next = options.find((o) => o.textContent?.includes("Next printer"))!;
    expect(old.getAttribute("aria-selected")).toBe(stationId === "bar" ? "true" : "false");
    expect(next.getAttribute("aria-selected")).toBe("false");
    combo.shadowRoot!.querySelector<HTMLButtonElement>(".trigger")!.click();
    ticketQ(table, `[data-test="cancel-printers-${stationId}"]`)!.click();
    await settle(el);
  }
  expect(a.setStationPrinters).not.toHaveBeenCalled();
});

it.each([true, false])(
  "Tickets persists a printer membership change and reflects its stored selection (attach=%s)",
  async (attach) => {
    setLocale("en");
    let stored = [...ticketView.stationPrinters];
    const load = vi.fn(async () => ({ ...ticketView, stationPrinters: stored }));
    const save = vi.fn(async (stationId: string, ids: string[]) => {
      stored = [
        ...stored.filter((row) => row.stationId !== stationId),
        ...ids.map((printerId) => ({ stationId, printerId })),
      ];
    });
    const { el, table } = await mountTickets({ load, setStationPrinters: save });
    ticketQ(table, '[data-test="edit-printers-bar"]')!.click();
    await settle(el);
    const combo = ticketQ(table, '[data-test="station-printers-bar"]') as WtCombobox;
    combo.dispatchEvent(
      new CustomEvent("wt-change", { detail: { values: attach ? ["old", "next"] : [] } }),
    );
    await settle(el);
    ticketQ(table, '[data-test="save-printers-bar"]')!.click();
    await vi.waitFor(() =>
      expect(save).toHaveBeenCalledExactlyOnceWith("bar", attach ? ["old", "next"] : []),
    );
    await settle(el);
    const cell = ticketQ(table, '[data-test="edit-printers-bar"]')!;
    expect(cell.textContent?.trim()).toBe(attach ? "Old printer, Next printer" : "None");
    expect(load).toHaveBeenCalledTimes(2);
    cell.click();
    await settle(el);
    expect((ticketQ(table, '[data-test="station-printers-bar"]') as WtCombobox).values).toEqual(
      attach ? ["old", "next"] : [],
    );
  },
);

it("Tickets keeps the stored membership and editable draft after a station refusal", async () => {
  setLocale("en");
  const { el, a, table } = await mountTickets({
    setStationPrinters: vi.fn().mockRejectedValue({ code: "station.not_found" }),
  });
  ticketQ(table, '[data-test="edit-printers-bar"]')!.click();
  await settle(el);
  ticketQ(table, '[data-test="station-printers-bar"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { values: ["next"] } }),
  );
  await settle(el);
  ticketQ(table, '[data-test="save-printers-bar"]')!.click();
  await vi.waitFor(() =>
    expect(el.shadowRoot!.textContent).toContain(
      "This station is disabled. Choose an active station.",
    ),
  );
  expect(el.shadowRoot!.textContent).not.toContain("station.not_found");
  expect((ticketQ(table, '[data-test="station-printers-bar"]') as WtCombobox).values).toEqual([
    "next",
  ]);
  expect(a.load).toHaveBeenCalledTimes(1);
  ticketQ(table, '[data-test="cancel-printers-bar"]')!.click();
  await settle(el);
  expect(ticketQ(table, '[data-test="edit-printers-bar"]')!.textContent?.trim()).toBe(
    "Old printer",
  );
});

it.each([
  ["en", "No results"],
  ["es", "Sin resultados"],
] as const)(
  "Tickets shows its localised empty state and no printer action with no stations (%s)",
  async (locale, message) => {
    setLocale(locale);
    const { a, table } = await mountTickets({
      load: vi.fn().mockResolvedValue({ ...ticketView, stations: [], stationPrinters: [] }),
    });
    expect(table.shadowRoot!.textContent).toContain(message);
    expect(ticketQ(table, '[data-test^="edit-printers-"]')).toBeNull();
    expect(a.setStationPrinters).not.toHaveBeenCalled();
  },
);

async function mountWatcherPrinters(overrides: Partial<PrepStationsApi> = {}) {
  setLocale("en");
  history.replaceState(null, "", "/manage/prep-stations/view/watchers");
  const a = api({
    load: vi.fn().mockResolvedValue(ticketView),
    setWatcherPrinters: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });
  const el = await mount(a);
  await settle(el);
  return { el, a };
}
async function openWatcherPrinters(el: PrepStationsScreen) {
  const trigger = q(el, '[data-test="edit-watcher-printers-pass"]');
  expect(trigger, "watcher printer selection opens where its output is shown").not.toBeNull();
  trigger!.click();
  await settle(el);
  return q(el, '[data-test="watcher-printers-pass"]') as WtCombobox;
}

it("Watchers chooses several printers, explains station and disabled conflicts, and saves the set", async () => {
  const server = structuredClone(ticketView);
  const save = vi.fn(async (_id: string, ids: readonly string[]) => {
    server.watchers[0]!.printerIds = [...ids];
  });
  const { el } = await mountWatcherPrinters({
    load: vi.fn(async () => structuredClone(server)),
    setWatcherPrinters: save,
  });
  const combo = await openWatcherPrinters(el);
  expect(combo.multiple).toBe(true);
  expect(combo.name).toBe("printerIds");
  expect(combo.options.map((row) => [row.value, row.label])).toEqual([
    ["old", "Old printer"],
    ["next", "Next printer"],
    ["watcher", "Pass printer"],
    ["disabled", "Disabled printer"],
  ]);
  expect(combo.values).toEqual(["watcher"]);
  expect(combo.options.find((row) => row.value === "old")).toMatchObject({
    disabled: true,
    description: "Used by station Bar",
  });
  expect(combo.options.find((row) => row.value === "disabled")).toMatchObject({
    disabled: true,
    description: "Disabled",
  });
  combo.dispatchEvent(new CustomEvent("wt-change", { detail: { values: ["watcher", "next"] } }));
  await settle(el);
  q(el, '[data-test="save-watcher-printers-pass"]')!.click();
  await vi.waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith("pass", ["watcher", "next"]));
  await settle(el);
  expect(q(el, '[data-test="watcher-printers-pass"]')).toBeNull();
  expect(q(el, '[data-test="edit-watcher-printers-pass"]')!.textContent).toContain(
    "Pass printer, Next printer",
  );
  const reopened = await openWatcherPrinters(el);
  await reopened.updateComplete;
  reopened.shadowRoot!.querySelector<HTMLElement>(".trigger")!.click();
  await reopened.updateComplete;
  const selected = [
    ...reopened.shadowRoot!.querySelectorAll('[role="option"][aria-selected="true"]'),
  ].map((row) => row.textContent!.trim());
  expect(selected).toEqual(["Next printer", "Pass printer"]);
});

it("Watchers retains a disabled mapping for removal but does not offer it as a new assignment", async () => {
  const retained = structuredClone(ticketView);
  retained.watchers[0]!.printerIds = ["disabled"];
  const { el, a } = await mountWatcherPrinters({ load: vi.fn().mockResolvedValue(retained) });
  const combo = await openWatcherPrinters(el);
  expect(combo.values).toEqual(["disabled"]);
  expect(combo.options.find((row) => row.value === "disabled")!.disabled).toBe(false);
  combo.dispatchEvent(new CustomEvent("wt-change", { detail: { values: [] } }));
  await settle(el);
  expect(
    (q(el, '[data-test="watcher-printers-pass"]') as WtCombobox).options.find(
      (row) => row.value === "disabled",
    )!.disabled,
  ).toBe(true);
  q(el, '[data-test="save-watcher-printers-pass"]')!.click();
  await vi.waitFor(() => expect(a.setWatcherPrinters).toHaveBeenCalledExactlyOnceWith("pass", []));
});

it("Watchers permits transferring a printer from another watcher and names its current owner", async () => {
  const other = structuredClone(ticketView);
  other.watchers.push({
    ...other.watchers[0]!,
    id: "runner",
    name: "Runner",
    printerIds: ["next"],
  });
  other.printers.find((row) => row.id === "next")!.watcherId = "runner";
  const { el, a } = await mountWatcherPrinters({ load: vi.fn().mockResolvedValue(other) });
  const combo = await openWatcherPrinters(el);
  expect(combo.options.find((row) => row.value === "next")).toMatchObject({
    disabled: false,
    description: "Used by watcher Runner",
  });
  combo.dispatchEvent(new CustomEvent("wt-change", { detail: { values: ["next"] } }));
  await settle(el);
  q(el, '[data-test="save-watcher-printers-pass"]')!.click();
  await vi.waitFor(() =>
    expect(a.setWatcherPrinters).toHaveBeenCalledExactlyOnceWith("pass", ["next"]),
  );
});

it("Watchers cancels a printer draft without submitting it", async () => {
  const { el, a } = await mountWatcherPrinters();
  const combo = await openWatcherPrinters(el);
  combo.dispatchEvent(new CustomEvent("wt-change", { detail: { values: ["next"] } }));
  await settle(el);
  q(el, '[data-test="cancel-watcher-printers-pass"]')!.click();
  await settle(el);
  expect(a.setWatcherPrinters).not.toHaveBeenCalled();
  expect((await openWatcherPrinters(el)).values).toEqual(["watcher"]);
});

it.each(["printer.makes_and_watches", "printer.not_found", "management.request_invalid"])(
  "Watchers preserves the printer draft and enables retry after %s",
  async (code) => {
    const save = vi
      .fn()
      .mockRejectedValueOnce({ code, params: { field: "printerIds" } })
      .mockResolvedValue(undefined);
    const { el } = await mountWatcherPrinters({ setWatcherPrinters: save });
    const combo = await openWatcherPrinters(el);
    combo.dispatchEvent(new CustomEvent("wt-change", { detail: { values: ["next"] } }));
    await settle(el);
    q(el, '[data-test="save-watcher-printers-pass"]')!.click();
    await settle(el);
    const retained = q(el, '[data-test="watcher-printers-pass"]') as WtCombobox;
    expect(retained.values).toEqual(["next"]);
    expect(retained.error).toContain("Choose available printers");
    expect(q(el, '[data-test="save-watcher-printers-pass"]')!.hasAttribute("disabled")).toBe(false);
    expect(q(el, '[data-test="watcher-printer-actions-pass"]')!.shadowRoot!.textContent).toContain(
      "Fix the fields marked above",
    );
    q(el, '[data-test="save-watcher-printers-pass"]')!.click();
    await vi.waitFor(() => expect(save).toHaveBeenNthCalledWith(2, "pass", ["next"]));
    await settle(el);
    expect(q(el, '[data-test="watcher-printers-pass"]')).toBeNull();
  },
);

it("Watchers keeps a printer draft and its general save error through a successful live read", async () => {
  const liveData = new LiveData();
  const load = vi
    .fn()
    .mockResolvedValueOnce(ticketView)
    .mockResolvedValue({
      ...ticketView,
      watchers: [{ ...ticketView.watchers[0]!, printerIds: [] }],
    });
  const { el } = await mountWatcherPrinters({
    liveData,
    load,
    setWatcherPrinters: vi.fn().mockRejectedValue({ code: "connection.failed" }),
  });
  const combo = await openWatcherPrinters(el);
  combo.dispatchEvent(new CustomEvent("wt-change", { detail: { values: ["next"] } }));
  await settle(el);
  q(el, '[data-test="save-watcher-printers-pass"]')!.click();
  await settle(el);
  const message = q(el, '[data-test="watcher-printer-actions-pass"]')!;
  expect(message.shadowRoot!.textContent).toContain("could not be saved");
  liveData.invalidate([{ type: "watcher_printers", id: "pass" }]);
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  await settle(el);
  expect((q(el, '[data-test="watcher-printers-pass"]') as WtCombobox).values).toEqual(["next"]);
  expect(q(el, '[data-test="watcher-printer-actions-pass"]')!.shadowRoot!.textContent).toContain(
    "could not be saved",
  );
});

it("Watchers closes its printer editor after a successful write even when refresh fails", async () => {
  const load = vi.fn().mockResolvedValueOnce(ticketView).mockRejectedValue(new Error("offline"));
  const { el, a } = await mountWatcherPrinters({ load });
  await openWatcherPrinters(el);
  await editSaveField(el, q(el, '[data-test="watcher-printers-pass"]')!, ["watcher", "next"]);
  q(el, '[data-test="save-watcher-printers-pass"]')!.click();
  await settle(el);
  expect(a.setWatcherPrinters).toHaveBeenCalledExactlyOnceWith("pass", ["watcher", "next"]);
  expect(q(el, '[data-test="watcher-printers-pass"]')).toBeNull();
  expect(el.shadowRoot!.textContent).toContain("could not be loaded");
});

it.each([
  ["en", "light", 390],
  ["en", "dark", 390],
  ["es", "light", 390],
  ["es", "dark", 390],
  ["en", "light", 1280],
  ["en", "dark", 1280],
  ["es", "light", 1280],
  ["es", "dark", 1280],
] as const)(
  "Watchers printer picker and refusal render accessibly in %s %s at %ipx",
  async (locale, theme, width) => {
    const previous = { width: window.innerWidth, height: window.innerHeight };
    try {
      await page.viewport(width, 900);
      const { el } = await mountWatcherPrinters({
        setWatcherPrinters: vi.fn().mockRejectedValue({ code: "printer.makes_and_watches" }),
      });
      setLocale(locale);
      el.requestUpdate();
      await settle(el);
      const host = el.parentElement!;
      host.style.width = `${width}px`;
      host.setAttribute("data-theme", theme);
      host.style.background = "var(--wt-color-bg)";
      expect(window.innerWidth).toBe(width);
      expect(host.getBoundingClientRect().width).toBe(width);
      const combo = await openWatcherPrinters(el);
      await combo.updateComplete;
      await page.elementLocator(combo.shadowRoot!.querySelector(".trigger")!).click();
      await combo.updateComplete;
      const list = combo.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
      expect(list.matches(":popover-open")).toBe(true);
      expect(list.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
      expect(list.getBoundingClientRect().right).toBeLessThanOrEqual(width);
      expect(list.textContent).toContain(
        locale === "en" ? "Used by station Bar" : "La usa la estación Bar",
      );
      const station = combo.shadowRoot!.querySelector<HTMLElement>(
        '[role="option"][aria-disabled="true"]',
      )!;
      await page.elementLocator(station).click({ force: true });
      expect(combo.values).toEqual(["watcher"]);
      await expectNoA11yViolations(host);
      await page.screenshot({
        path: `__screenshots__/look/watcher-printers-${locale}-${theme}-${width}-picker.png`,
      });
      await page.elementLocator(combo.shadowRoot!.querySelector(".trigger")!).click();
      await editSaveField(el, combo, ["watcher", "next"]);
      q(el, '[data-test="save-watcher-printers-pass"]')!.click();
      await settle(el);
      expect(
        q(el, '[data-test="watcher-printer-actions-pass"]')!.shadowRoot!.textContent,
      ).toContain(locale === "en" ? "Fix the fields" : "Corrige los campos");
      await expectNoA11yViolations(host);
      await page.screenshot({
        path: `__screenshots__/look/watcher-printers-${locale}-${theme}-${width}-refusal.png`,
      });
    } finally {
      await page.viewport(previous.width, previous.height);
    }
  },
);

it("Watchers Escape cancels a printer draft without writing and reopens the saved selection", async () => {
  const { el, a } = await mountWatcherPrinters();
  const combo = await openWatcherPrinters(el);
  combo.dispatchEvent(new CustomEvent("wt-change", { detail: { values: ["next"] } }));
  await settle(el);
  combo.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }),
  );
  await settle(el);
  expect(q(el, '[data-test="watcher-printers-pass"]')).toBeNull();
  expect(a.setWatcherPrinters).not.toHaveBeenCalled();
  expect((await openWatcherPrinters(el)).values).toEqual(["watcher"]);
});

function watcherTableQ(el: PrepStationsScreen, selector: string) {
  const table = q(el, '[data-test="watchers-table"]');
  expect(table, "Watchers has one table of editable subject cells").not.toBeNull();
  return table!.shadowRoot!.querySelector<HTMLElement>(selector);
}
async function openWatcherCell(el: PrepStationsScreen, field: string) {
  watcherTableQ(el, `[data-test="edit-watcher-${field}-pass"]`)!.click();
  await settle(el);
  return watcherTableQ(el, '[data-test="watcher-cell-input"]') as WtCombobox;
}
function chooseWatcherCell(combo: WtCombobox, values: string[]) {
  combo.dispatchEvent(new CustomEvent("wt-change", { detail: { values, value: values[0] ?? "" } }));
}
it("Watchers table no longer lists screens: a device chooses its kitchen screens on its own page", async () => {
  const { el } = await mountWatcherPrinters({ load: vi.fn().mockResolvedValue(ticketView) });
  const table = q(el, '[data-test="watchers-table"]') as unknown as {
    columns: { label: string }[];
  };
  expect(table?.columns.map((column) => column.label)).toEqual([
    "Name",
    "Follows",
    "For service zones",
    "Runs the pass",
    "Printers",
    "Actions",
  ]);
  expect(watcherTableQ(el, '[data-test="watcher-screens-pass"]')).toBeNull();
  expect(watcherTableQ(el, '[data-test="edit-watcher-printers-pass"]')).not.toBeNull();
});
it.each(["follows", "zones"])(
  "Watchers %s cell keeps every and explicit selection exclusive and persists only its field",
  async (field) => {
    const server = structuredClone(ticketView);
    server.zones = [
      { id: "terrace", name: "Terrace", active: true },
      { id: "off-zone", name: "Old zone", active: false },
    ];
    const save = vi.fn(
      async (_id: string, input: Parameters<PrepStationsApi["updateWatcher"]>[1]) => {
        Object.assign(server.watchers[0]!, input);
      },
    );
    const { el } = await mountWatcherPrinters({
      load: vi.fn(async () => structuredClone(server)),
      updateWatcher: save,
    });
    let combo = await openWatcherCell(el, field);
    expect(combo.multiple).toBe(true);
    expect(combo.name).toBe(field === "follows" ? "stationIds" : "zoneIds");
    expect(combo.options.some((option) => option.value === "off-zone")).toBe(false);
    chooseWatcherCell(combo, field === "follows" ? ["bar", "__every__"] : ["__every__", "terrace"]);
    await settle(el);
    combo = watcherTableQ(el, '[data-test="watcher-cell-input"]') as WtCombobox;
    expect(combo.values).toEqual(field === "follows" ? ["__every__"] : ["terrace"]);
    watcherTableQ(el, '[data-test="save-watcher-cell"]')!.click();
    await vi.waitFor(() =>
      expect(save).toHaveBeenCalledExactlyOnceWith("pass", {
        name: "Pass",
        everyStation: field === "follows",
        stationIds: field === "follows" ? [] : ["bar"],
        everyZone: field !== "zones",
        zoneIds: field === "zones" ? ["terrace"] : [],
        runsPass: true,
        displayOrder: 0,
      }),
    );
    await settle(el);
    combo = await openWatcherCell(el, field);
    expect(combo.values).toEqual(field === "follows" ? ["__every__"] : ["terrace"]);
  },
);
it("Watchers empty follows submission explains itself and disables Save until corrected", async () => {
  const save = vi.fn();
  const { el } = await mountWatcherPrinters({ updateWatcher: save });
  const combo = await openWatcherCell(el, "follows");
  chooseWatcherCell(combo, []);
  await settle(el);
  watcherTableQ(el, '[data-test="save-watcher-cell"]')!.click();
  await settle(el);
  expect(save).not.toHaveBeenCalled();
  expect((watcherTableQ(el, '[data-test="watcher-cell-input"]') as WtCombobox).error).toBe(
    "Choose at least one station, or every station",
  );
  expect(watcherTableQ(el, '[data-test="save-watcher-cell"]')!.hasAttribute("disabled")).toBe(true);
  expect(watcherTableQ(el, "wt-form-actions")!.shadowRoot!.textContent).toContain(
    "Fix the fields marked above.",
  );
  chooseWatcherCell(combo, ["__every__"]);
  await settle(el);
  expect(watcherTableQ(el, '[data-test="save-watcher-cell"]')!.hasAttribute("disabled")).toBe(
    false,
  );
});
it("Watchers pass cell saves a choice without opening the whole watcher dialog", async () => {
  const server = structuredClone(ticketView);
  const save = vi.fn(
    async (_id: string, input: Parameters<PrepStationsApi["updateWatcher"]>[1]) => {
      Object.assign(server.watchers[0]!, input);
    },
  );
  const { el } = await mountWatcherPrinters({
    load: vi.fn(async () => structuredClone(server)),
    updateWatcher: save,
  });
  const combo = await openWatcherCell(el, "pass");
  expect(combo.multiple).toBe(false);
  expect(combo.value).toBe("yes");
  chooseWatcherCell(combo, ["no"]);
  await settle(el);
  watcherTableQ(el, '[data-test="save-watcher-cell"]')!.click();
  await vi.waitFor(() => expect(server.watchers[0]!.runsPass).toBe(false));
  expect(q(el, '[data-test="watcher-modal"]')).toBeNull();
  await settle(el);
  expect((await openWatcherCell(el, "pass")).value).toBe("no");
});
it.each(["station.not_found", "connection.failed"])(
  "Watchers cell keeps its draft and retry action after %s",
  async (code) => {
    const save = vi.fn().mockRejectedValueOnce({ code }).mockResolvedValue(undefined);
    const { el } = await mountWatcherPrinters({ updateWatcher: save });
    const combo = await openWatcherCell(el, "follows");
    chooseWatcherCell(combo, ["__every__"]);
    await settle(el);
    watcherTableQ(el, '[data-test="save-watcher-cell"]')!.click();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await settle(el);
    expect((watcherTableQ(el, '[data-test="watcher-cell-input"]') as WtCombobox).values).toEqual([
      "__every__",
    ]);
    expect(watcherTableQ(el, '[data-test="save-watcher-cell"]')!.hasAttribute("disabled")).toBe(
      false,
    );
    const field = watcherTableQ(el, '[data-test="watcher-cell-input"]') as WtCombobox;
    expect(field.error).toBe(
      code === "station.not_found" ? "Choose at least one station, or every station" : "",
    );
    watcherTableQ(el, '[data-test="save-watcher-cell"]')!.click();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    await settle(el);
    expect(watcherTableQ(el, '[data-test="watcher-cell-input"]')).toBeNull();
  },
);
it("Watchers Cancel and Escape discard cell edits without a write", async () => {
  const save = vi.fn();
  const { el } = await mountWatcherPrinters({ updateWatcher: save });
  let combo = await openWatcherCell(el, "follows");
  chooseWatcherCell(combo, ["__every__"]);
  await settle(el);
  watcherTableQ(el, '[data-test="cancel-watcher-cell"]')!.click();
  await settle(el);
  combo = await openWatcherCell(el, "follows");
  expect(combo.values).toEqual(["bar"]);
  combo.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }),
  );
  await settle(el);
  expect(watcherTableQ(el, '[data-test="watcher-cell-input"]')).toBeNull();
  expect(save).not.toHaveBeenCalled();
});

it("Watchers Rename changes only the name and closes before a failed refresh", async () => {
  const server = structuredClone(ticketView);
  const save = vi.fn(
    async (_id: string, input: Parameters<PrepStationsApi["updateWatcher"]>[1]) => {
      Object.assign(server.watchers[0]!, input);
    },
  );
  const load = vi
    .fn()
    .mockResolvedValueOnce(server)
    .mockRejectedValueOnce({ code: "connection.failed" });
  const { el } = await mountWatcherPrinters({ load, updateWatcher: save });
  watcherTableQ(el, '[data-test="rename-watcher-pass"]')!.click();
  await settle(el);
  expect(q(el, "watcher-form")).toBeNull();
  const input = q(el, '[data-test="watcher-rename-name"]') as WtInput;
  expect(input.name).toBe("name");
  expect(input.required).toBe(true);
  input.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "  Expo  " } }));
  await settle(el);
  q(el, '[data-test="save-watcher-name"]')!.click();
  await vi.waitFor(() =>
    expect(save).toHaveBeenCalledExactlyOnceWith("pass", {
      name: "Expo",
      everyStation: false,
      stationIds: ["bar"],
      everyZone: true,
      zoneIds: [],
      runsPass: true,
      displayOrder: 0,
    }),
  );
  await settle(el);
  expect(q(el, '[data-test="watcher-rename-modal"]')).toBeNull();
  expect(el.shadowRoot!.textContent).toContain("could not be loaded");
});
it("Watchers Rename validates empty names and retains a retryable duplicate-name refusal", async () => {
  const save = vi
    .fn()
    .mockRejectedValueOnce({ code: "watcher.name_taken" })
    .mockResolvedValue(undefined);
  const { el } = await mountWatcherPrinters({ updateWatcher: save });
  watcherTableQ(el, '[data-test="rename-watcher-pass"]')!.click();
  await settle(el);
  let input = q(el, '[data-test="watcher-rename-name"]') as WtInput;
  input.dispatchEvent(new CustomEvent("wt-change", { detail: { value: " " } }));
  await settle(el);
  q(el, '[data-test="save-watcher-name"]')!.click();
  await settle(el);
  expect(save).not.toHaveBeenCalled();
  input = q(el, '[data-test="watcher-rename-name"]') as WtInput;
  expect(input.error).toBe("This field is required.");
  expect(q(el, '[data-test="save-watcher-name"]')!.hasAttribute("disabled")).toBe(true);
  input.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Expo" } }));
  await settle(el);
  q(el, '[data-test="save-watcher-name"]')!.click();
  await settle(el);
  expect((q(el, '[data-test="watcher-rename-name"]') as WtInput).error).toBe(
    "A watcher already has this name.",
  );
  expect(q(el, '[data-test="save-watcher-name"]')!.hasAttribute("disabled")).toBe(false);
  q(el, '[data-test="save-watcher-name"]')!.click();
  await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  await settle(el);
  expect(q(el, '[data-test="watcher-rename-modal"]')).toBeNull();
});
it("Watchers service zones refuses an empty explicit set and allows every zone instead", async () => {
  const save = vi.fn();
  const initial = structuredClone(ticketView);
  initial.zones = [{ id: "terrace", name: "Terrace", active: true }];
  initial.watchers[0]!.everyZone = false;
  initial.watchers[0]!.zoneIds = ["terrace"];
  const { el } = await mountWatcherPrinters({
    updateWatcher: save,
    load: vi.fn().mockResolvedValue(initial),
  });
  const combo = await openWatcherCell(el, "zones");
  chooseWatcherCell(combo, []);
  await settle(el);
  watcherTableQ(el, '[data-test="save-watcher-cell"]')!.click();
  await settle(el);
  expect(save).not.toHaveBeenCalled();
  expect((watcherTableQ(el, '[data-test="watcher-cell-input"]') as WtCombobox).error).toBe(
    "Choose at least one service zone, or every service zone",
  );
  expect(watcherTableQ(el, '[data-test="save-watcher-cell"]')!.hasAttribute("disabled")).toBe(true);
  chooseWatcherCell(combo, ["__every__"]);
  await settle(el);
  expect(watcherTableQ(el, '[data-test="save-watcher-cell"]')!.hasAttribute("disabled")).toBe(
    false,
  );
});
it("Watchers live recovery keeps a cell draft and its action error while other saved fields refresh", async () => {
  const server = structuredClone(ticketView);
  let readFailed = false;
  const liveData = new LiveData();
  const save = vi
    .fn()
    .mockRejectedValueOnce({ code: "connection.failed" })
    .mockResolvedValue(undefined);
  const { el } = await mountWatcherPrinters({
    liveData,
    load: vi.fn(async () => {
      if (readFailed) throw { code: "connection.failed" };
      return structuredClone(server);
    }),
    updateWatcher: save,
  });
  const combo = await openWatcherCell(el, "follows");
  chooseWatcherCell(combo, ["__every__"]);
  await settle(el);
  watcherTableQ(el, '[data-test="save-watcher-cell"]')!.click();
  await settle(el);
  readFailed = true;
  liveData.invalidate([{ type: "watchers", id: "pass" }]);
  await settle(el);
  readFailed = false;
  server.watchers[0]!.runsPass = false;
  liveData.invalidate([{ type: "watchers", id: "pass" }]);
  await settle(el);
  expect((watcherTableQ(el, '[data-test="watcher-cell-input"]') as WtCombobox).values).toEqual([
    "__every__",
  ]);
  expect(watcherTableQ(el, "wt-form-actions")!.shadowRoot!.textContent).toContain(
    "could not be saved",
  );
  watcherTableQ(el, '[data-test="save-watcher-cell"]')!.click();
  await vi.waitFor(() =>
    expect(save).toHaveBeenLastCalledWith("pass", {
      name: "Pass",
      everyStation: true,
      stationIds: [],
      everyZone: true,
      zoneIds: [],
      runsPass: false,
      displayOrder: 0,
    }),
  );
});

it("Watchers Rename leaves an unsaved follows draft out of its write", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  const { el } = await mountWatcherPrinters({ updateWatcher: save });
  const combo = await openWatcherCell(el, "follows");
  chooseWatcherCell(combo, ["__every__"]);
  await settle(el);
  watcherTableQ(el, '[data-test="rename-watcher-pass"]')!.click();
  await settle(el);
  (q(el, '[data-test="watcher-rename-name"]') as WtInput).dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "Expo" } }),
  );
  await settle(el);
  q(el, '[data-test="save-watcher-name"]')!.click();
  await vi.waitFor(() =>
    expect(save).toHaveBeenCalledExactlyOnceWith("pass", {
      name: "Expo",
      everyStation: false,
      stationIds: ["bar"],
      everyZone: true,
      zoneIds: [],
      runsPass: true,
      displayOrder: 0,
    }),
  );
});

it.each([
  ["en", "light", 390],
  ["en", "dark", 390],
  ["es", "light", 390],
  ["es", "dark", 390],
  ["en", "light", 1280],
  ["en", "dark", 1280],
  ["es", "light", 1280],
  ["es", "dark", 1280],
] as const)(
  "Watchers table cells and Rename render accessibly in %s %s at %ipx",
  async (locale, theme, width) => {
    const previous = { width: window.innerWidth, height: window.innerHeight };
    try {
      await page.viewport(width, 900);
      const server = structuredClone(ticketView);
      server.zones = [
        { id: "terrace", name: "Terrace", active: true },
        { id: "removed", name: "Old terrace", active: false },
      ];
      server.devices.push({
        id: "retained",
        label: "Old display",
        kitchenScreens: [],
        kind: "kds_station",
        active: false,
      });
      const { el } = await mountWatcherPrinters({
        load: vi.fn().mockResolvedValue(server),
        updateWatcher: vi.fn().mockRejectedValue({ code: "watcher.name_taken" }),
      });
      setLocale(locale);
      el.requestUpdate();
      await settle(el);
      const host = el.parentElement!;
      host.style.width = `${width}px`;
      host.setAttribute("data-theme", theme);
      host.style.background = "var(--wt-color-bg)";
      expect(window.innerWidth).toBe(width);
      expect(host.getBoundingClientRect().width).toBe(width);
      const table = q(el, '[data-test="watchers-table"]')!;
      expect(table.getBoundingClientRect().right).toBeLessThanOrEqual(width);
      for (const field of ["follows", "zones", "pass"]) {
        const combo = await openWatcherCell(el, field);
        await combo.updateComplete;
        await page.elementLocator(combo.shadowRoot!.querySelector(".trigger")!).click();
        const popup = combo.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
        expect(popup.matches(":popover-open")).toBe(true);
        expect(popup.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
        expect(popup.getBoundingClientRect().right).toBeLessThanOrEqual(width);
        expect(popup.textContent).not.toContain("Old terrace");
        await expectNoA11yViolations(host);
        await page.screenshot({
          path: `__screenshots__/look/watcher-table-${locale}-${theme}-${width}-${field}.png`,
        });
        await page.elementLocator(combo.shadowRoot!.querySelector(".trigger")!).click();
        watcherTableQ(el, '[data-test="cancel-watcher-cell"]')!.click();
        await settle(el);
      }
      const menu = watcherTableQ(el, "wt-row-actions")!;
      await page.elementLocator(menu.shadowRoot!.querySelector("button")!).click();
      await page.screenshot({
        path: `__screenshots__/look/watcher-table-${locale}-${theme}-${width}-menu.png`,
      });
      await page.elementLocator(watcherTableQ(el, '[data-test="rename-watcher-pass"]')!).click();
      await settle(el);
      await editSaveField(el, q(el, '[data-test="watcher-rename-name"]')!, "Expo");
      q(el, '[data-test="save-watcher-name"]')!.click();
      await settle(el);
      expect((q(el, '[data-test="watcher-rename-name"]') as WtInput).error).toBe(
        locale === "en"
          ? "A watcher already has this name."
          : "Ya existe un punto de seguimiento con este nombre.",
      );
      await expectNoA11yViolations(host);
      await page.screenshot({
        path: `__screenshots__/look/watcher-table-${locale}-${theme}-${width}-rename.png`,
      });
    } finally {
      await page.viewport(previous.width, previous.height);
    }
  },
);

it("Watchers clears only a resolved printer conflict after Tickets releases every station mapping", async () => {
  const liveData = new LiveData();
  const server = structuredClone(ticketView);
  server.stationPrinters = [
    { stationId: "bar", printerId: "next" },
    { stationId: "upstairs", printerId: "next" },
  ];
  const load = vi.fn(async () => structuredClone(server));
  const { el, a } = await mountWatcherPrinters({
    liveData,
    load,
    setWatcherPrinters: vi
      .fn()
      .mockRejectedValue({ code: "printer.makes_and_watches", params: { id: "next" } }),
  });
  const combo = await openWatcherPrinters(el);
  combo.dispatchEvent(new CustomEvent("wt-change", { detail: { values: ["next"] } }));
  await settle(el);
  q(el, '[data-test="save-watcher-printers-pass"]')!.click();
  await settle(el);
  expect((q(el, '[data-test="watcher-printers-pass"]') as WtCombobox).error).toContain(
    "Choose available printers",
  );
  expect(server.watchers[0]!.printerIds).toEqual(["watcher"]);
  server.stationPrinters.shift();
  liveData.invalidate([{ type: "station_printers", id: "first" }]);
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  await settle(el);
  expect((q(el, '[data-test="watcher-printers-pass"]') as WtCombobox).error).toContain(
    "Choose available printers",
  );
  server.stationPrinters.shift();
  liveData.invalidate([{ type: "station_printers", id: "last" }]);
  await vi.waitFor(() =>
    expect((q(el, '[data-test="watcher-printers-pass"]') as WtCombobox).error).toBe(""),
  );
  expect((q(el, '[data-test="watcher-printers-pass"]') as WtCombobox).values).toEqual(["next"]);
  expect(a.setWatcherPrinters).toHaveBeenCalledExactlyOnceWith("pass", ["next"]);
  expect(server.watchers[0]!.printerIds).toEqual(["watcher"]);
});

it("Watchers restores the saved printer set after cancelling a refused attachment", async () => {
  const { el, a } = await mountWatcherPrinters({
    setStationPrinters: vi.fn(),
    setWatcherPrinters: vi
      .fn()
      .mockRejectedValue({ code: "printer.makes_and_watches", params: { id: "next" } }),
  });
  const combo = await openWatcherPrinters(el);
  expect(combo.values).toEqual(["watcher"]);
  combo.dispatchEvent(new CustomEvent("wt-change", { detail: { values: ["next"] } }));
  await settle(el);
  q(el, '[data-test="save-watcher-printers-pass"]')!.click();
  await settle(el);
  expect((q(el, '[data-test="watcher-printers-pass"]') as WtCombobox).error).toContain(
    "Choose available printers",
  );
  q(el, '[data-test="cancel-watcher-printers-pass"]')!.click();
  await settle(el);
  expect(q(el, '[data-test="edit-watcher-printers-pass"]')!.textContent!.trim()).toBe(
    "Pass printer",
  );
  const saved = await openWatcherPrinters(el);
  expect(saved.values).toEqual(["watcher"]);
  await saved.updateComplete;
  saved.shadowRoot!.querySelector<HTMLElement>(".trigger")!.click();
  await saved.updateComplete;
  expect(
    [...saved.shadowRoot!.querySelectorAll('[role="option"][aria-selected="true"]')].map((row) =>
      row.textContent!.trim(),
    ),
  ).toEqual(["Pass printer"]);
  expect(a.setWatcherPrinters).toHaveBeenCalledExactlyOnceWith("pass", ["next"]);
  expect(a.setStationPrinters).not.toHaveBeenCalled();
});

it.each([
  ["en", "Used by station Bar", "Choose available printers that are not used by a station."],
  ["es", "La usa la estación Bar", "Elige impresoras disponibles que no use una estación."],
] as const)(
  "Watchers localises station-printer guidance and refusal (%s)",
  async (locale, description, refusal) => {
    const { el } = await mountWatcherPrinters({
      setWatcherPrinters: vi
        .fn()
        .mockRejectedValue({ code: "printer.makes_and_watches", params: { id: "next" } }),
    });
    setLocale(locale);
    el.requestUpdate();
    await settle(el);
    const combo = await openWatcherPrinters(el);
    expect(combo.options.find((row) => row.value === "old")!.description).toBe(description);
    combo.dispatchEvent(new CustomEvent("wt-change", { detail: { values: ["next"] } }));
    await settle(el);
    q(el, '[data-test="save-watcher-printers-pass"]')!.click();
    await vi.waitFor(() =>
      expect((q(el, '[data-test="watcher-printers-pass"]') as WtCombobox).error).toBe(refusal),
    );
  },
);

it("Watchers keeps its printer picker inside a 320px viewport", async () => {
  const previous = { width: window.innerWidth, height: window.innerHeight };
  try {
    await page.viewport(320, 900);
    const { el } = await mountWatcherPrinters();
    el.parentElement!.style.width = "320px";
    const trigger = q(el, '[data-test="edit-watcher-printers-pass"]')!;
    await page.elementLocator(trigger).click();
    await settle(el);
    const combo = q(el, '[data-test="watcher-printers-pass"]') as WtCombobox;
    expect(combo.getBoundingClientRect().right).toBeLessThanOrEqual(320);
    expect(combo.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
  } finally {
    await page.viewport(previous.width, previous.height);
  }
});

it("Watchers keeps a conflict while another selected printer still serves a station", async () => {
  const liveData = new LiveData();
  const server = structuredClone(ticketView);
  server.stationPrinters.push({ stationId: "upstairs", printerId: "next" });
  const load = vi.fn(async () => structuredClone(server));
  const { el, a } = await mountWatcherPrinters({
    liveData,
    load,
    setWatcherPrinters: vi
      .fn()
      .mockRejectedValue({ code: "printer.makes_and_watches", params: { id: "next" } }),
  });
  const combo = await openWatcherPrinters(el);
  combo.dispatchEvent(new CustomEvent("wt-change", { detail: { values: ["next", "old"] } }));
  await settle(el);
  q(el, '[data-test="save-watcher-printers-pass"]')!.click();
  await settle(el);
  server.stationPrinters = [{ stationId: "bar", printerId: "old" }];
  liveData.invalidate([{ type: "station_printers", id: "next-released" }]);
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  await settle(el);
  expect((q(el, '[data-test="watcher-printers-pass"]') as WtCombobox).error).toContain(
    "Choose available printers",
  );
  server.stationPrinters = [];
  liveData.invalidate([{ type: "station_printers", id: "old-released" }]);
  await vi.waitFor(() =>
    expect((q(el, '[data-test="watcher-printers-pass"]') as WtCombobox).error).toBe(""),
  );
  expect((q(el, '[data-test="watcher-printers-pass"]') as WtCombobox).values).toEqual([
    "next",
    "old",
  ]);
  expect(a.setWatcherPrinters).toHaveBeenCalledExactlyOnceWith("pass", ["next", "old"]);
});

it("keeps supervisor numbers and drilldowns live without exposing any configuration controls", async () => {
  const liveData = new LiveData();
  const read = vi.fn().mockResolvedValue({
    ...healthSnapshot,
    stations: [
      healthSnapshot.stations[0]!,
      { ...healthSnapshot.stations[0]!, id: "upstairs", name: "Upstairs bar" },
    ],
  });
  const a = api({
    liveData,
    load: vi.fn().mockResolvedValue(withUpstairs({ open: true, why: "in_hours" })),
    readStationHealth: read,
  });
  const host = document.createElement("div");
  applyTokens(host);
  document.body.append(host);
  hosts.push(host);
  const el = document.createElement("dashboard-prep-stations-screen") as PrepStationsScreen;
  el.api = a;
  el.readOnly = true;
  host.append(el);
  await settle(el);
  expect(q(el, '[data-test="new-station"]')).toBeNull();
  expect(q(el, '[data-test="new-watcher"]')).toBeNull();
  expect(q(el, '[data-test="interim-station-hours"]')).toBeNull();
  const tabs = el.shadowRoot!.querySelector("wt-tabs")!;
  await tabs.updateComplete;
  expect(tabs.shadowRoot!.querySelectorAll('[role="tab"]')).toHaveLength(1);
  const summary = healthSummary(el)!;
  expect(summary.textContent).toContain("Upstairs bar");
  expect(summary.textContent).toContain("Open now");
  expect(summary.querySelector("wt-row-actions")).toBeNull();
  expect(summary.querySelector('[data-test="close-today-upstairs"]')).toBeNull();
  expect(summary.querySelector("[data-station-id]")).toBeNull();
  summary.querySelector<HTMLElement>('[data-test="waiting-bar"]')!.click();
  await settle(el);
  const health = el.shadowRoot!.querySelector("prep-station-health-table")!;
  await health.updateComplete;
  await vi.waitFor(() =>
    expect(
      health.shadowRoot!.querySelector('[data-test="health-details"]')?.shadowRoot?.textContent,
    ).toContain("KITCHEN SOUP"),
  );
  read.mockResolvedValue({
    ...healthSnapshot,
    stations: [{ ...healthSnapshot.stations[0]!, waiting: 0, items: [] }],
  });
  liveData.invalidate([{ type: "ticket_items", id: "soup" }]);
  await vi.waitFor(() =>
    expect(healthSummary(el)!.querySelector('[data-test="waiting-bar"]')!.textContent!.trim()).toBe(
      "0",
    ),
  );
  expect(a.updateStation).not.toHaveBeenCalled();
});

it("moves a configuration panel back to the overview when the screen becomes read-only", async () => {
  history.replaceState(null, "", "/manage/prep-stations/view/settings/test/bread");
  const a = api({ readStationHealth: vi.fn().mockResolvedValue(healthSnapshot) });
  const el = await mount(a);
  expect(el.shadowRoot!.querySelector<HTMLElement & { value: string }>("wt-tabs")!.value).toBe(
    "settings",
  );
  el.readOnly = true;
  await settle(el);
  expect(el.shadowRoot!.querySelector<HTMLElement & { value: string }>("wt-tabs")!.value).toBe(
    "stations",
  );
  expect(location.pathname).toBe("/manage/prep-stations/view/stations");
  expect(q(el, '[data-test="settings-table"]')).toBeNull();
  expect(q(el, '[data-test="new-station"]')).toBeNull();
});

it.each([
  [
    "follows",
    "management.request_invalid",
    "stationIds",
    "Choose at least one station, or every station",
    "Fix the fields marked above.",
  ],
  ["follows", "management.request_invalid", "zoneIds", "", "The change could not be saved."],
  [
    "zones",
    "zone.not_found",
    "",
    "Choose at least one service zone, or every service zone",
    "Fix the fields marked above.",
  ],
  [
    "zones",
    "management.request_invalid",
    "zoneIds",
    "Choose at least one service zone, or every service zone",
    "Fix the fields marked above.",
  ],
  ["zones", "management.request_invalid", "stationIds", "", "The change could not be saved."],
  ["pass", "watcher.not_found", "", "", "This watcher could not be found."],
  ["pass", "connection.failed", "", "", "The change could not be saved."],
])(
  "Watchers %s classifies %s/%s without losing a retryable draft",
  async (field, code, errorField, expectedField, expectedSummary) => {
    const save = vi.fn().mockRejectedValue({ code, params: { field: errorField } });
    const initial = structuredClone(ticketView);
    initial.zones = [{ id: "terrace", name: "Terrace", active: true }];
    initial.watchers[0]!.everyZone = false;
    initial.watchers[0]!.zoneIds = ["terrace"];
    const { el } = await mountWatcherPrinters({
      updateWatcher: save,
      load: vi.fn().mockResolvedValue(initial),
    });
    const combo = await openWatcherCell(el, field);
    chooseWatcherCell(combo, field === "pass" ? ["no"] : ["__every__"]);
    await settle(el);
    watcherTableQ(el, '[data-test="save-watcher-cell"]')!.click();
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await settle(el);
    const retained = watcherTableQ(el, '[data-test="watcher-cell-input"]') as WtCombobox;
    expect(retained.values).toEqual(field === "pass" ? ["no"] : ["__every__"]);
    expect(retained.error).toBe(expectedField);
    expect(watcherTableQ(el, "wt-form-actions")!.shadowRoot!.textContent).toContain(
      expectedSummary,
    );
    expect(watcherTableQ(el, '[data-test="save-watcher-cell"]')!.hasAttribute("disabled")).toBe(
      false,
    );
  },
);

it.each([
  ["management.request_invalid", "name", "This field is required.", "Fix the fields marked above."],
  ["management.request_invalid", "stationIds", "", "The change could not be saved."],
  ["watcher.not_found", "", "", "This watcher could not be found."],
  ["connection.failed", "", "", "The change could not be saved."],
])(
  "Watchers Rename classifies %s/%s and retains its submitted name",
  async (code, field, expectedField, summary) => {
    const save = vi.fn().mockRejectedValue({ code, params: { field } });
    const { el } = await mountWatcherPrinters({ updateWatcher: save });
    watcherTableQ(el, '[data-test="rename-watcher-pass"]')!.click();
    await settle(el);
    const input = q(el, '[data-test="watcher-rename-name"]') as WtInput;
    input.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Expo" } }));
    await settle(el);
    input
      .shadowRoot!.querySelector("input")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    await settle(el);
    const retained = q(el, '[data-test="watcher-rename-name"]') as WtInput;
    expect(retained.value).toBe("Expo");
    expect(retained.error).toBe(expectedField);
    expect(
      q(el, '[data-test="watcher-rename-modal"]')!.querySelector("wt-form-actions")!.shadowRoot!
        .textContent,
    ).toContain(summary);
    expect(q(el, '[data-test="save-watcher-name"]')!.hasAttribute("disabled")).toBe(false);
  },
);

it.each(["cancel", "dismiss"])(
  "Watchers Rename %s discards its draft and reopens the stored name",
  async (how) => {
    const save = vi.fn();
    const { el } = await mountWatcherPrinters({ updateWatcher: save });
    watcherTableQ(el, '[data-test="rename-watcher-pass"]')!.click();
    await settle(el);
    (q(el, '[data-test="watcher-rename-name"]') as WtInput).dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "Unsaved" } }),
    );
    await settle(el);
    const modal = q(el, '[data-test="watcher-rename-modal"]')!;
    const closed = new Promise((resolve) =>
      modal.addEventListener("wt-close", resolve, { once: true }),
    );
    if (how === "cancel") (modal.querySelector('wt-button[slot="cancel"]') as HTMLElement).click();
    else modal.dispatchEvent(new CustomEvent("wt-close", { bubbles: true, composed: true }));
    await closed;
    await settle(el);
    await vi.waitFor(() => expect(q(el, '[data-test="watcher-rename-modal"]')).toBeNull());
    expect(save).not.toHaveBeenCalled();
    watcherTableQ(el, '[data-test="rename-watcher-pass"]')!.click();
    await settle(el);
    expect((q(el, '[data-test="watcher-rename-name"]') as WtInput).value).toBe("Pass");
  },
);

it.each(["ArrowUp", "Enter", "ArrowLeft"])(
  "Stations ignores %s when it cannot change the first row's position",
  async (key) => {
    const order = vi.fn();
    const { el } = await mountToday(withUpstairs({ open: true, why: "in_hours" }), {
      reorderStations: order,
    });
    const handle = healthSummary(el)!.querySelector<HTMLButtonElement>('[data-test="drag-bar"]')!;
    handle.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    await settle(el);
    expect(order).not.toHaveBeenCalled();
    expect(
      [...healthSummary(el)!.querySelectorAll("tbody tr")].map((row) =>
        row.querySelector("wt-row-actions")!.getAttribute("data-test"),
      ),
    ).toEqual(["station-menu-bar", "station-menu-upstairs"]);
  },
);

it("Stations pointer drag ignores another pointer and outside rows, and a no-op release writes nothing", async () => {
  const order = vi.fn();
  const { el } = await mountToday(withUpstairs({ open: true, why: "in_hours" }), {
    reorderStations: order,
  });
  const handle = healthSummary(el)!.querySelector<HTMLButtonElement>(
    '[data-test="drag-upstairs"]',
  )!;
  const first = healthSummary(el)!
    .querySelector('[data-test="station-menu-bar"]')!
    .closest("tr")!
    .getBoundingClientRect();
  handle.dispatchEvent(
    new PointerEvent("pointerdown", { pointerId: 811, button: 2, bubbles: true }),
  );
  document.dispatchEvent(
    new PointerEvent("pointermove", { pointerId: 811, clientY: first.top + first.height / 2 }),
  );
  document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 811 }));
  await settle(el);
  expect(order).not.toHaveBeenCalled();
  handle.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 812, bubbles: true }));
  document.dispatchEvent(
    new PointerEvent("pointermove", { pointerId: 813, clientY: first.top + first.height / 2 }),
  );
  document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 813 }));
  document.dispatchEvent(new PointerEvent("pointermove", { pointerId: 812, clientY: -100 }));
  document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 812 }));
  await settle(el);
  expect(order).not.toHaveBeenCalled();
  expect(
    [...healthSummary(el)!.querySelectorAll("tbody tr")].map((row) =>
      row.querySelector("wt-row-actions")!.getAttribute("data-test"),
    ),
  ).toEqual(["station-menu-bar", "station-menu-upstairs"]);
  expect(document.body.style.cursor).not.toBe("grabbing");
});

it("preserves unknown printer ids on both output surfaces", async () => {
  const server = structuredClone(ticketView);
  server.stationPrinters = [{ stationId: "bar", printerId: "missing-station-printer" }];
  server.watchers[0]!.printerIds = ["missing-watcher-printer"];
  const { table } = await mountTickets({ load: vi.fn().mockResolvedValue(server) });
  expect(ticketQ(table, '[data-test="edit-printers-bar"]')!.textContent).toContain(
    "missing-station-printer",
  );
  const { el } = await mountWatcherPrinters({ load: vi.fn().mockResolvedValue(server) });
  expect(q(el, '[data-test="edit-watcher-printers-pass"]')!.textContent).toContain(
    "missing-watcher-printer",
  );
});

it.each(["tickets", "settings", "stations"])(
  "%s orders tied station positions by name and keeps disabled stations last",
  async (tab) => {
    const server = structuredClone(ticketView);
    server.stations = [
      { ...upstairs, id: "zulu", name: "Zulu", displayOrder: 1 },
      { ...upstairs, id: "disabled", name: "A disabled", displayOrder: 0, active: false },
      { ...view.stations[0]!, name: "Alpha", displayOrder: 1 },
    ];
    history.replaceState(null, "", `/manage/prep-stations/view/${tab}`);
    const el = await mount(api({ load: vi.fn().mockResolvedValue(server) }));
    await settle(el);
    const table =
      tab === "stations"
        ? el
            .shadowRoot!.querySelector("prep-station-health-table")!
            .shadowRoot!.querySelector("wt-data-table")!
        : el.shadowRoot!.querySelector(`[data-test="${tab}-table"]`)!;
    await (table as HTMLElement & { updateComplete: Promise<boolean> }).updateComplete;
    const rows = [...table.shadowRoot!.querySelectorAll("tbody tr")];
    expect(rows[0]!.textContent).toContain("Alpha");
    expect(rows[1]!.textContent).toContain("Zulu");
    if (tab !== "stations") expect(rows[2]!.textContent).toContain("A disabled (Disabled)");
    else {
      expect(rows).toHaveLength(3);
      expect(rows[2]!.textContent).toContain("A disabled");
    }
  },
);

it("Watchers orders tied positions by name", async () => {
  const server = structuredClone(ticketView);
  server.watchers = [
    { ...server.watchers[0]!, id: "zulu", name: "Zulu", displayOrder: 1 },
    { ...server.watchers[0]!, id: "alpha", name: "Alpha", displayOrder: 1 },
  ];
  const { el } = await mountWatcherPrinters({ load: vi.fn().mockResolvedValue(server) });
  const table = el.shadowRoot!.querySelector('[data-test="watchers-table"]')!;
  await (table as HTMLElement & { updateComplete: Promise<boolean> }).updateComplete;
  const rows = [...table.shadowRoot!.querySelectorAll("tbody tr")];
  expect(rows[0]!.textContent).toContain("Alpha");
  expect(rows[1]!.textContent).toContain("Zulu");
});

it("a missing watcher refusal keeps the printer draft retryable", async () => {
  const save = vi.fn().mockRejectedValue({ code: "watcher.not_found" });
  const { el } = await mountWatcherPrinters({ setWatcherPrinters: save });
  const combo = await openWatcherPrinters(el);
  combo.dispatchEvent(new CustomEvent("wt-change", { detail: { values: ["next"] } }));
  await settle(el);
  q(el, '[data-test="save-watcher-printers-pass"]')!.click();
  await settle(el);
  expect((q(el, '[data-test="watcher-printers-pass"]') as WtCombobox).values).toEqual(["next"]);
  expect((q(el, '[data-test="watcher-printers-pass"]') as WtCombobox).error).toBe("");
  expect(q(el, '[data-test="watcher-printer-actions-pass"]')!.shadowRoot!.textContent).toContain(
    "This watcher could not be found.",
  );
  expect(q(el, '[data-test="save-watcher-printers-pass"]')!.hasAttribute("disabled")).toBe(false);
});

it.each(["cancel", "dismiss"])("%s abandons watcher removal without writing", async (how) => {
  const remove = vi.fn();
  const { el } = await mountWatcherPrinters({ removeWatcher: remove });
  q(el, '[data-test="remove-watcher-pass"]')!.click();
  await settle(el);
  const modal = q(el, '[data-test="remove-watcher-modal"]')!;
  expect(modal.textContent).toContain("Pass");
  if (how === "dismiss") modal.dispatchEvent(new CustomEvent("wt-close"));
  else modal.querySelector<HTMLElement>('wt-button[slot="cancel"]')!.click();
  await settle(el);
  expect(q(el, '[data-test="remove-watcher-modal"]')).toBeNull();
  expect(remove).not.toHaveBeenCalled();
});

it("failed watcher removal explains itself and retains confirmation for retry", async () => {
  const remove = vi
    .fn()
    .mockRejectedValueOnce({ code: "connection.failed" })
    .mockResolvedValue(undefined);
  const { el } = await mountWatcherPrinters({ removeWatcher: remove });
  q(el, '[data-test="remove-watcher-pass"]')!.click();
  await settle(el);
  q(el, '[data-test="confirm-remove-watcher"]')!.click();
  await settle(el);
  expect(
    q(el, '[data-test="remove-watcher-modal"]')!.querySelector('[role="alert"]')!.textContent,
  ).toBe("The change could not be saved.");
  expect(q(el, '[data-test="confirm-remove-watcher"]')!.hasAttribute("disabled")).toBe(false);
  q(el, '[data-test="confirm-remove-watcher"]')!.click();
  await settle(el);
  expect(remove).toHaveBeenNthCalledWith(2, "pass", { disable: true });
  expect(q(el, '[data-test="remove-watcher-modal"]')).toBeNull();
});

it("keeps an attempted watcher Rename invalid through whitespace until a name is supplied", async () => {
  const save = vi.fn();
  const { el } = await mountWatcherPrinters({ updateWatcher: save });
  q(el, '[data-test="rename-watcher-pass"]')!.click();
  await settle(el);
  const input = q(el, '[data-test="watcher-rename-name"]') as WtInput;
  input.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "" } }));
  await settle(el);
  q(el, '[data-test="save-watcher-name"]')!.click();
  await settle(el);
  input.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "   " } }));
  await settle(el);
  expect((q(el, '[data-test="watcher-rename-name"]') as WtInput).error).toBe(
    "This field is required.",
  );
  expect(q(el, '[data-test="save-watcher-name"]')!.hasAttribute("disabled")).toBe(true);
  expect(save).not.toHaveBeenCalled();
  input.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "Expo" } }));
  await settle(el);
  expect((q(el, '[data-test="watcher-rename-name"]') as WtInput).error).toBe("");
  expect(q(el, '[data-test="save-watcher-name"]')!.hasAttribute("disabled")).toBe(false);
  q(el, '[data-test="save-watcher-name"]')!.click();
  await settle(el);
  expect(save).toHaveBeenCalledExactlyOnceWith("pass", {
    name: "Expo",
    everyStation: false,
    stationIds: ["bar"],
    everyZone: true,
    zoneIds: [],
    runsPass: true,
    displayOrder: 0,
  });
  expect(q(el, '[data-test="watcher-rename-modal"]')).toBeNull();
});

it("Tickets names an unavailable watcher by its retained id when watcher metadata is absent", async () => {
  setLocale("en");
  const server = structuredClone(ticketView);
  server.watchers = [];
  server.printers.find((row) => row.id === "watcher")!.watcherId = "missing-watcher";
  const { el, table } = await mountTickets({ load: vi.fn().mockResolvedValue(server) });
  ticketQ(table, '[data-test="edit-printers-bar"]')!.click();
  await settle(el);
  const choice = ticketQ(table, '[data-test="station-printers-bar"]') as WtCombobox;
  expect(choice.options.find((row) => row.value === "watcher")).toEqual({
    value: "watcher",
    label: "Pass printer",
    disabled: true,
    description: "Used by watcher missing-watcher",
  });
  expect(choice.values).toEqual(["old"]);
});

const watcherRow = (id: string, name: string, extra: Partial<WatcherView> = {}): WatcherView => ({
  id,
  name,
  active: true,
  displayOrder: 0,
  everyStation: true,
  stationIds: [],
  everyZone: true,
  zoneIds: [],
  runsPass: false,
  printerIds: [],
  inUse: false,
  ...extra,
});
/** Pass is on a screen, Runner is on nothing; Old pass is disabled and on a screen, Spare on nothing. */
function retainedWatchersView(): PrepStationsView {
  const server = structuredClone(ticketView);
  server.watchers = [
    { ...server.watchers[0]!, inUse: true },
    watcherRow("runner", "Runner", { displayOrder: 1 }),
  ];
  server.disabledWatchers = [
    watcherRow("old", "Old pass", {
      active: false,
      inUse: true,
      everyStation: false,
      stationIds: ["bar"],
    }),
    watcherRow("spare", "Spare", { active: false, displayOrder: 2 }),
  ];
  server.printers.push({ id: "spare-printer", name: "Spare printer", active: true });
  server.disabledWatchers[0]!.printerIds = ["spare-printer"];
  return server;
}
const watcherMenu = (el: PrepStationsScreen, id: string) =>
  [...q(el, `[data-test="watcher-actions-${id}"]`)!.querySelectorAll("wt-button")].map((button) =>
    button.textContent!.trim(),
  );
const watcherRowIds = (el: PrepStationsScreen) =>
  [...q(el, '[data-test="watchers-table"]')!.shadowRoot!.querySelectorAll("tbody tr")].map((row) =>
    row.querySelector('[data-test^="watcher-"]')?.getAttribute("data-test"),
  );

it.each([
  { locale: "en", remove: "Delete", disable: "Disable", enable: "Enable", status: "Disabled" },
  {
    locale: "es",
    remove: "Eliminar",
    disable: "Deshabilitar",
    enable: "Habilitar",
    status: "Deshabilitado",
  },
] as const)(
  "Watchers offers Delete, Disable or Enable by what refers to each watcher ($locale)",
  async ({ locale, remove, disable, enable, status }) => {
    const { el } = await mountWatcherPrinters({
      load: vi.fn().mockResolvedValue(retainedWatchersView()),
    });
    setLocale(locale);
    el.requestUpdate();
    await settle(el);
    expect(watcherMenu(el, "runner")).toEqual([
      locale === "en" ? "Rename" : "Cambiar nombre",
      remove,
    ]);
    expect(watcherMenu(el, "pass").at(-1)).toBe(disable);
    expect(watcherMenu(el, "old")).toEqual([enable]);
    expect(watcherMenu(el, "spare")).toEqual([enable, remove]);
    expect(q(el, '[data-test="watcher-status-old"]')!.textContent!.trim()).toBe(status);
  },
);

it("Watchers lists disabled watchers after the active ones, muted, with a gap before their status", async () => {
  const { el } = await mountWatcherPrinters({
    load: vi.fn().mockResolvedValue(retainedWatchersView()),
  });
  expect(watcherRowIds(el)).toEqual([
    "watcher-pass",
    "watcher-runner",
    "watcher-old",
    "watcher-spare",
  ]);
  for (const id of ["pass", "runner"])
    expect(q(el, `[data-test="watcher-status-${id}"]`)).toBeNull();
  const name = q(el, '[data-test="watcher-name-old"]')!;
  const status = q(el, '[data-test="watcher-status-old"]')!;
  expect(name.textContent!.trim()).toBe("Old pass");
  expect(status.textContent!.trim()).toBe("Disabled");
  const probe = document.createElement("span");
  probe.style.color = "var(--wt-color-text-muted)";
  el.shadowRoot!.appendChild(probe);
  const muted = getComputedStyle(probe).color;
  probe.remove();
  expect(getComputedStyle(name).color).toBe(muted);
  expect(getComputedStyle(q(el, '[data-test="watcher-follows-old"]')!).color).toBe(muted);
  expect(getComputedStyle(q(el, '[data-test="watcher-pass"]')!).color).not.toBe(muted);
  expect(status.getBoundingClientRect().left - name.getBoundingClientRect().right).toBeGreaterThan(
    4,
  );
});

it("Watchers gives a disabled watcher no Rename and no follows, zones, pass or printer editing", async () => {
  const { el } = await mountWatcherPrinters({
    load: vi.fn().mockResolvedValue(retainedWatchersView()),
  });
  for (const id of ["old", "spare"]) {
    expect(q(el, `[data-test="rename-watcher-${id}"]`)).toBeNull();
    for (const field of ["follows", "zones", "pass", "printers"])
      expect(q(el, `[data-test="edit-watcher-${field}-${id}"]`)).toBeNull();
  }
  expect(q(el, '[data-test="watcher-follows-old"]')!.textContent!.trim()).toBe("Bar");
  expect(q(el, '[data-test="watcher-zones-old"]')!.textContent!.trim()).toBe("every service zone");
  expect(q(el, '[data-test="watcher-pass-old"]')!.textContent!.trim()).toBe("No");
  expect(q(el, '[data-test="watcher-printers-old"]')!.textContent!.trim()).toBe("Spare printer");
  expect(q(el, '[data-test="rename-watcher-pass"]')).not.toBeNull();
  expect(q(el, '[data-test="edit-watcher-follows-pass"]')).not.toBeNull();
});

it.each([
  {
    locale: "en",
    heading: "Delete watcher",
    text: "Delete Runner? This cannot be undone.",
    button: "Delete",
  },
  {
    locale: "es",
    heading: "Eliminar punto de seguimiento",
    text: "¿Eliminar Runner? Esta acción no se puede deshacer.",
    button: "Eliminar",
  },
] as const)(
  "Watchers confirms Delete of a watcher nothing refers to, then removes it and reads again ($locale)",
  async ({ locale, heading, text, button }) => {
    const load = vi.fn().mockResolvedValue(retainedWatchersView());
    const remove = vi.fn().mockResolvedValue(undefined);
    const { el } = await mountWatcherPrinters({ load, removeWatcher: remove });
    setLocale(locale);
    el.requestUpdate();
    await settle(el);
    q(el, '[data-test="remove-watcher-runner"]')!.click();
    await settle(el);
    const modal = q(el, '[data-test="remove-watcher-modal"]')! as HTMLElement & { heading: string };
    expect(modal.getAttribute("size")).toBe("compact");
    expect(modal.heading).toBe(heading);
    expect(modal.querySelector("p")!.textContent!.trim()).toBe(text);
    const confirm = q(el, '[data-test="confirm-remove-watcher"]')!;
    expect(confirm.getAttribute("variant")).toBe("danger");
    expect(confirm.textContent!.trim()).toBe(button);
    const reads = load.mock.calls.length;
    confirm.click();
    await settle(el);
    expect(remove.mock.calls).toEqual([["runner", { disable: false }]]);
    expect(load).toHaveBeenCalledTimes(reads + 1);
    expect(q(el, '[data-test="remove-watcher-modal"]')).toBeNull();
  },
);

it.each([
  {
    locale: "en",
    heading: "Disable",
    text: "Disable Pass? Its printers stop printing its copies.",
    button: "Disable",
  },
  {
    locale: "es",
    heading: "Deshabilitar",
    text: "¿Deshabilitar Pass? Sus impresoras dejarán de imprimir sus copias.",
    button: "Deshabilitar",
  },
] as const)(
  "Watchers confirms Disable of a watcher something refers to, then removes it and reads again ($locale)",
  async ({ locale, heading, text, button }) => {
    const load = vi.fn().mockResolvedValue(retainedWatchersView());
    const remove = vi.fn().mockResolvedValue(undefined);
    const { el } = await mountWatcherPrinters({ load, removeWatcher: remove });
    setLocale(locale);
    el.requestUpdate();
    await settle(el);
    q(el, '[data-test="remove-watcher-pass"]')!.click();
    await settle(el);
    const modal = q(el, '[data-test="remove-watcher-modal"]')! as HTMLElement & { heading: string };
    expect(modal.getAttribute("size")).toBe("compact");
    expect(modal.heading).toBe(heading);
    expect(modal.querySelector("p")!.textContent!.trim()).toBe(text);
    const confirm = q(el, '[data-test="confirm-remove-watcher"]')!;
    expect(confirm.getAttribute("variant")).toBe("danger");
    expect(confirm.textContent!.trim()).toBe(button);
    const reads = load.mock.calls.length;
    confirm.click();
    await settle(el);
    expect(remove.mock.calls).toEqual([["pass", { disable: true }]]);
    expect(load).toHaveBeenCalledTimes(reads + 1);
  },
);

it("Watchers confirms Delete of a disabled watcher nothing refers to", async () => {
  const remove = vi.fn().mockResolvedValue(undefined);
  const { el } = await mountWatcherPrinters({
    load: vi.fn().mockResolvedValue(retainedWatchersView()),
    removeWatcher: remove,
  });
  q(el, '[data-test="remove-watcher-spare"]')!.click();
  await settle(el);
  expect(q(el, '[data-test="remove-watcher-modal"]')!.querySelector("p")!.textContent!.trim()).toBe(
    "Delete Spare? This cannot be undone.",
  );
  q(el, '[data-test="confirm-remove-watcher"]')!.click();
  await settle(el);
  expect(remove.mock.calls).toEqual([["spare", { disable: false }]]);
});

it("Watchers enables a disabled watcher, reads again, and puts focus on its menu", async () => {
  const before = retainedWatchersView();
  const after = retainedWatchersView();
  after.watchers.push({ ...after.disabledWatchers[0]!, active: true });
  after.disabledWatchers.splice(0, 1);
  const load = vi.fn().mockResolvedValueOnce(before).mockResolvedValue(after);
  const enable = vi.fn().mockResolvedValue(undefined);
  const remove = vi.fn();
  const { el } = await mountWatcherPrinters({ load, enableWatcher: enable, removeWatcher: remove });
  q(el, '[data-test="enable-watcher-old"]')!.click();
  await settle(el);
  expect(enable.mock.calls).toEqual([["old"]]);
  expect(remove).not.toHaveBeenCalled();
  expect(load).toHaveBeenCalledTimes(2);
  expect(q(el, '[data-test="watcher-status-old"]')).toBeNull();
  expect(q(el, '[data-test="rename-watcher-old"]')).not.toBeNull();
  const table = q(el, '[data-test="watchers-table"]')!;
  await vi.waitFor(() =>
    expect(table.shadowRoot!.activeElement).toBe(q(el, '[data-test="watcher-actions-old"]')),
  );
});

it.each([
  {
    locale: "en",
    code: "watcher.name_taken",
    message:
      "Old pass cannot be enabled: an active watcher already has that name. Rename that watcher first, then enable this one.",
  },
  {
    locale: "es",
    code: "watcher.name_taken",
    message:
      "No se puede habilitar Old pass: un punto de seguimiento activo ya tiene ese nombre. Cambia primero el nombre de ese punto de seguimiento y luego habilita este.",
  },
  { locale: "en", code: "watcher.not_found", message: "This watcher could not be found." },
  { locale: "en", code: "connection.failed", message: "The change could not be saved." },
] as const)(
  "Watchers explains a refused Enable ($locale, $code) and reads nothing again",
  async ({ locale, code, message }) => {
    const load = vi.fn().mockResolvedValue(retainedWatchersView());
    const { el } = await mountWatcherPrinters({
      load,
      enableWatcher: vi.fn().mockRejectedValue({ code, params: { name: "Old pass" } }),
    });
    setLocale(locale);
    el.requestUpdate();
    await settle(el);
    q(el, '[data-test="enable-watcher-old"]')!.click();
    await settle(el);
    expect(q(el, '[role="alert"]')!.textContent!.trim()).toBe(message);
    expect(load).toHaveBeenCalledTimes(1);
    expect(q(el, '[data-test="watcher-status-old"]')).not.toBeNull();
  },
);

it.each(["rename", "remove"] as const)(
  "Watchers clears a refused Enable's message once the next action starts (%s)",
  async (next) => {
    const update = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);
    const { el } = await mountWatcherPrinters({
      load: vi.fn().mockResolvedValue(retainedWatchersView()),
      enableWatcher: vi.fn().mockRejectedValue({ code: "watcher.name_taken" }),
      updateWatcher: update,
      removeWatcher: remove,
    });
    q(el, '[data-test="enable-watcher-old"]')!.click();
    await settle(el);
    expect(q(el, '[role="alert"]')!.textContent).toContain("Rename that watcher first");
    q(el, `[data-test="${next}-watcher-runner"]`)!.click();
    await settle(el);
    if (next === "rename")
      await editSaveField(el, q(el, '[data-test="watcher-rename-name"]')!, "Expo");
    q(
      el,
      next === "rename"
        ? '[data-test="save-watcher-name"]'
        : '[data-test="confirm-remove-watcher"]',
    )!.click();
    await settle(el);
    expect((next === "rename" ? update : remove).mock.calls.length).toBe(1);
    expect(q(el, '[role="alert"]')).toBeNull();
  },
);

it("keeps a disabled watcher out of the stations' watcher lists and the printer pickers", async () => {
  const { el, table } = await mountTickets({
    load: vi.fn().mockResolvedValue(retainedWatchersView()),
  });
  const follows = ticketQ(table, '[data-test="watchers-bar"]')!.textContent!;
  expect(follows).toContain("Pass, Runner");
  expect(follows).not.toContain("Old pass");
  ticketQ(table, '[data-test="edit-printers-bar"]')!.click();
  await settle(el);
  const choice = ticketQ(table, '[data-test="station-printers-bar"]') as WtCombobox;
  expect(choice.options.find((row) => row.value === "spare-printer")).toEqual({
    value: "spare-printer",
    label: "Spare printer",
    disabled: false,
    description: undefined,
  });
  history.replaceState(null, "", "/manage/prep-stations/view/watchers");
  const watcherPicker = await openWatcherPrinters(el);
  expect(watcherPicker.options.find((row) => row.value === "spare-printer")?.description).toBe(
    undefined,
  );
});

describe("Routing grid", () => {
  const drinksTerrace = { row: { kind: "category", categoryId: "drinks" }, zoneId: "terrace" };
  const kitchenTarget = { kind: "station", stationId: "kitchen" };
  const breadMove = {
    productId: "bread",
    productName: "Bread",
    zoneId: "terrace",
    zoneName: "Terrace",
    from: { kind: "station", stationId: "bar" },
    to: { kind: "station", stationId: "kitchen" },
  };
  /** Drinks go to the Bar everywhere; Kitchen is a second active station. */
  function gridView(): PrepStationsView {
    return {
      ...view,
      routing: {
        ...view.routing,
        zones: [{ id: "terrace", name: "Terrace" }],
        products: [
          { id: "bread", name: "Bread", categoryId: "food" },
          { id: "water", name: "Water", categoryId: null },
        ],
        cells: [
          {
            row: { kind: "category", categoryId: "drinks" },
            zoneId: null,
            target: { kind: "station", stationId: "bar" },
          },
        ],
        stations: [
          { id: "bar", name: "Bar", active: true },
          { id: "kitchen", name: "Kitchen", active: true },
        ],
      },
      zones: [{ id: "terrace", name: "Terrace" }],
    };
  }
  async function mountGrid(overrides: Partial<PrepStationsApi> = {}) {
    const a = api({
      load: vi.fn().mockResolvedValue(gridView()),
      setCell: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    });
    const el = await mount(a);
    el.shadowRoot!.querySelector("wt-tabs")!.dispatchEvent(
      new CustomEvent("wt-tab-change", { detail: { value: "routing" } }),
    );
    await settle(el);
    await gridOf(el).updateComplete;
    return { a, el };
  }
  const gridOf = (el: PrepStationsScreen) =>
    el.shadowRoot!.querySelector<HTMLElement & { updateComplete: Promise<unknown> }>(
      "venue-routing-grid",
    )!;
  const cellCombo = (el: PrepStationsScreen, row: string, zone: string) =>
    gridOf(el).shadowRoot!.querySelector<WtCombobox>(
      `td[data-row="${row}"][data-zone="${zone}"] wt-combobox[name="routing-target"]`,
    )!;
  const shownText = (box: WtCombobox) =>
    box.shadowRoot!.querySelector(".trigger .value")!.textContent!.trim();
  const formActions = (el: PrepStationsScreen) =>
    gridOf(el).shadowRoot!.querySelector<
      HTMLElement & { error: string; updateComplete: Promise<unknown> }
    >("wt-form-actions")!;
  async function chooseCell(el: PrepStationsScreen, row: string, zone: string, label: string) {
    const box = cellCombo(el, row, zone);
    await userEvent.click(box.shadowRoot!.querySelector<HTMLElement>(".trigger")!);
    const option = [...box.shadowRoot!.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (o) => o.textContent!.trim() === label,
    )!;
    await userEvent.click(option);
    await settle(el);
  }

  it("Routing shows the grid with no tester, claims, exceptions or Unassigned card", async () => {
    const { el } = await mountGrid();
    const routing = el.shadowRoot!.querySelector('[slot="routing"]')!;
    expect(routing.querySelector("venue-routing-grid")).not.toBeNull();
    expect(routing.querySelector('[data-test="route-tester"]')).toBeNull();
    for (const old of [
      '[data-test="exceptions"]',
      '[data-test="unassigned"]',
      '[data-test="no-preparation"]',
      '[data-test^="remove-"]',
      '[data-test^="assign-"]',
      '[data-test^="claim-"]',
      '[data-test="add-exception"]',
    ])
      expect(routing.querySelector(old)).toBeNull();
  });

  it("choosing a cell value previews the moves and saves only after confirmation", async () => {
    const { a, el } = await mountGrid({ preview: vi.fn().mockResolvedValue([breadMove]) });
    const loads = vi.mocked(a.load).mock.calls.length;
    await chooseCell(el, "c:drinks", "terrace", "Kitchen");
    expect(a.preview).toHaveBeenCalledWith({
      kind: "cell",
      address: drinksTerrace,
      target: kitchenTarget,
    });
    const preview = q(el, '[data-test="routing-preview"]')!;
    expect(preview.textContent).toContain("Bread");
    expect(preview.textContent).toContain("Drinks, Terrace: this changes Bar to Kitchen.");
    expect(cellCombo(el, "c:drinks", "terrace").value).toBe("station:kitchen");
    expect(a.setCell).not.toHaveBeenCalled();
    q(el, '[data-test="confirm-routing"]')!.click();
    await settle(el);
    expect(a.setCell).toHaveBeenCalledExactlyOnceWith(drinksTerrace, kitchenTarget);
    await vi.waitFor(() => expect(vi.mocked(a.load).mock.calls.length).toBeGreaterThan(loads));
    expect(q(el, '[data-test="routing-preview"]')).toBeNull();
  });

  it.each([
    ["en", "Cheese — with Burger"],
    ["es", "Cheese — con Burger"],
  ] as const)(
    "the preview names an extra's dish beside the extra (%s)",
    async (locale, extraCell) => {
      setLocale(locale);
      const dishMove = { ...breadMove, productId: "burger", productName: "Burger" };
      const extraMove = {
        ...breadMove,
        productId: "cheese",
        productName: "Cheese",
        dish: { productId: "burger", productName: "Burger" },
      };
      const { el } = await mountGrid({
        preview: vi.fn().mockResolvedValue([dishMove, extraMove]),
      });
      await chooseCell(el, "c:drinks", "terrace", "Kitchen");
      const rows = [...q(el, '[data-test="routing-preview"]')!.querySelectorAll("tbody tr")].map(
        (row) => [...row.querySelectorAll("td")].map((cell) => cell.textContent!.trim()),
      );
      expect(rows.map((row) => [row[0], row[2], row[3]])).toEqual([
        ["Burger", "Bar", "Kitchen"],
        [extraCell, "Bar", "Kitchen"],
      ]);
    },
  );

  it.each(["Cheese $&", "Cheese {dish}"])(
    "the preview shows an extra named %s as written",
    async (name) => {
      setLocale("en");
      const extraMove = {
        ...breadMove,
        productId: "cheese",
        productName: name,
        dish: { productId: "burger", productName: "Burger" },
      };
      const { el } = await mountGrid({ preview: vi.fn().mockResolvedValue([extraMove]) });
      await chooseCell(el, "c:drinks", "terrace", "Kitchen");
      const cell = q(el, '[data-test="routing-preview"]')!.querySelector("tbody td");
      expect(cell!.textContent!.trim()).toBe(`${name} — with Burger`);
    },
  );

  it("after a save, the cell shows what the refresh read rather than the written choice", async () => {
    const saved = gridView();
    saved.routing.cells = [
      ...saved.routing.cells,
      { row: drinksTerrace.row, zoneId: "terrace", target: { kind: "no_preparation" } },
    ] as typeof saved.routing.cells;
    const load = vi.fn().mockResolvedValueOnce(gridView()).mockResolvedValue(saved);
    const { el } = await mountGrid({ load, preview: vi.fn().mockResolvedValue([breadMove]) });
    await chooseCell(el, "c:drinks", "terrace", "Kitchen");
    q(el, '[data-test="confirm-routing"]')!.click();
    await settle(el);
    await vi.waitFor(async () => {
      await gridOf(el).updateComplete;
      expect(cellCombo(el, "c:drinks", "terrace").value).toBe("no_preparation");
    });
  });

  it("a No category cell choice previews under the No category name and saves the no_category address", async () => {
    setLocale("en");
    const waterMove = { ...breadMove, productId: "water", productName: "Water" };
    const { a, el } = await mountGrid({ preview: vi.fn().mockResolvedValue([waterMove]) });
    const address = { row: { kind: "no_category" }, zoneId: "terrace" };
    await chooseCell(el, "no_category", "terrace", "Kitchen");
    expect(a.preview).toHaveBeenCalledExactlyOnceWith({
      kind: "cell",
      address,
      target: kitchenTarget,
    });
    const preview = q(el, '[data-test="routing-preview"]')!;
    expect(preview.textContent).toContain("No category, Terrace: this changes Bar to Kitchen.");
    expect(preview.textContent).toContain("Water");
    expect(cellCombo(el, "no_category", "terrace").value).toBe("station:kitchen");
    expect(cellCombo(el, "all", "terrace").value).toBe("");
    q(el, '[data-test="confirm-routing"]')!.click();
    await settle(el);
    expect(a.setCell).toHaveBeenCalledExactlyOnceWith(address, kitchenTarget);
  });

  it("Cancel on a pending No category choice restores its own saved value, not the All categories cell at the same zone", async () => {
    const both = gridView();
    both.routing.cells = [
      ...both.routing.cells,
      { row: { kind: "all" }, zoneId: "terrace", target: { kind: "no_preparation" } },
      { row: { kind: "no_category" }, zoneId: "terrace", target: kitchenTarget },
    ] as typeof both.routing.cells;
    const { a, el } = await mountGrid({
      load: vi.fn().mockResolvedValue(both),
      preview: vi.fn().mockResolvedValue([breadMove]),
    });
    expect(shownText(cellCombo(el, "no_category", "terrace"))).toBe("Kitchen");
    await chooseCell(el, "no_category", "terrace", "Clear setting");
    expect(cellCombo(el, "no_category", "terrace").value).toBe("");
    // Clearing exposes All categories × Terrace; it does not also drop that cell.
    expect(q(el, '[data-test="routing-preview"]')!.textContent).toContain(
      "No category, Terrace: this changes Kitchen to No preparation.",
    );
    q(el, '[data-test="cancel-routing"]')!.click();
    await settle(el);
    await gridOf(el).updateComplete;
    const box = cellCombo(el, "no_category", "terrace");
    await box.updateComplete;
    expect(q(el, '[data-test="routing-preview"]')).toBeNull();
    expect(box.value).toBe("station:kitchen");
    expect(shownText(box)).toBe("Kitchen");
    expect(cellCombo(el, "all", "terrace").value).toBe("no_preparation");
    expect(a.setCell).not.toHaveBeenCalled();
  });

  it("a zero-move choice saves directly", async () => {
    const { a, el } = await mountGrid({ preview: vi.fn().mockResolvedValue([]) });
    await chooseCell(el, "c:drinks", "terrace", "No preparation");
    await vi.waitFor(() =>
      expect(a.setCell).toHaveBeenCalledExactlyOnceWith(drinksTerrace, {
        kind: "no_preparation",
      }),
    );
    await chooseCell(el, "p:water", "every", "Kitchen");
    await vi.waitFor(() =>
      expect(a.setCell).toHaveBeenLastCalledWith(
        { row: { kind: "product", productId: "water" }, zoneId: null },
        kitchenTarget,
      ),
    );
    await chooseCell(el, "c:drinks", "every", "Clear setting");
    await vi.waitFor(() =>
      expect(a.setCell).toHaveBeenLastCalledWith(
        { row: { kind: "category", categoryId: "drinks" }, zoneId: null },
        null,
      ),
    );
    expect(a.setCell).toHaveBeenCalledTimes(3);
    expect(q(el, '[data-test="routing-preview"]')).toBeNull();
  });

  it("the preview lists each moved product with its old and new destinations, and No replacement for a dead end", async () => {
    setLocale("en");
    const { a, el } = await mountGrid({
      preview: vi.fn().mockResolvedValue([
        {
          productId: "bread",
          productName: "Bread",
          zoneId: null,
          zoneName: null,
          from: null,
          to: { kind: "no_preparation" },
        },
        {
          productId: "bread",
          productName: "Bread",
          zoneId: "terrace",
          zoneName: "Terrace",
          from: { kind: "station", stationId: "bar" },
          to: { kind: "station", stationId: "unknown" },
        },
        {
          productId: "bread",
          productName: "Bread",
          zoneId: "terrace",
          zoneName: "Terrace",
          from: { kind: "station", stationId: "bar" },
          to: null,
          toNoReplacement: true,
        },
      ]),
    });
    await chooseCell(el, "c:food", "every", "No preparation");
    const rows = [...el.shadowRoot!.querySelectorAll('[data-test="routing-preview"] tbody tr')];
    expect(rows.map((row) => row.textContent!.replace(/\s+/g, " ").trim())).toEqual([
      "Bread Any service zone No station No preparation",
      "Bread Terrace Bar unknown",
      "Bread Terrace Bar No replacement",
    ]);
    expect(a.setCell).not.toHaveBeenCalled();
  });

  it("a preview refused for a disabled station shows beside the cell without opening confirmation or writing", async () => {
    const message = "This station is disabled. Choose an active station.";
    const { a, el } = await mountGrid({
      preview: vi.fn().mockRejectedValue({ code: "route.station_inactive" }),
    });
    await chooseCell(el, "c:food", "terrace", "Kitchen");
    await gridOf(el).updateComplete;
    const box = cellCombo(el, "c:food", "terrace");
    await vi.waitFor(() => expect(box.error).toBe(message));
    expect(box.value).toBe("");
    expect(q(el, '[data-test="routing-preview"]')).toBeNull();
    expect(a.setCell).not.toHaveBeenCalled();
  });

  it("Cancel restores the saved cell value without writing", async () => {
    const { a, el } = await mountGrid({ preview: vi.fn().mockResolvedValue([breadMove]) });
    await chooseCell(el, "c:drinks", "every", "Kitchen");
    expect(cellCombo(el, "c:drinks", "every").value).toBe("station:kitchen");
    q(el, '[data-test="cancel-routing"]')!.click();
    await settle(el);
    await gridOf(el).updateComplete;
    const box = cellCombo(el, "c:drinks", "every");
    await box.updateComplete;
    expect(q(el, '[data-test="routing-preview"]')).toBeNull();
    expect(box.value).toBe("station:bar");
    expect(shownText(box)).toBe("Bar");
    expect(a.setCell).not.toHaveBeenCalled();
  });

  it("a write refused after the preview (station disabled meanwhile) shows beside the cell and once at the bottom; retry stays enabled", async () => {
    const message = "This station is disabled. Choose an active station.";
    const { a, el } = await mountGrid({
      preview: vi.fn().mockResolvedValue([breadMove]),
      setCell: vi
        .fn()
        .mockRejectedValueOnce({ code: "route.station_inactive" })
        .mockResolvedValue(undefined),
    });
    await chooseCell(el, "c:drinks", "terrace", "Kitchen");
    q(el, '[data-test="confirm-routing"]')!.click();
    await settle(el);
    await gridOf(el).updateComplete;
    const box = cellCombo(el, "c:drinks", "terrace");
    await vi.waitFor(() => expect(box.error).toBe(message));
    expect(box.value).toBe("");
    const actions = formActions(el);
    expect(actions.error).toBe(`Drinks, Terrace: ${message}`);
    await actions.updateComplete;
    expect(actions.shadowRoot!.querySelector('[role="alert"]')!.textContent!.trim()).toBe(
      `Drinks, Terrace: ${message}`,
    );
    expect(
      [...el.shadowRoot!.querySelectorAll(".error")].filter((node) =>
        node.textContent!.includes(message),
      ),
    ).toEqual([]);
    expect(cellCombo(el, "c:drinks", "every").error).toBe("");
    await chooseCell(el, "c:drinks", "terrace", "Kitchen");
    q(el, '[data-test="confirm-routing"]')!.click();
    await settle(el);
    expect(a.setCell).toHaveBeenCalledTimes(2);
    await gridOf(el).updateComplete;
    expect(cellCombo(el, "c:drinks", "terrace").error).toBe("");
    expect(actions.error).toBe("");
  });

  for (const code of ["service_zone.not_found", "route.subject_not_found"]) {
    it(`a write refused with ${code} shows the save error beside the cell and at the bottom`, async () => {
      setLocale("en");
      const message = "The change could not be saved.";
      const { el } = await mountGrid({
        preview: vi.fn().mockResolvedValue([breadMove]),
        setCell: vi.fn().mockRejectedValue({ code }),
      });
      await chooseCell(el, "c:drinks", "terrace", "Kitchen");
      q(el, '[data-test="confirm-routing"]')!.click();
      await settle(el);
      await gridOf(el).updateComplete;
      await vi.waitFor(() => expect(cellCombo(el, "c:drinks", "terrace").error).toBe(message));
      const actions = formActions(el);
      await actions.updateComplete;
      expect(actions.shadowRoot!.querySelector('[role="alert"]')!.textContent!.trim()).toBe(
        `Drinks, Terrace: ${message}`,
      );
    });
  }

  it("a cell refusal outlives a background refresh and clears on a successful Make default and on a tab change", async () => {
    setLocale("en");
    const liveData = new LiveData();
    const refused = async (el: PrepStationsScreen) => {
      await chooseCell(el, "c:drinks", "terrace", "Kitchen");
      q(el, '[data-test="confirm-routing"]')!.click();
      await settle(el);
      await gridOf(el).updateComplete;
      await vi.waitFor(() =>
        expect(cellCombo(el, "c:drinks", "terrace").error).toBe("The change could not be saved."),
      );
    };
    const { a, el } = await mountGrid({
      liveData,
      preview: vi.fn().mockResolvedValue([breadMove]),
      setCell: vi.fn().mockRejectedValue({ code: "service_zone.not_found" }),
      setDefaultStation: vi.fn().mockResolvedValue(undefined),
    });
    await refused(el);
    const loads = vi.mocked(a.load).mock.calls.length;
    liveData.invalidate([{ type: "categories" }]);
    await vi.waitFor(() => expect(vi.mocked(a.load).mock.calls.length).toBeGreaterThan(loads));
    await settle(el);
    await gridOf(el).updateComplete;
    expect(cellCombo(el, "c:drinks", "terrace").error).toBe("The change could not be saved.");
    expect(formActions(el).error).toBe("Drinks, Terrace: The change could not be saved.");

    await chooseCell(el, "all", "every", "Kitchen");
    expect(a.setDefaultStation).toHaveBeenCalledExactlyOnceWith("kitchen");
    await settle(el);
    await gridOf(el).updateComplete;
    expect(cellCombo(el, "c:drinks", "terrace").error).toBe("");
    expect(formActions(el).error).toBe("");

    await refused(el);
    el.shadowRoot!.querySelector("wt-tabs")!.dispatchEvent(
      new CustomEvent("wt-tab-change", { detail: { value: "stations" } }),
    );
    await settle(el);
    el.shadowRoot!.querySelector("wt-tabs")!.dispatchEvent(
      new CustomEvent("wt-tab-change", { detail: { value: "routing" } }),
    );
    await settle(el);
    await gridOf(el).updateComplete;
    expect(cellCombo(el, "c:drinks", "terrace").error).toBe("");
    expect(formActions(el).error).toBe("");
  });

  it("Make default from All × Every zone calls the default route and maps its refusal", async () => {
    const { a, el } = await mountGrid({
      setDefaultStation: vi.fn().mockRejectedValue({
        code: "hours.invalid",
        params: { field: "date", date: "2096-06-10", subjectId: "bar" },
      }),
    });
    await chooseCell(el, "all", "every", "Kitchen");
    expect(a.setDefaultStation).toHaveBeenCalledExactlyOnceWith("kitchen");
    expect(a.preview).not.toHaveBeenCalled();
    expect(a.setCell).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(q(el, '[role="alert"]')?.textContent?.trim()).toBe(
        "Bar would go back to its saved hours, which overlap a day next to the special date on Sun, 10 Jun 2096. Move or delete that special date on the Hours page first.",
      ),
    );
  });

  const foodTerrace = { row: { kind: "category", categoryId: "food" }, zoneId: "terrace" };
  const deferred = <T>() => {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  };
  const withCell = (target: { kind: string; stationId?: string }) => {
    const next = gridView();
    next.routing.cells = [
      ...next.routing.cells,
      { row: drinksTerrace.row, zoneId: "terrace", target },
    ] as typeof next.routing.cells;
    return next;
  };

  it.each([
    "routing_cells",
    "kitchen_stations",
    "station_fallbacks",
    "floor_zones",
    "categories",
    "category_details",
    "products",
  ])(
    "a cell, default, station-active, fallback, zone, category-parent or product-category change refreshes the grid (%s)",
    async (type) => {
      setLocale("en");
      const liveData = new LiveData();
      const load = vi
        .fn()
        .mockResolvedValueOnce(gridView())
        .mockResolvedValue(withCell(kitchenTarget));
      const { el } = await mountGrid({ liveData, load });
      expect(cellCombo(el, "c:drinks", "terrace").value).toBe("");
      liveData.invalidate([{ type }]);
      await vi.waitFor(async () => {
        await gridOf(el).updateComplete;
        expect(cellCombo(el, "c:drinks", "terrace").value).toBe("station:kitchen");
      });
    },
  );

  it("a passive refresh during a pending save keeps the coordinate and draft", async () => {
    setLocale("en");
    const liveData = new LiveData();
    const write = deferred<void>();
    const setCell = vi.fn(() => write.promise);
    // A fresh object per read, so each refresh really replaces the screen's view.
    const background = { load: vi.fn(async () => gridView()) };
    const { a, el } = await mountGrid({
      liveData,
      setCell,
      preview: vi.fn().mockResolvedValue([breadMove]),
      background: background as unknown as PrepStationsApi,
    });
    await chooseCell(el, "c:drinks", "terrace", "Kitchen");
    liveData.invalidate([{ type: "routing_cells" }]);
    await vi.waitFor(() => expect(background.load).toHaveBeenCalledTimes(1));
    await settle(el);
    await gridOf(el).updateComplete;
    expect(q(el, '[data-test="routing-preview"]')!.textContent).toContain(
      "Drinks, Terrace: this changes Bar to Kitchen.",
    );
    expect(cellCombo(el, "c:drinks", "terrace").value).toBe("station:kitchen");

    q(el, '[data-test="confirm-routing"]')!.click();
    await settle(el);
    liveData.invalidate([{ type: "routing_cells" }]);
    await vi.waitFor(() => expect(background.load).toHaveBeenCalledTimes(2));
    await settle(el);
    await gridOf(el).updateComplete;
    expect(cellCombo(el, "c:drinks", "terrace").value).toBe("station:kitchen");
    expect(cellCombo(el, "c:drinks", "every").value).toBe("station:bar");
    write.resolve();
    await vi.waitFor(() => expect(background.load).toHaveBeenCalledTimes(3));
    expect(setCell).toHaveBeenCalledExactlyOnceWith(drinksTerrace, kitchenTarget);
    expect(a.load).toHaveBeenCalledTimes(1);
  });

  it("a successful read clears only a read error and never an action failure", async () => {
    setLocale("en");
    const liveData = new LiveData();
    const load = vi.fn().mockResolvedValue(gridView());
    const { el } = await mountGrid({
      liveData,
      load,
      preview: vi.fn().mockResolvedValue([breadMove]),
      setCell: vi.fn().mockRejectedValue({ code: "service_zone.not_found" }),
      setDefaultStation: vi.fn().mockRejectedValue({ code: "connection.failed" }),
    });
    const pageAlert = () => q(el, '[role="alert"]')?.textContent?.trim() ?? "";
    const reread = async (outcome: "fails" | "succeeds") => {
      const calls = load.mock.calls.length;
      if (outcome === "fails") load.mockRejectedValueOnce({ code: "connection.failed" });
      liveData.refresh();
      await vi.waitFor(() => expect(load.mock.calls.length).toBeGreaterThan(calls));
      await settle(el);
      await gridOf(el).updateComplete;
    };
    await reread("fails");
    expect(pageAlert()).toContain("could not be loaded");
    await reread("succeeds");
    expect(pageAlert()).toBe("");

    await chooseCell(el, "c:drinks", "terrace", "Kitchen");
    q(el, '[data-test="confirm-routing"]')!.click();
    await settle(el);
    await vi.waitFor(() =>
      expect(cellCombo(el, "c:drinks", "terrace").error).toBe("The change could not be saved."),
    );
    await chooseCell(el, "all", "every", "Kitchen");
    await vi.waitFor(() => expect(pageAlert()).toBe("The change could not be saved."));
    await reread("fails");
    expect(pageAlert()).toBe("The change could not be saved.");
    await reread("succeeds");
    expect(pageAlert()).toBe("The change could not be saved.");
    expect(cellCombo(el, "c:drinks", "terrace").error).toBe("The change could not be saved.");
    expect(formActions(el).error).toBe("Drinks, Terrace: The change could not be saved.");
  });

  it("a late read cannot reopen a closed editor or reorder the selection", async () => {
    const preview = vi.fn().mockResolvedValueOnce([breadMove]).mockResolvedValue([]);
    const liveData = new LiveData();
    const stale = deferred<PrepStationsView>();
    const load = vi.fn(async () => gridView());
    const { a, el } = await mountGrid({ liveData, load, preview });
    const rowOrder = () =>
      [...gridOf(el).shadowRoot!.querySelectorAll("tbody th")].map((th) =>
        th.textContent!.replace(/\s+/g, " ").trim(),
      );

    await chooseCell(el, "c:drinks", "terrace", "Kitchen");
    expect(q(el, '[data-test="routing-preview"]')).not.toBeNull();
    load.mockReturnValueOnce(stale.promise).mockImplementation(async () => withCell(kitchenTarget));
    const calls = load.mock.calls.length;
    liveData.invalidate([{ type: "routing_cells" }]);
    await vi.waitFor(() => expect(load.mock.calls.length).toBe(calls + 1));
    q(el, '[data-test="cancel-routing"]')!.click();
    await settle(el);
    expect(q(el, '[data-test="routing-preview"]')).toBeNull();

    await chooseCell(el, "c:drinks", "terrace", "Kitchen");
    await vi.waitFor(() =>
      expect(a.setCell).toHaveBeenCalledExactlyOnceWith(drinksTerrace, kitchenTarget),
    );
    await vi.waitFor(async () => {
      await gridOf(el).updateComplete;
      expect(cellCombo(el, "c:drinks", "terrace").value).toBe("station:kitchen");
    });
    const order = rowOrder();
    // The read that started before Cancel lists the categories in another order.
    const reordered = gridView();
    reordered.routing.categories = [...reordered.routing.categories].reverse();
    stale.resolve(reordered);
    await settle(el);
    await gridOf(el).updateComplete;
    expect(q(el, '[data-test="routing-preview"]')).toBeNull();
    expect(cellCombo(el, "c:drinks", "terrace").value).toBe("station:kitchen");
    expect(rowOrder()).toEqual(order);
    expect(a.setCell).toHaveBeenCalledTimes(1);
  });

  it("a choice whose No category row a refresh removed while its preview was out is dropped, not saved, when the preview moves nothing", async () => {
    const liveData = new LiveData();
    const answer = deferred<unknown[]>();
    const categorised = gridView();
    categorised.routing.products = categorised.routing.products.map((product) => ({
      ...product,
      categoryId: "food",
    }));
    const load = vi.fn(async () => gridView());
    const { a, el } = await mountGrid({
      liveData,
      load,
      preview: vi.fn().mockReturnValueOnce(answer.promise).mockResolvedValue([breadMove]),
    });
    await chooseCell(el, "no_category", "terrace", "Kitchen");
    load.mockImplementation(async () => categorised);
    liveData.invalidate([{ type: "products" }]);
    await vi.waitFor(async () => {
      await gridOf(el).updateComplete;
      expect(gridOf(el).shadowRoot!.querySelector('td[data-row="no_category"]')).toBeNull();
    });
    answer.resolve([]);
    await settle(el);
    await gridOf(el).updateComplete;
    expect(a.setCell).not.toHaveBeenCalled();
    expect(q(el, '[data-test="routing-preview"]')).toBeNull();
    expect(cellCombo(el, "all", "terrace").value).toBe("");
    await chooseCell(el, "c:food", "terrace", "Kitchen");
    q(el, '[data-test="confirm-routing"]')!.click();
    await settle(el);
    expect(a.setCell).toHaveBeenCalledExactlyOnceWith(foodTerrace, kitchenTarget);
  });

  const pageAlert = (el: PrepStationsScreen) => q(el, '[role="alert"]')?.textContent?.trim() ?? "";
  const gridMessage = async (el: PrepStationsScreen) => {
    await gridOf(el).updateComplete;
    await formActions(el).updateComplete;
    return formActions(el).error;
  };
  const switchTab = async (el: PrepStationsScreen, value: string) => {
    el.shadowRoot!.querySelector("wt-tabs")!.dispatchEvent(
      new CustomEvent("wt-tab-change", { detail: { value } }),
    );
    await settle(el);
  };
  const shownTargets = (el: PrepStationsScreen) =>
    [
      ...gridOf(el).shadowRoot!.querySelectorAll<WtCombobox>('wt-combobox[name="routing-target"]'),
    ].map((box) => box.value);
  it.each([
    {
      what: "category",
      row: "c:drinks",
      locale: "en",
      message: "Your choice was not saved: its category is no longer in the grid.",
      remove: (next: PrepStationsView) => {
        next.routing.categories = next.routing.categories.filter((c) => c.id !== "drinks");
        next.routing.cells = [];
        next.categories = next.categories.filter((c) => c.id !== "drinks");
      },
    },
    {
      what: "product",
      row: "p:water",
      locale: "en",
      message: "Your choice was not saved: its product is no longer in the grid.",
      remove: (next: PrepStationsView) => {
        next.routing.products = next.routing.products.filter((p) => p.id !== "water");
      },
    },
    {
      what: "zone",
      row: "c:drinks",
      locale: "en",
      message: "Your choice was not saved: its zone is no longer in the grid.",
      remove: (next: PrepStationsView) => {
        next.routing.zones = [];
        next.zones = [];
      },
    },
    {
      what: "zone and category",
      row: "c:drinks",
      locale: "en",
      message: "Your choice was not saved: its zone is no longer in the grid.",
      remove: (next: PrepStationsView) => {
        next.routing.zones = [];
        next.zones = [];
        next.routing.categories = next.routing.categories.filter((c) => c.id !== "drinks");
        next.routing.cells = [];
        next.categories = next.categories.filter((c) => c.id !== "drinks");
      },
    },
    {
      what: "category",
      row: "c:drinks",
      locale: "es",
      message: "Tu elección no se ha guardado: su categoría ya no está en la cuadrícula.",
      remove: (next: PrepStationsView) => {
        next.routing.categories = next.routing.categories.filter((c) => c.id !== "drinks");
        next.routing.cells = [];
        next.categories = next.categories.filter((c) => c.id !== "drinks");
      },
    },
    {
      what: "zone",
      row: "c:drinks",
      locale: "es",
      message: "Tu elección no se ha guardado: su zona ya no está en la cuadrícula.",
      remove: (next: PrepStationsView) => {
        next.routing.zones = [];
        next.zones = [];
      },
    },
  ])(
    "a choice whose $what a refresh removed while its preview was out says it was not saved ($locale), and the next choice clears that",
    async ({ row, locale, message, remove }) => {
      setLocale(locale);
      const liveData = new LiveData();
      const answer = deferred<unknown[]>();
      const removed = gridView();
      remove(removed);
      const load = vi.fn(async () => gridView());
      const { a, el } = await mountGrid({
        liveData,
        load,
        preview: vi.fn().mockReturnValueOnce(answer.promise).mockResolvedValue([breadMove]),
      });
      await chooseCell(el, row, "terrace", "Kitchen");
      load.mockImplementation(async () => removed);
      liveData.invalidate([{ type: "floor_zones" }, { type: "categories" }, { type: "products" }]);
      await vi.waitFor(async () => {
        await gridOf(el).updateComplete;
        expect(
          gridOf(el).shadowRoot!.querySelector(`td[data-row="${row}"][data-zone="terrace"]`),
        ).toBeNull();
      });
      answer.resolve([]);
      await settle(el);
      await gridOf(el).updateComplete;
      expect(a.setCell).not.toHaveBeenCalled();
      expect(q(el, '[data-test="routing-preview"]')).toBeNull();
      expect(await gridMessage(el)).toBe(message);
      expect(pageAlert(el)).toBe("");
      expect(shownTargets(el)).not.toContain("station:kitchen");
      for (const outcome of ["fails", "succeeds"]) {
        const calls = load.mock.calls.length;
        if (outcome === "fails") load.mockRejectedValueOnce({ code: "connection.failed" });
        liveData.refresh();
        await vi.waitFor(() => expect(load.mock.calls.length).toBeGreaterThan(calls));
        await settle(el);
        expect(await gridMessage(el)).toBe(message);
      }
      expect(pageAlert(el)).toBe("");

      await chooseCell(el, "c:food", "every", "Kitchen");
      expect(await gridMessage(el)).toBe("");
      expect(q(el, '[data-test="routing-preview"]')).not.toBeNull();
    },
  );

  it.each([
    {
      what: "zone",
      row: "c:drinks",
      message: "Your choice was not saved: its zone is no longer in the grid.",
      remove: (next: PrepStationsView) => {
        next.routing.zones = [];
        next.zones = [];
      },
    },
    {
      what: "product",
      row: "p:water",
      message: "Your choice was not saved: its product is no longer in the grid.",
      remove: (next: PrepStationsView) => {
        next.routing.products = next.routing.products.filter((p) => p.id !== "water");
      },
    },
  ])(
    "a dropped choice's message clears once a refresh brings its $what back into the grid",
    async ({ row, message, remove }) => {
      setLocale("en");
      const liveData = new LiveData();
      const answer = deferred<unknown[]>();
      const removed = gridView();
      remove(removed);
      const load = vi.fn(async () => gridView());
      const { a, el } = await mountGrid({
        liveData,
        load,
        preview: vi.fn().mockReturnValueOnce(answer.promise).mockResolvedValue([breadMove]),
      });
      const cell = () =>
        gridOf(el).shadowRoot!.querySelector(`td[data-row="${row}"][data-zone="terrace"]`);
      await chooseCell(el, row, "terrace", "Kitchen");
      load.mockImplementation(async () => removed);
      liveData.invalidate([{ type: "floor_zones" }, { type: "products" }]);
      await vi.waitFor(async () => {
        await gridOf(el).updateComplete;
        expect(cell()).toBeNull();
      });
      answer.resolve([]);
      await settle(el);
      expect(await gridMessage(el)).toBe(message);

      load.mockImplementation(async () => gridView());
      liveData.invalidate([{ type: "floor_zones" }, { type: "products" }]);
      await vi.waitFor(async () => {
        await gridOf(el).updateComplete;
        expect(cell()).not.toBeNull();
      });
      await settle(el);
      expect(await gridMessage(el)).toBe("");
      expect(cellCombo(el, row, "terrace").error).toBe("");
      const errors = [...gridOf(el).shadowRoot!.querySelectorAll<WtCombobox>("wt-combobox")].map(
        (box) => box.error,
      );
      expect(errors.some((text) => text.includes(message))).toBe(false);
      expect(a.setCell).not.toHaveBeenCalled();
    },
  );

  it("reopening an editor owns a new request generation", async () => {
    setLocale("en");
    const first = deferred<unknown[]>();
    const second = deferred<unknown[]>();
    const preview = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { a, el } = await mountGrid({ preview });
    await chooseCell(el, "c:drinks", "terrace", "Kitchen");
    const host = el.parentElement!;
    el.remove();
    host.append(el);
    await settle(el);
    await gridOf(el).updateComplete;
    await chooseCell(el, "c:food", "terrace", "Kitchen");
    second.resolve([breadMove]);
    await vi.waitFor(() => expect(q(el, '[data-test="routing-preview"]')).not.toBeNull());
    first.resolve([breadMove]);
    await settle(el);
    expect(q(el, '[data-test="routing-preview"]')!.textContent).toContain("Food, Terrace:");
    expect(cellCombo(el, "c:drinks", "terrace").value).toBe("");
    q(el, '[data-test="confirm-routing"]')!.click();
    await settle(el);
    expect(a.setCell).toHaveBeenCalledExactlyOnceWith(foodTerrace, kitchenTarget);
  });

  it.each([
    [
      "zone",
      (next: PrepStationsView) => {
        next.routing.zones = [];
        next.zones = [];
      },
    ],
    [
      "category",
      (next: PrepStationsView) => {
        next.routing.categories = next.routing.categories.filter((c) => c.id !== "drinks");
        next.routing.cells = [];
        next.categories = next.categories.filter((c) => c.id !== "drinks");
      },
    ],
  ])(
    "removing a %s while its editor is open shows the target unavailable and requires cancel or reselection, never saving to a neighbour",
    async (_what, remove) => {
      setLocale("en");
      const liveData = new LiveData();
      const removed = gridView();
      remove(removed);
      const load = vi.fn().mockResolvedValue(gridView());
      const { a, el } = await mountGrid({
        liveData,
        load,
        preview: vi.fn().mockResolvedValue([breadMove]),
      });
      await chooseCell(el, "c:drinks", "terrace", "Kitchen");
      load.mockResolvedValue(removed);
      liveData.invalidate([{ type: "floor_zones" }, { type: "categories" }]);
      await vi.waitFor(() =>
        expect(q(el, '[data-test="routing-unavailable"]')?.textContent?.trim()).toBe(
          "This row or zone is no longer in the grid. Cancel, then choose again.",
        ),
      );
      const confirm = q(el, '[data-test="confirm-routing"]') as HTMLElement & { disabled: boolean };
      expect(confirm.disabled).toBe(true);
      confirm.click();
      await settle(el);
      expect(a.setCell).not.toHaveBeenCalled();
      expect(q(el, '[data-test="routing-preview"]')).not.toBeNull();

      q(el, '[data-test="cancel-routing"]')!.click();
      await settle(el);
      expect(q(el, '[data-test="routing-preview"]')).toBeNull();
      await chooseCell(el, "c:food", "every", "Kitchen");
      expect(q(el, '[data-test="routing-unavailable"]')).toBeNull();
      q(el, '[data-test="confirm-routing"]')!.click();
      await settle(el);
      expect(a.setCell).toHaveBeenCalledExactlyOnceWith(
        { row: { kind: "category", categoryId: "food" }, zoneId: null },
        kitchenTarget,
      );
    },
  );

  it("a refresh that gives the last uncategorised product a category removes the No category row, which holds no saved choice, while a No category choice is pending: the screen cancels that draft, and nothing is saved to All categories or any other row", async () => {
    const liveData = new LiveData();
    const categorised = gridView();
    categorised.routing.products = categorised.routing.products.map((product) => ({
      ...product,
      categoryId: "food",
    }));
    const load = vi.fn().mockResolvedValue(gridView());
    const { a, el } = await mountGrid({
      liveData,
      load,
      preview: vi.fn().mockResolvedValue([breadMove]),
    });
    await chooseCell(el, "no_category", "terrace", "Kitchen");
    expect(q(el, '[data-test="routing-preview"]')).not.toBeNull();
    load.mockResolvedValue(categorised);
    liveData.invalidate([{ type: "products" }]);
    await vi.waitFor(async () => {
      await gridOf(el).updateComplete;
      expect(gridOf(el).shadowRoot!.querySelector('td[data-row="no_category"]')).toBeNull();
    });
    await settle(el);
    expect(q(el, '[data-test="routing-preview"]')).toBeNull();
    expect(cellCombo(el, "all", "terrace").value).toBe("");
    expect(a.setCell).not.toHaveBeenCalled();
    await chooseCell(el, "c:food", "terrace", "Kitchen");
    q(el, '[data-test="confirm-routing"]')!.click();
    await settle(el);
    expect(a.setCell).toHaveBeenCalledExactlyOnceWith(foodTerrace, kitchenTarget);
  });

  it.each([
    {
      locale: "en",
      message: "Your choice was not saved: the No category row is no longer in the grid.",
    },
    {
      locale: "es",
      message: "Tu elección no se ha guardado: la fila Sin categoría ya no está en la cuadrícula.",
    },
  ])(
    "a pending No category choice whose row a refresh removes closes its preview and says it was not saved ($locale)",
    async ({ locale, message }) => {
      setLocale(locale);
      const liveData = new LiveData();
      const categorised = gridView();
      categorised.routing.products = categorised.routing.products.map((product) => ({
        ...product,
        categoryId: "food",
      }));
      const load = vi.fn().mockResolvedValue(gridView());
      const { a, el } = await mountGrid({
        liveData,
        load,
        preview: vi.fn().mockResolvedValue([breadMove]),
      });
      await chooseCell(el, "no_category", "terrace", "Kitchen");
      expect(q(el, '[data-test="routing-preview"]')).not.toBeNull();
      load.mockResolvedValue(categorised);
      liveData.invalidate([{ type: "products" }]);
      await vi.waitFor(async () => {
        await gridOf(el).updateComplete;
        expect(gridOf(el).shadowRoot!.querySelector('td[data-row="no_category"]')).toBeNull();
      });
      await settle(el);
      expect(q(el, '[data-test="routing-preview"]')).toBeNull();
      expect(await gridMessage(el)).toBe(message);
      expect(pageAlert(el)).toBe("");
      expect(shownTargets(el)).not.toContain("station:kitchen");
      expect(a.setCell).not.toHaveBeenCalled();

      await switchTab(el, "stations");
      await switchTab(el, "routing");
      expect(await gridMessage(el)).toBe("");
    },
  );

  it("detach stops observers and timers; elapsed-time refresh stays passive", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const liveData = new LiveData();
      const background = { load: vi.fn().mockResolvedValue(gridView()) };
      const { a, el } = await mountGrid({
        liveData,
        background: background as unknown as PrepStationsApi,
      });
      const active = { load: vi.mocked(a.load).mock.calls.length };
      await vi.advanceTimersByTimeAsync(60_000);
      await settle(el);
      expect(background.load).toHaveBeenCalledTimes(1);
      expect(vi.mocked(a.load).mock.calls.length).toBe(active.load);
      el.remove();
      expect(liveData.interests).toEqual([]);
      await vi.advanceTimersByTimeAsync(180_000);
      expect(background.load).toHaveBeenCalledTimes(1);

      const timed = api({ load: vi.fn().mockResolvedValue(gridView()) });
      const unwatched = await mount(timed);
      expect(timed.load).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(timed.load).toHaveBeenCalledTimes(2);
      unwatched.remove();
      await vi.advanceTimersByTimeAsync(180_000);
      expect(timed.load).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

it("edge scroll carries a held station past the visible summary and persists on release", async () => {
  const next = {
    ...view,
    stations: Array.from({ length: 35 }, (_, i) => ({
      ...view.stations[0]!,
      id: `edge-${i}`,
      name: `Station ${i}`,
      displayOrder: i,
      isDefault: i === 0,
    })),
  };
  const order = vi.fn().mockResolvedValue(undefined);
  const { el } = await mountToday(next, { reorderStations: order });
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;top:100px;left:40px;width:900px;height:300px;overflow:auto";
  el.parentElement!.append(box);
  box.append(el);
  const handle = healthSummary(el)!.querySelector<HTMLElement>('[data-test="drag-edge-0"]')!;
  box.scrollTop = handle.getBoundingClientRect().top - box.getBoundingClientRect().top;
  const start = handle.getBoundingClientRect();
  const bounds = box.getBoundingClientRect();
  handle.dispatchEvent(
    new PointerEvent("pointerdown", {
      pointerId: 91,
      clientX: start.left + 10,
      clientY: start.top + 10,
      bubbles: true,
    }),
  );
  document.dispatchEvent(
    new PointerEvent("pointermove", {
      pointerId: 91,
      clientX: start.left + 10,
      clientY: bounds.bottom - 8,
    }),
  );
  const initial = box.scrollTop;
  try {
    await expect.poll(() => box.scrollTop, { timeout: 1500 }).toBeGreaterThan(initial + 150);
    document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 91 }));
    await settle(el);
    expect(order).toHaveBeenCalledTimes(1);
    expect((order.mock.calls[0]![0] as string[]).indexOf("edge-0")).toBeGreaterThan(3);
  } finally {
    document.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 91 }));
  }
});

it("edge scroll Escape stops a held station without another reorder on release", async () => {
  const next = {
    ...view,
    stations: Array.from({ length: 35 }, (_, i) => ({
      ...view.stations[0]!,
      id: `escape-${i}`,
      name: `Station ${i}`,
      displayOrder: i,
      isDefault: i === 0,
    })),
  };
  const { el } = await mountToday(next);
  const box = document.createElement("div");
  box.style.cssText = "position:fixed;top:100px;left:40px;width:900px;height:300px;overflow:auto";
  el.parentElement!.append(box);
  box.append(el);
  const handle = healthSummary(el)!.querySelector<HTMLElement>('[data-test="drag-escape-0"]')!;
  box.scrollTop = handle.getBoundingClientRect().top - box.getBoundingClientRect().top;
  const start = handle.getBoundingClientRect();
  const bounds = box.getBoundingClientRect();
  handle.dispatchEvent(
    new PointerEvent("pointerdown", {
      pointerId: 92,
      clientX: start.left + 10,
      clientY: start.top + 10,
      bubbles: true,
    }),
  );
  document.dispatchEvent(
    new PointerEvent("pointermove", {
      pointerId: 92,
      clientX: start.left + 10,
      clientY: bounds.bottom - 8,
    }),
  );
  const initial = box.scrollTop;
  try {
    await expect.poll(() => box.scrollTop, { timeout: 1500 }).toBeGreaterThan(initial + 100);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await settle(el);
    await new Promise(requestAnimationFrame);
    const ended = box.scrollTop;
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    expect(box.scrollTop).toBe(ended);
    expect(document.body.style.cursor).not.toBe("grabbing");
  } finally {
    document.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 92 }));
  }
});

it.each(["up", "leave", "cancel", "disconnect", "fits"])(
  "edge scroll station drag handles %s",
  async (action) => {
    const next = {
      ...view,
      stations: Array.from({ length: action === "fits" ? 1 : 35 }, (_, i) => ({
        ...view.stations[0]!,
        id: `lifecycle-${i}`,
        name: `Station ${i}`,
        displayOrder: i,
        isDefault: i === 0,
      })),
    };
    const order = vi.fn().mockResolvedValue(undefined);
    const { el } = await mountToday(next, { reorderStations: order });
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;top:100px;left:40px;width:900px;height:400px;overflow:auto";
    el.parentElement!.append(box);
    box.append(el);
    const key = action === "up" ? "lifecycle-30" : "lifecycle-0";
    const handle = healthSummary(el)!.querySelector<HTMLElement>(`[data-test="drag-${key}"]`)!;
    if (action === "up")
      box.scrollTop = handle.getBoundingClientRect().top - box.getBoundingClientRect().top - 100;
    const start = handle.getBoundingClientRect();
    const bounds = box.getBoundingClientRect();
    const initial = box.scrollTop;
    handle.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId: 93,
        clientX: start.left + 10,
        clientY: start.top + 10,
        bubbles: true,
      }),
    );
    const send = (type: string, y = action === "up" ? bounds.top + 8 : bounds.bottom - 8) =>
      document.dispatchEvent(
        new PointerEvent(type, { pointerId: 93, clientX: start.left + 10, clientY: y }),
      );
    send("pointermove");
    try {
      if (action === "fits") expect(box.scrollHeight).toBeLessThanOrEqual(box.clientHeight);
      else
        await expect
          .poll(() => (action === "up" ? initial - box.scrollTop : box.scrollTop - initial), {
            timeout: 3000,
          })
          .toBeGreaterThan(250);
      if (action === "up") {
        send("pointerup");
        await settle(el);
        expect((order.mock.calls[0]![0] as string[]).indexOf(key)).toBeLessThan(28);
      } else if (action === "leave") send("pointermove", bounds.top + bounds.height / 2);
      else if (action === "cancel") send("pointercancel");
      else if (action === "disconnect") el.remove();
      await settle(el);
      for (let i = 0; i < 2; i++) await new Promise(requestAnimationFrame);
      const ended = box.scrollTop;
      for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
      expect(box.scrollTop).toBe(ended);
    } finally {
      send("pointercancel");
    }
  },
);

describe("Save follows changes", () => {
  const modes = [
    "create",
    "rename",
    "printers",
    "watcher-name",
    "watcher-printers",
    "watcher-pass",
    "watcher-follows",
    "watcher-zones",
    "rest",
    "timing",
    "fallback",
  ] as const;
  type Mode = (typeof modes)[number];
  async function openSave(mode: Mode, overrides: Partial<PrepStationsApi> = {}) {
    history.replaceState(null, "", "/manage/prep-stations/view/stations");
    const a = api({
      load: vi.fn().mockResolvedValue({
        ...ticketView,
        zones: [{ id: "terrace", name: "Terrace", active: true }],
      }),
      updateWatcher: vi.fn(),
      setStationPrinters: vi.fn(),
      setWatcherPrinters: vi.fn(),
      setStationFallback: vi.fn(),
      ...overrides,
    });
    const el = await mount(a);
    await settle(el);
    const query = (selector: string) =>
      q(el, selector) ??
      ticketQ(q(el, '[data-test="tickets-table"]')!, selector) ??
      settingsQ(el, selector);
    const info = {
      create: ["new-station", "save-station", 'wt-input[name="name"]', "", "New station"],
      rename: ["rename-bar", "save-station-name", 'wt-input[name="stationName"]', "Bar", "New bar"],
      printers: [
        "edit-printers-bar",
        "save-printers-bar",
        '[data-test="station-printers-bar"]',
        ["old"],
        ["next"],
      ],
      "watcher-name": [
        "rename-watcher-pass",
        "save-watcher-name",
        '[data-test="watcher-rename-name"]',
        "Pass",
        "New pass",
      ],
      "watcher-printers": [
        "edit-watcher-printers-pass",
        "save-watcher-printers-pass",
        '[data-test="watcher-printers-pass"]',
        ["watcher"],
        ["next"],
      ],
      "watcher-pass": [
        "edit-watcher-pass-pass",
        "save-watcher-cell",
        '[data-test="watcher-cell-input"]',
        ["yes"],
        ["no"],
      ],
      "watcher-follows": [
        "edit-watcher-follows-pass",
        "save-watcher-cell",
        '[data-test="watcher-cell-input"]',
        ["bar"],
        ["__every__"],
      ],
      "watcher-zones": [
        "edit-watcher-zones-pass",
        "save-watcher-cell",
        '[data-test="watcher-cell-input"]',
        ["__every__"],
        ["terrace"],
      ],
      rest: [
        "edit-settings-rest-bar",
        "save-settings-cell",
        '[data-test="settings-choice"]',
        "no",
        "yes",
      ],
      timing: [
        "edit-settings-warmAfterMinutes-bar",
        "save-settings-cell",
        '[data-test="settings-minutes"]',
        "",
        "6",
      ],
      fallback: [
        "edit-settings-fallback-upstairs",
        "save-settings-cell",
        '[data-test="settings-choice"]',
        "",
        "bar",
      ],
    } as const;
    const [trigger, save, field, initial, changed] = info[mode];
    query(`[data-test="${trigger}"]`)!.click();
    await settle(el);
    const button = () => query(`[data-test="${save}"]`) as HTMLElementTagNameMap["wt-button"];
    const edit = async (value: string | readonly string[]) => {
      query(field)!.dispatchEvent(
        new CustomEvent("wt-change", {
          detail: typeof value === "string" ? { value } : { values: [...value], value: value[0] },
        }),
      );
      await settle(el);
    };
    return { el, a, button, edit, initial, changed, query };
  }
  async function state(button: HTMLElementTagNameMap["wt-button"], dirty: boolean) {
    await button.updateComplete;
    expect(button.variant).toBe(dirty ? "primary" : "secondary");
    expect(button.disabled).toBe(!dirty);
    expect(button.shadowRoot!.querySelector("button")!.disabled).toBe(!dirty);
  }
  it.each(modes)("%s opens quiet, enables after editing and quiets after undo", async (mode) => {
    const form = await openSave(mode);
    await state(form.button(), false);
    await form.edit(form.changed);
    await state(form.button(), true);
    await form.edit(form.initial);
    await state(form.button(), false);
  });
  it.each(modes)(
    "%s ignores an untouched host click without a write or validation",
    async (mode) => {
      const { el, a, button, query } = await openSave(mode);
      button().click();
      await settle(el);
      for (const write of [
        a.createStation,
        a.updateStation,
        a.updateWatcher,
        a.setStationPrinters,
        a.setWatcherPrinters,
        a.setStationFallback,
      ])
        expect(write).not.toHaveBeenCalled();
      expect(query('[data-test="settings-fallback-confirmation"]')).toBeNull();
      expect(el.shadowRoot!.querySelector('[role="alert"]')).toBeNull();
      expect(button().isConnected).toBe(true);
    },
  );
  it("Add station disables a changed invalid draft until its local checks pass", async () => {
    const form = await openSave("create");
    await form.edit("New station");
    form
      .query('wt-input[name="warmAfterMinutes"]')!
      .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "20" } }));
    await settle(form.el);
    form.button().click();
    await settle(form.el);
    expect(form.a.createStation).not.toHaveBeenCalled();
    expect(form.button().variant).toBe("primary");
    expect(form.button().disabled).toBe(true);
    form
      .query('wt-input[name="displayOrder"]')!
      .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "2" } }));
    await settle(form.el);
    expect(form.button().disabled).toBe(true);
    form
      .query('wt-input[name="warmAfterMinutes"]')!
      .dispatchEvent(new CustomEvent("wt-change", { detail: { value: "6" } }));
    await settle(form.el);
    await state(form.button(), true);
  });
  it("Add station keeps its validation summary until both invalid fields are fixed", async () => {
    setLocale("en");
    const form = await openSave("create");
    await editSaveField(form.el, form.query('wt-input[name="forgottenAfterMinutes"]')!, "10");
    form.button().click();
    await settle(form.el);
    expect(form.query('[data-field-error="name"]')).not.toBeNull();
    expect(form.query('[data-field-error="forgottenAfterMinutes"]')).not.toBeNull();
    await form.edit("New station");
    expect(form.query('[data-field-error="name"]')).toBeNull();
    expect(form.query('[data-field-error="forgottenAfterMinutes"]')).not.toBeNull();
    expect(form.query("wt-modal")!.textContent).toContain(
      "Correct the highlighted fields to continue.",
    );
    expect(form.button().disabled).toBe(true);
    await editSaveField(form.el, form.query('wt-input[name="forgottenAfterMinutes"]')!, "15");
    expect(form.query('[role="alert"]')).toBeNull();
    await state(form.button(), true);
    expect(form.a.createStation).not.toHaveBeenCalled();
  });
  it("Add station explains a field broken again after a validation attempt", async () => {
    setLocale("en");
    const form = await openSave("create");
    await form.edit("New station");
    await editSaveField(form.el, form.query('wt-input[name="forgottenAfterMinutes"]')!, "10");
    form.button().click();
    await settle(form.el);
    expect(form.query('[data-field-error="forgottenAfterMinutes"]')).not.toBeNull();
    await editSaveField(form.el, form.query('wt-input[name="forgottenAfterMinutes"]')!, "15");
    await state(form.button(), true);
    await editSaveField(form.el, form.query('wt-input[name="forgottenAfterMinutes"]')!, "10");
    expect(form.button().variant).toBe("primary");
    expect(form.button().disabled).toBe(true);
    expect(form.query('[data-field-error="forgottenAfterMinutes"]')).not.toBeNull();
    expect(form.query("wt-modal")!.textContent).toContain(
      "Correct the highlighted fields to continue.",
    );
    expect(form.a.createStation).not.toHaveBeenCalled();
  });
  it.each(["rename", "watcher-name"] as const)("%s compares trimmed names", async (mode) => {
    const form = await openSave(mode);
    await form.edit(` ${form.initial as string} `);
    await state(form.button(), false);
    form.button().click();
    await settle(form.el);
    expect(form.a.updateStation).not.toHaveBeenCalled();
    expect(form.a.updateWatcher).not.toHaveBeenCalled();
  });
  it("an explicit default minute value is a change from inheritance, then numeric spelling is ignored", async () => {
    const server = structuredClone(ticketView);
    server.stations[0]!.timingOverrides.warmAfterMinutes = 5;
    const form = await openSave("timing", { load: vi.fn().mockResolvedValue(server) });
    await form.edit("05");
    await state(form.button(), false);
    await form.edit("");
    await state(form.button(), true);
  });
  it.each([
    "rename",
    "printers",
    "watcher-name",
    "watcher-printers",
    "watcher-pass",
    "rest",
    "timing",
  ] as const)("%s stays primary during a write and retryable after refusal", async (mode) => {
    let refuse!: (error: unknown) => void;
    const write = new Promise<void>((_resolve, reject) => {
      refuse = reject;
    });
    const save = vi.fn(() => write);
    const form = await openSave(mode, {
      updateStation: save,
      updateWatcher: save,
      setStationPrinters: save,
      setWatcherPrinters: save,
    });
    await form.edit(form.changed);
    form.button().click();
    await settle(form.el);
    expect(save).toHaveBeenCalledTimes(1);
    expect(form.button().variant).toBe("primary");
    expect(form.button().disabled).toBe(true);
    refuse({ code: "server.internal" });
    await settle(form.el);
    await state(form.button(), true);
    form.button().click();
    await settle(form.el);
    expect(save).toHaveBeenCalledTimes(2);
  });
  it("station printer comparison ignores the saved membership order", async () => {
    const saved = {
      ...ticketView,
      stationPrinters: [
        { stationId: "bar", printerId: "old" },
        { stationId: "bar", printerId: "next" },
      ],
    };
    const form = await openSave("printers", { load: vi.fn().mockResolvedValue(saved) });
    await form.edit(["next", "old"]);
    await state(form.button(), false);
    form.button().click();
    await settle(form.el);
    expect(form.a.setStationPrinters).not.toHaveBeenCalled();
  });
  it("a standalone station rename preserves newer input after committing the submitted name", async () => {
    let complete!: () => void;
    const write = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const save = vi.fn(() => write);
    const form = await openSave("rename", { updateStation: save });
    await form.edit("Submitted name");
    form.button().click();
    await settle(form.el);
    await form.edit("Newer name");
    complete();
    await settle(form.el);
    expect(save).toHaveBeenCalledExactlyOnceWith("bar", { name: "Submitted name" });
    expect((form.query('wt-input[name="stationName"]') as WtInput).value).toBe("Newer name");
    await state(form.button(), true);
    await form.edit("Submitted name");
    await state(form.button(), false);
  });
});

it.each(["en", "es"] as const)(
  "the configured fallback names outside-hours work in %s",
  async (locale) => {
    setLocale(locale);
    const el = await mount(
      api({ load: vi.fn().mockResolvedValue(withUpstairs({ open: true, why: "in_hours" })) }),
    );
    const combo = await openSettingsFallback(el);
    expect(combo.label).toBe(
      locale === "en"
        ? "Upstairs bar: Outside its hours, work goes to"
        : "Upstairs bar: Fuera de su horario, el trabajo va a",
    );
  },
);
