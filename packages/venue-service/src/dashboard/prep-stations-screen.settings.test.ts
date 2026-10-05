import { page } from "vitest/browser";
import { expectNoA11yViolations } from "@waitron/ui/src/a11y-helpers.js";
import { afterEach, expect, it, vi } from "vitest";
import { LiveData, setLocale } from "@waitron/dashboard-kit";
import { applyTokens, type WtDataTable, type WtInput, type WtCombobox } from "@waitron/ui";
import type { PrepStationsApi, PrepStationsView } from "./routing-client.js";
import type { PrepStationsScreen } from "./prep-stations-screen.js";
import "./prep-stations-screen.js";
const hosts: HTMLElement[] = [];
afterEach(() => {
  hosts.splice(0).forEach((host) => host.remove());
  setLocale("en");
  window.history.replaceState(null, "", "/manage");
});
const view: PrepStationsView = {
  routing: {
    claims: [
      { categoryId: "cocktails", target: { kind: "station", stationId: "bar" }, stationOff: false },
    ],
    exceptions: [],
    unassigned: {
      folders: [{ id: "food", name: "Food" }],
      products: [{ id: "bread", name: "Bread" }],
    },
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
  testProducts: [{ id: "bread", name: "Bread" }],
  printers: [],
  stationPrinters: [],
  devices: [],
  watchers: [],
};
function api(overrides: Partial<PrepStationsApi> = {}): PrepStationsApi {
  return {
    load: vi.fn().mockResolvedValue(view),
    readStationHealth: vi.fn().mockResolvedValue({
      capturedAt: "2026-10-05T12:00:00Z",
      stations: [],
      outputsDown: { printersDown: [], screensDark: [] },
    }),
    setClaim: vi.fn(),
    createException: vi.fn(),
    assignProduct: vi.fn(),
    removeClaim: vi.fn(),
    preview: vi.fn().mockResolvedValue([]),
    explain: vi.fn().mockResolvedValue({
      route: null,
      decidedBy: null,
      fallbacks: [],
      noReplacement: false,
      stations: [],
    }),
    createStation: vi.fn(),
    updateStation: vi.fn(),
    deactivateStation: vi.fn(),
    setDefaultStation: vi.fn(),
    ...overrides,
  } as unknown as PrepStationsApi;
}

async function mount(a: PrepStationsApi) {
  setLocale("en");
  window.history.replaceState(null, "", "/manage/prep-stations/view/settings");
  const host = document.createElement("div");
  applyTokens(host);
  document.body.append(host);
  hosts.push(host);
  const el = document.createElement("dashboard-prep-stations-screen") as PrepStationsScreen;
  el.api = a;
  host.append(el);
  await settle(el);
  expect(el.shadowRoot!.querySelector("wt-tabs")!.value).toBe("settings");
  return el;
}
async function settle(el: PrepStationsScreen) {
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
  const table = el.shadowRoot!.querySelector<WtDataTable>(
    "wt-data-table[data-test=settings-table]",
  );
  if (table) await table.updateComplete;
}
function q(el: PrepStationsScreen, selector: string): HTMLElement | null {
  return (
    el
      .shadowRoot!.querySelector("[data-test=settings-table]")
      ?.shadowRoot?.querySelector<HTMLElement>(selector) ?? null
  );
}
async function openRest(el: PrepStationsScreen) {
  expect(q(el, "[data-test=edit-settings-rest-bar]")).not.toBeNull();
  q(el, "[data-test=edit-settings-rest-bar]")!.click();
  await settle(el);
}
function choose(el: PrepStationsScreen, value: string) {
  q(el, "[data-test=settings-choice]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value } }),
  );
}

it("edits Show the rest of the order in its own Settings cell and saves only that field", async () => {
  const a = api();
  const el = await mount(a);
  await openRest(el);
  expect(el.shadowRoot!.querySelector("[data-test=station-modal]")).toBeNull();
  const input = q(el, "[data-test=settings-choice]") as WtCombobox;
  expect(input.name).toBe("showsRestOfOrder");
  expect(input.value).toBe("no");
  choose(el, "yes");
  await settle(el);
  q(el, "[data-test=save-settings-cell]")!.click();
  await settle(el);
  expect(a.updateStation).toHaveBeenCalledExactlyOnceWith("bar", { showsRestOfOrder: true });
  expect(q(el, "[data-test=settings-choice]")).toBeNull();
});
it.each(["cancel", "escape"])("%s discards a Settings draft without writing", async (how) => {
  const a = api();
  const el = await mount(a);
  await openRest(el);
  choose(el, "yes");
  await settle(el);
  if (how === "cancel") q(el, "[data-test=cancel-settings-cell]")!.click();
  else
    q(el, "[data-test=settings-choice]")!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }),
    );
  await settle(el);
  expect(a.updateStation).not.toHaveBeenCalled();
  await openRest(el);
  expect((q(el, "[data-test=settings-choice]") as WtCombobox).value).toBe("no");
});
it.each([
  ["management.request_invalid", { field: "showsRestOfOrder" }, true],
  ["station.not_found", {}, false],
] as const)("retains a retryable Settings draft after %s", async (code, params, field) => {
  const a = api({
    updateStation: vi.fn().mockRejectedValueOnce({ code, params }).mockResolvedValue(undefined),
  });
  const el = await mount(a);
  await openRest(el);
  choose(el, "yes");
  await settle(el);
  q(el, "[data-test=save-settings-cell]")!.click();
  await settle(el);
  expect((q(el, "[data-test=settings-choice]") as WtCombobox).value).toBe("yes");
  expect(!!(q(el, "[data-test=settings-choice]") as WtCombobox).error).toBe(field);
  expect(q(el, "wt-form-actions")?.shadowRoot?.textContent).toContain(
    field ? "Fix the fields marked above" : "could not be saved",
  );
  expect(q(el, "[data-test=save-settings-cell]")!.hasAttribute("disabled")).toBe(false);
  q(el, "[data-test=save-settings-cell]")!.click();
  await settle(el);
  expect(a.updateStation).toHaveBeenCalledTimes(2);
  expect(q(el, "[data-test=settings-choice]")).toBeNull();
});
it("keeps the cell closed when refresh fails after a successful write", async () => {
  const a = api({
    load: vi.fn().mockResolvedValueOnce(view).mockRejectedValue(new Error("offline")),
  });
  const el = await mount(a);
  await openRest(el);
  choose(el, "yes");
  await settle(el);
  q(el, "[data-test=save-settings-cell]")!.click();
  await settle(el);
  expect(a.updateStation).toHaveBeenCalledTimes(1);
  expect(q(el, "[data-test=settings-choice]")).toBeNull();
  expect(el.shadowRoot!.textContent).toContain("could not be loaded");
});
it("shows Never closes for the default station without a fallback editor", async () => {
  const el = await mount(api());
  expect(q(el, "[data-test=settings-fallback-bar]")?.textContent ?? "").toContain("Never closes");
  expect(q(el, "[data-test=edit-settings-fallback-bar]")).toBeNull();
});

function fallbackView(): PrepStationsView {
  return {
    ...view,
    stations: [
      ...view.stations,
      { ...view.stations[0]!, id: "grill", name: "Grill", isDefault: false, displayOrder: 2 },
    ],
    routing: {
      ...view.routing,
      stations: [
        ...view.routing.stations,
        { id: "grill", name: "Grill", active: true },
        { id: "disabled", name: "Closed bar", active: false },
      ],
      stationTimes: [
        ...view.routing.stationTimes,
        {
          stationId: "grill",
          nextTransition: null,
          status: { open: true, why: "in_hours" },
          hours: [],
          fallbackStationId: "bar",
          today: null,
          closedSendsTo: "grill",
        },
      ],
    },
  };
}
async function openFallback(el: PrepStationsScreen) {
  expect(q(el, "[data-test=edit-settings-fallback-grill]")).not.toBeNull();
  q(el, "[data-test=edit-settings-fallback-grill]")!.click();
  await settle(el);
}
it("keeps fallback editing in its cell and confirms its destination before writing", async () => {
  const a = api({ load: vi.fn().mockResolvedValue(fallbackView()), setStationFallback: vi.fn() });
  const el = await mount(a);
  await openFallback(el);
  const input = q(el, "[data-test=settings-choice]") as WtCombobox;
  expect(input.name).toBe("fallbackStationId");
  expect(input.value).toBe("bar");
  expect(input.options.map((o) => o.value)).toEqual(["", "bar"]);
  choose(el, "");
  await settle(el);
  q(el, "[data-test=save-settings-cell]")!.click();
  await settle(el);
  expect(a.setStationFallback).not.toHaveBeenCalled();
  expect(q(el, "[data-test=settings-fallback-confirmation]")?.textContent).toContain(
    "ask where to send its dishes",
  );
  expect(el.shadowRoot!.querySelector("[data-test=station-action-modal]")).toBeNull();
  q(el, "[data-test=save-settings-cell]")!.click();
  await settle(el);
  expect(a.setStationFallback).toHaveBeenCalledExactlyOnceWith("grill", null);
  expect(q(el, "[data-test=settings-choice]")).toBeNull();
});
it("rechecks confirmation when the fallback draft changes", async () => {
  const a = api({ load: vi.fn().mockResolvedValue(fallbackView()), setStationFallback: vi.fn() });
  const el = await mount(a);
  await openFallback(el);
  q(el, "[data-test=save-settings-cell]")!.click();
  await settle(el);
  expect(q(el, "[data-test=settings-fallback-confirmation]")?.textContent).toContain("Bar");
  choose(el, "");
  await settle(el);
  expect(q(el, "[data-test=settings-fallback-confirmation]")).toBeNull();
  q(el, "[data-test=save-settings-cell]")!.click();
  await settle(el);
  expect(a.setStationFallback).not.toHaveBeenCalled();
});
it.each([
  ["station.fallback_loop", "loop"],
  ["route.station_inactive", "disabled"],
] as const)("keeps the fallback draft retryable after %s", async (code, word) => {
  const a = api({
    load: vi.fn().mockResolvedValue(fallbackView()),
    setStationFallback: vi.fn().mockRejectedValueOnce({ code }).mockResolvedValue(undefined),
  });
  const el = await mount(a);
  await openFallback(el);
  choose(el, "");
  await settle(el);
  q(el, "[data-test=save-settings-cell]")!.click();
  await settle(el);
  q(el, "[data-test=save-settings-cell]")!.click();
  await settle(el);
  expect((q(el, "[data-test=settings-choice]") as WtCombobox).error).toContain(word);
  expect(q(el, "[data-test=save-settings-cell]")!.hasAttribute("disabled")).toBe(false);
  q(el, "[data-test=save-settings-cell]")!.click();
  await settle(el);
  expect(a.setStationFallback).toHaveBeenCalledTimes(2);
});

it("refuses a missing Settings yes/no choice before a write and recovers after choosing", async () => {
  const a = api();
  const el = await mount(a);
  await openRest(el);
  choose(el, "");
  await settle(el);
  q(el, "[data-test=save-settings-cell]")!.click();
  await settle(el);
  expect(a.updateStation).not.toHaveBeenCalled();
  expect((q(el, "[data-test=settings-choice]") as WtCombobox).error).not.toBe("");
  expect(q(el, "[data-test=save-settings-cell]")!.hasAttribute("disabled")).toBe(true);
  choose(el, "yes");
  await settle(el);
  expect(q(el, "[data-test=save-settings-cell]")!.hasAttribute("disabled")).toBe(false);
  q(el, "[data-test=save-settings-cell]")!.click();
  await settle(el);
  expect(a.updateStation).toHaveBeenCalledExactlyOnceWith("bar", { showsRestOfOrder: true });
});
it("locks an in-flight Settings save against repeated writes and discard", async () => {
  let resolve!: () => void;
  const a = api({
    updateStation: vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    ),
  });
  const el = await mount(a);
  await openRest(el);
  choose(el, "yes");
  await settle(el);
  q(el, "[data-test=save-settings-cell]")!.click();
  await settle(el);
  expect(q(el, "[data-test=save-settings-cell]")!.hasAttribute("disabled")).toBe(true);
  expect(q(el, "[data-test=cancel-settings-cell]")!.hasAttribute("disabled")).toBe(true);
  q(el, "[data-test=settings-choice]")!.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }),
  );
  await settle(el);
  expect(q(el, "[data-test=settings-choice]")).not.toBeNull();
  expect(a.updateStation).toHaveBeenCalledTimes(1);
  resolve();
  await settle(el);
  expect(q(el, "[data-test=settings-choice]")).toBeNull();
});

it("rechecks a previously submitted Settings draft on every change and focuses its invalid field", async () => {
  const el = await mount(api());
  await openRest(el);
  choose(el, "");
  await settle(el);
  q(el, "[data-test=save-settings-cell]")!.click();
  await settle(el);
  choose(el, "yes");
  await settle(el);
  choose(el, "");
  await settle(el);
  expect(q(el, "[data-test=save-settings-cell]")!.hasAttribute("disabled")).toBe(true);
  expect((q(el, "[data-test=settings-choice]") as WtCombobox).error).toContain("Choose Yes or No");
});
it("live Settings reads retain its draft and save refusal", async () => {
  const liveData = new LiveData();
  const server = structuredClone(view);
  const load = vi.fn(async () => structuredClone(server));
  const el = await mount(
    api({ liveData, load, updateStation: vi.fn().mockRejectedValue(new Error("offline")) }),
  );
  await openRest(el);
  choose(el, "yes");
  await settle(el);
  q(el, "[data-test=save-settings-cell]")!.click();
  await settle(el);
  server.stations[0]!.name = "Main bar";
  liveData.invalidate([{ type: "kitchen_stations", id: "bar" }]);
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  await settle(el);
  expect((q(el, "[data-test=settings-choice]") as WtCombobox).value).toBe("yes");
  expect(q(el, "wt-form-actions")?.shadowRoot?.textContent).toContain("could not be saved");
  expect(q(el, "[data-test=settings-choice]")!.getAttribute("label")).toContain("Main bar");
});

it("focuses the invalid Settings field after submission", async () => {
  const el = await mount(api());
  await openRest(el);
  choose(el, "");
  await settle(el);
  q(el, "[data-test=save-settings-cell]")!.click();
  await settle(el);
  expect(q(el, "[data-test=settings-choice]")!.shadowRoot!.activeElement).not.toBeNull();
});
it("puts a field refusal beside the choice and a correction summary above the buttons", async () => {
  const el = await mount(
    api({
      updateStation: vi.fn().mockRejectedValue({
        code: "management.request_invalid",
        params: { field: "showsRestOfOrder" },
      }),
    }),
  );
  await openRest(el);
  q(el, "[data-test=save-settings-cell]")!.click();
  await settle(el);
  expect((q(el, "[data-test=settings-choice]") as WtCombobox).error).toContain(
    "could not be saved",
  );
  expect(q(el, "wt-form-actions")?.shadowRoot?.textContent).toContain(
    "Fix the fields marked above",
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
  "Settings choice cells render accessibly in %s %s at %ipx",
  async (locale, theme, width) => {
    const previous = { width: window.innerWidth, height: window.innerHeight };
    try {
      await page.viewport(width, 900);
      const saved = fallbackView();
      saved.routing.stationTimes.find(
        (station) => station.stationId === "grill",
      )!.fallbackStationId = null;
      const el = await mount(
        api({
          load: vi.fn().mockResolvedValue(saved),
          updateStation: vi.fn().mockRejectedValue({
            code: "management.request_invalid",
            params: { field: "showsRestOfOrder" },
          }),
          setStationFallback: vi.fn().mockRejectedValue({ code: "station.fallback_loop" }),
        }),
      );
      setLocale(locale);
      el.requestUpdate();
      await settle(el);
      const host = el.parentElement!;
      host.style.width = `${width}px`;
      host.setAttribute("data-theme", theme);
      host.style.background = "var(--wt-color-bg)";
      document.body.style.margin = "0";
      document.body.style.background = getComputedStyle(host).backgroundColor;
      expect(host.getBoundingClientRect().width).toBe(width);
      expect(window.innerWidth).toBe(width);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      await expectNoA11yViolations(host);
      await page.screenshot({ path: `look/settings-choice-${locale}-${theme}-${width}-saved.png` });
      await page.elementLocator(q(el, "[data-test=edit-settings-rest-bar]")!).click();
      await settle(el);
      const combo = q(el, "[data-test=settings-choice]") as WtCombobox;
      await combo.updateComplete;
      await page.elementLocator(combo.shadowRoot!.querySelector(".trigger")!).click();
      await combo.updateComplete;
      const list = combo.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
      expect(list.matches(":popover-open")).toBe(true);
      expect(list.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
      expect(list.getBoundingClientRect().right).toBeLessThanOrEqual(width);
      await expectNoA11yViolations(host);
      await page.screenshot({
        path: `look/settings-choice-${locale}-${theme}-${width}-picker.png`,
      });
      await page.elementLocator(combo.shadowRoot!.querySelector(".trigger")!).click();
      choose(el, "yes");
      await settle(el);
      await page.elementLocator(q(el, "[data-test=save-settings-cell]")!).click();
      await settle(el);
      expect(combo.error).toContain(locale === "en" ? "could not be saved" : "No se pudo guardar");
      await expectNoA11yViolations(host);
      await page.screenshot({
        path: `look/settings-choice-${locale}-${theme}-${width}-refused.png`,
      });
      q(el, "[data-test=cancel-settings-cell]")!.click();
      await settle(el);
      await page.elementLocator(q(el, "[data-test=edit-settings-fallback-grill]")!).click();
      await settle(el);
      expect((q(el, "[data-test=settings-choice]") as WtCombobox).value).toBe("");
      choose(el, "bar");
      await settle(el);
      await page.elementLocator(q(el, "[data-test=save-settings-cell]")!).click();
      await settle(el);
      expect(q(el, "[data-test=settings-fallback-confirmation]")?.textContent).toContain("Bar");
      await expectNoA11yViolations(host);
      await page.screenshot({
        path: `look/settings-choice-${locale}-${theme}-${width}-confirmation.png`,
      });
      await page.elementLocator(q(el, "[data-test=save-settings-cell]")!).click();
      await settle(el);
      expect((q(el, "[data-test=settings-choice]") as WtCombobox).error).toContain(
        locale === "en" ? "loop" : "bucle",
      );
      expect(el.api.setStationFallback).toHaveBeenCalledExactlyOnceWith("grill", "bar");
      const save = q(el, "[data-test=save-settings-cell]")!.getBoundingClientRect();
      expect(save.left).toBeGreaterThanOrEqual(0);
      expect(save.right).toBeLessThanOrEqual(width);
      await expectNoA11yViolations(host);
      await page.screenshot({
        path: `look/settings-choice-${locale}-${theme}-${width}-fallback-refused.png`,
      });
    } finally {
      document.body.style.margin = "";
      document.body.style.background = "";
      await page.viewport(previous.width, previous.height);
    }
  },
);

type TimingField = "warmAfterMinutes" | "overdueAfterMinutes" | "forgottenAfterMinutes";
function timingView(): PrepStationsView {
  const v = structuredClone(view);
  Object.assign(v.stations[0]!, {
    warmAfterMinutes: 5,
    overdueAfterMinutes: 9,
    forgottenAfterMinutes: 15,
    timingDefaults: { warmAfterMinutes: 5, overdueAfterMinutes: 10, forgottenAfterMinutes: 15 },
    timingOverrides: { warmAfterMinutes: 5, overdueAfterMinutes: 9, forgottenAfterMinutes: null },
  });
  return v;
}
async function openTiming(el: PrepStationsScreen, field: TimingField) {
  expect(q(el, `[data-test=edit-settings-${field}-bar]`)).not.toBeNull();
  q(el, `[data-test=edit-settings-${field}-bar]`)!.click();
  await settle(el);
}
function minutes(el: PrepStationsScreen, value: string) {
  q(el, "[data-test=settings-minutes]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value } }),
  );
}
it("distinguishes inherited minutes from an explicit override equal to the default", async () => {
  const el = await mount(api({ load: vi.fn().mockResolvedValue(timingView()) }));
  expect(q(el, "[data-test=edit-settings-warmAfterMinutes-bar]")!.textContent?.trim()).toBe("5");
  expect(
    q(el, "[data-test=edit-settings-warmAfterMinutes-bar]")!.getAttribute("part"),
  ).not.toContain("inherited");
  expect(q(el, "[data-test=edit-settings-forgottenAfterMinutes-bar]")!.textContent?.trim()).toBe(
    "15",
  );
  expect(
    q(el, "[data-test=edit-settings-forgottenAfterMinutes-bar]")!.getAttribute("part"),
  ).toContain("inherited");
  await openTiming(el, "forgottenAfterMinutes");
  const input = q(el, "[data-test=settings-minutes]") as WtInput;
  expect(input.value).toBe("");
  expect(input.placeholder).toBe("15");
  expect(input.name).toBe("forgottenAfterMinutes");
  expect(input.required).toBe(false);
});
it.each([
  ["warmAfterMinutes", "3", { warmAfterMinutes: 3 }],
  ["overdueAfterMinutes", "", { overdueAfterMinutes: null }],
  ["forgottenAfterMinutes", "20", { forgottenAfterMinutes: 20 }],
] as const)("saves only the %s override, with blank inheriting", async (field, value, payload) => {
  const a = api({ load: vi.fn().mockResolvedValue(timingView()) });
  const el = await mount(a);
  await openTiming(el, field);
  minutes(el, value);
  await settle(el);
  q(el, "[data-test=save-settings-cell]")!.click();
  await settle(el);
  expect(a.updateStation).toHaveBeenCalledExactlyOnceWith("bar", payload);
  expect(q(el, "[data-test=settings-minutes]")).toBeNull();
});
it.each(["0", "1.5", "abc", "9", "2147483648"])(
  "refuses invalid or unordered warm minutes %s locally and rechecks",
  async (value) => {
    const a = api({ load: vi.fn().mockResolvedValue(timingView()) });
    const el = await mount(a);
    await openTiming(el, "warmAfterMinutes");
    minutes(el, value);
    await settle(el);
    q(el, "[data-test=save-settings-cell]")!.click();
    await settle(el);
    expect(a.updateStation).not.toHaveBeenCalled();
    expect((q(el, "[data-test=settings-minutes]") as WtInput).error).not.toBe("");
    expect(q(el, "[data-test=save-settings-cell]")!.hasAttribute("disabled")).toBe(true);
    expect(q(el, "[data-test=settings-minutes]")!.shadowRoot!.activeElement).not.toBeNull();
    minutes(el, "4");
    await settle(el);
    expect(q(el, "[data-test=save-settings-cell]")!.hasAttribute("disabled")).toBe(false);
    q(el, "[data-test=save-settings-cell]")!.click();
    await settle(el);
    expect(a.updateStation).toHaveBeenCalledExactlyOnceWith("bar", { warmAfterMinutes: 4 });
  },
);
it("keeps a timing refusal retryable beside its field with a bottom summary", async () => {
  const a = api({
    load: vi.fn().mockResolvedValue(timingView()),
    updateStation: vi
      .fn()
      .mockRejectedValueOnce({
        code: "station.thresholds_invalid",
        params: { field: "overdueAfterMinutes" },
      })
      .mockResolvedValue(undefined),
  });
  const el = await mount(a);
  await openTiming(el, "warmAfterMinutes");
  minutes(el, "7");
  await settle(el);
  q(el, "[data-test=save-settings-cell]")!.click();
  await settle(el);
  expect((q(el, "[data-test=settings-minutes]") as WtInput).value).toBe("7");
  expect((q(el, "[data-test=settings-minutes]") as WtInput).error).toContain("whole minutes");
  expect(q(el, "wt-form-actions")?.shadowRoot?.textContent).toContain(
    "Fix the fields marked above",
  );
  expect(q(el, "[data-test=save-settings-cell]")!.hasAttribute("disabled")).toBe(false);
  q(el, "[data-test=save-settings-cell]")!.click();
  await settle(el);
  expect(a.updateStation).toHaveBeenCalledTimes(2);
});
it.each(["cancel", "escape"])(
  "%s discards a timing draft and restores the saved override",
  async (how) => {
    const a = api({ load: vi.fn().mockResolvedValue(timingView()) });
    const el = await mount(a);
    await openTiming(el, "overdueAfterMinutes");
    minutes(el, "");
    await settle(el);
    if (how === "cancel") q(el, "[data-test=cancel-settings-cell]")!.click();
    else
      q(el, "[data-test=settings-minutes]")!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }),
      );
    await settle(el);
    await openTiming(el, "overdueAfterMinutes");
    expect((q(el, "[data-test=settings-minutes]") as WtInput).value).toBe("9");
    expect(a.updateStation).not.toHaveBeenCalled();
  },
);

it("live venue-default changes refresh inherited timing without replacing an override draft or refusal", async () => {
  const liveData = new LiveData();
  const server = timingView();
  const load = vi.fn(async () => structuredClone(server));
  const el = await mount(
    api({
      liveData,
      load,
      updateStation: vi.fn().mockRejectedValue({
        code: "station.thresholds_invalid",
        params: { field: "warmAfterMinutes" },
      }),
    }),
  );
  await openTiming(el, "warmAfterMinutes");
  minutes(el, "7");
  await settle(el);
  q(el, "[data-test=save-settings-cell]")!.click();
  await settle(el);
  server.stations[0]!.forgottenAfterMinutes = 18;
  server.stations[0]!.timingDefaults.forgottenAfterMinutes = 18;
  liveData.invalidate([{ type: "kitchen_timing_defaults", id: "venue" }]);
  await vi.waitFor(() =>
    expect(q(el, "[data-test=edit-settings-forgottenAfterMinutes-bar]")!.textContent?.trim()).toBe(
      "18",
    ),
  );
  expect((q(el, "[data-test=settings-minutes]") as WtInput).value).toBe("7");
  expect((q(el, "[data-test=settings-minutes]") as WtInput).error).toContain("whole minutes");
  expect(q(el, "[data-test=save-settings-cell]")!.hasAttribute("disabled")).toBe(false);
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
  "timing cells render inherited values and retryable errors in %s %s at %ipx",
  async (locale, theme, width) => {
    const previous = { width: window.innerWidth, height: window.innerHeight };
    try {
      await page.viewport(width, 900);
      const el = await mount(
        api({
          load: vi.fn().mockResolvedValue(timingView()),
          updateStation: vi.fn().mockRejectedValue({
            code: "station.thresholds_invalid",
            params: { field: "overdueAfterMinutes" },
          }),
        }),
      );
      setLocale(locale);
      el.requestUpdate();
      await settle(el);
      const host = el.parentElement!;
      host.style.width = `${width}px`;
      host.setAttribute("data-theme", theme);
      host.style.background = "var(--wt-color-bg)";
      document.body.style.margin = "0";
      document.body.style.background = getComputedStyle(host).backgroundColor;
      const inherited = q(el, "[data-test=edit-settings-forgottenAfterMinutes-bar]")!;
      const override = q(el, "[data-test=edit-settings-warmAfterMinutes-bar]")!;
      await (inherited as unknown as { updateComplete: Promise<unknown> }).updateComplete;
      await (override as unknown as { updateComplete: Promise<unknown> }).updateComplete;
      expect(getComputedStyle(inherited.shadowRoot!.querySelector("button")!).color).not.toBe(
        getComputedStyle(override.shadowRoot!.querySelector("button")!).color,
      );
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
      await expectNoA11yViolations(host);
      await page.screenshot({ path: `look/timing-${locale}-${theme}-${width}-saved.png` });
      await page.elementLocator(override).click();
      await settle(el);
      const input = q(el, "[data-test=settings-minutes]") as WtInput;
      await input.updateComplete;
      expect(input.label).toContain(locale === "en" ? "Warm" : "Aviso");
      await expectNoA11yViolations(host);
      await page.screenshot({ path: `look/timing-${locale}-${theme}-${width}-editor.png` });
      minutes(el, "7");
      await settle(el);
      await page.elementLocator(q(el, "[data-test=save-settings-cell]")!).click();
      await settle(el);
      expect(input.error).not.toBe("");
      expect(q(el, "[data-test=save-settings-cell]")!.hasAttribute("disabled")).toBe(false);
      await expectNoA11yViolations(host);
      const save = q(el, "[data-test=save-settings-cell]")!.getBoundingClientRect();
      expect(save.left).toBeGreaterThanOrEqual(0);
      expect(save.right).toBeLessThanOrEqual(width);
      await page.screenshot({ path: `look/timing-${locale}-${theme}-${width}-refused.png` });
    } finally {
      await page.viewport(previous.width, previous.height);
    }
  },
);

it.each([
  [
    "management.request_invalid",
    "warmAfterMinutes",
    "Use whole minutes with warm < overdue < forgotten.",
  ],
  ["management.request_invalid", "forgottenAfterMinutes", ""],
  ["connection.failed", "", ""],
])(
  "timing cell classifies %s/%s and leaves its refusal retryable",
  async (code, field, fieldError) => {
    const save = vi.fn().mockRejectedValue({ code, params: { field } });
    const el = await mount(
      api({ load: vi.fn().mockResolvedValue(timingView()), updateStation: save }),
    );
    await openTiming(el, "warmAfterMinutes");
    minutes(el, "4");
    await settle(el);
    const input = q(el, "[data-test=settings-minutes]") as WtInput;
    input
      .shadowRoot!.querySelector("input")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));
    await vi.waitFor(() =>
      expect(save).toHaveBeenCalledExactlyOnceWith("bar", { warmAfterMinutes: 4 }),
    );
    await settle(el);
    const retained = q(el, "[data-test=settings-minutes]") as WtInput;
    expect(retained.value).toBe("4");
    expect(retained.error).toBe(fieldError);
    expect(q(el, "wt-form-actions")!.shadowRoot!.textContent).toContain(
      fieldError ? "Fix the fields marked above." : "The change could not be saved.",
    );
    expect(q(el, "[data-test=save-settings-cell]")!.hasAttribute("disabled")).toBe(false);
  },
);

it("fallback cell retains a confirmed destination after an unrelated request refusal", async () => {
  const save = vi
    .fn()
    .mockRejectedValue({ code: "management.request_invalid", params: { field: "name" } });
  const el = await mount(
    api({ load: vi.fn().mockResolvedValue(fallbackView()), setStationFallback: save }),
  );
  await openFallback(el);
  choose(el, "");
  await settle(el);
  q(el, "[data-test=save-settings-cell]")!.click();
  await settle(el);
  q(el, "[data-test=save-settings-cell]")!.click();
  await vi.waitFor(() => expect(save).toHaveBeenCalledExactlyOnceWith("grill", null));
  await settle(el);
  expect((q(el, "[data-test=settings-choice]") as WtCombobox).value).toBe("");
  expect((q(el, "[data-test=settings-choice]") as WtCombobox).error).toBe("");
  expect(q(el, "wt-form-actions")!.shadowRoot!.textContent).toContain(
    "The change could not be saved.",
  );
  expect(q(el, "[data-test=save-settings-cell]")!.hasAttribute("disabled")).toBe(false);
});

it("choice-cell Enter on the combobox does not save until its explicit Save action", async () => {
  const save = vi.fn();
  const el = await mount(api({ updateStation: save }));
  await openRest(el);
  choose(el, "yes");
  await settle(el);
  q(el, "[data-test=settings-choice]")!.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
  );
  await settle(el);
  expect(save).not.toHaveBeenCalled();
  q(el, "[data-test=save-settings-cell]")!.click();
  await settle(el);
  expect(save).toHaveBeenCalledExactlyOnceWith("bar", { showsRestOfOrder: true });
});
