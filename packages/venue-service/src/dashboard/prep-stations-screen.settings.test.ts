import type { RetiredFallbackPrepStationsView as PrepStationsView } from "../../test/retired-routing-fixture-types.js";
import { page } from "vitest/browser";
import { expectNoA11yViolations } from "@waitron/ui/src/a11y-helpers.js";
import { afterEach, expect, it, vi } from "vitest";
import { LiveData, setLocale } from "@waitron/dashboard-kit";
import { applyTokens, type WtDataTable, type WtInput } from "@waitron/ui";
import type { PrepStationsApi } from "./routing-client.js";
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
    zones: [],
    categories: [
      { id: "drinks", name: "Drinks", parentId: null },
      { id: "cocktails", name: "Cocktails", parentId: "drinks" },
      { id: "food", name: "Food", parentId: null },
    ],
    products: [{ id: "bread", name: "Bread", categoryId: null }],
    periods: [],
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

        status: { open: true, why: "default" },

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
};
// These cases must still observe attempted fallback writes.
type ScreenApi = PrepStationsApi & {
  setStationFallback: (id: string, fallbackStationId: string | null) => Promise<void>;
};
function api(overrides: Partial<ScreenApi> = {}): ScreenApi {
  return {
    load: vi.fn().mockResolvedValue(view),
    preview: vi.fn().mockResolvedValue([]),
    createStation: vi.fn(),
    updateStation: vi.fn(),
    deactivateStation: vi.fn(),
    setDefaultStation: vi.fn(),
    ...overrides,
  } as unknown as ScreenApi;
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
async function openWarm(el: PrepStationsScreen) {
  expect(q(el, "[data-test=edit-settings-warmAfterMinutes-bar]")).not.toBeNull();
  q(el, "[data-test=edit-settings-warmAfterMinutes-bar]")!.click();
  await settle(el);
}
function typeMinutes(el: PrepStationsScreen, value: string) {
  q(el, "[data-test=settings-minutes]")!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value } }),
  );
}
const minutesField = (el: PrepStationsScreen) => q(el, "[data-test=settings-minutes]") as WtInput;

it("edits Show the rest of the order in the station editor, not in Settings, and saves only that field", async () => {
  const a = api();
  const el = await mount(a);
  expect(q(el, "[data-test=edit-settings-rest-bar]")).toBeNull();
  expect(q(el, "thead")!.textContent).not.toContain("Show the rest of the order");
  el.shadowRoot!.querySelector("prep-station-table")!
    .shadowRoot!.querySelector("wt-data-table")!
    .shadowRoot!.querySelector<HTMLElement>('[data-test="edit-bar"]')!
    .click();
  await settle(el);
  const editor = el.shadowRoot!.querySelector("prep-station-editor")!;
  await editor.updateComplete;
  const rest = editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-switch"]>(
    "wt-switch[name=showsRestOfOrder]",
  )!;
  expect(rest.checked).toBe(false);
  rest.dispatchEvent(new CustomEvent("wt-change", { detail: { checked: true } }));
  await editor.updateComplete;
  editor.shadowRoot!.querySelector<HTMLElement>("[data-test=save-station-edit]")!.click();
  await settle(el);
  expect(a.updateStation).toHaveBeenCalledExactlyOnceWith("bar", { showsRestOfOrder: true });
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("prep-station-editor")).toBeNull());
});
it.each(["cancel", "escape"])("%s discards a Settings draft without writing", async (how) => {
  const a = api();
  const el = await mount(a);
  await openWarm(el);
  typeMinutes(el, "8");
  await settle(el);
  if (how === "cancel") q(el, "[data-test=cancel-settings-cell]")!.click();
  else
    q(el, "[data-test=settings-minutes]")!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }),
    );
  await settle(el);
  expect(a.updateStation).not.toHaveBeenCalled();
  await openWarm(el);
  expect(minutesField(el).value).toBe("");
});
it.each([
  ["management.request_invalid", { field: "warmAfterMinutes" }, true],
  ["station.not_found", {}, false],
] as const)("retains a retryable Settings draft after %s", async (code, params, field) => {
  const a = api({
    updateStation: vi.fn().mockRejectedValueOnce({ code, params }).mockResolvedValue(undefined),
  });
  const el = await mount(a);
  await openWarm(el);
  typeMinutes(el, "8");
  await settle(el);
  q(el, "[data-test=save-settings-cell]")!.click();
  await settle(el);
  expect(minutesField(el).value).toBe("8");
  expect(!!minutesField(el).error).toBe(field);
  expect(q(el, "wt-form-actions")?.shadowRoot?.textContent).toContain(
    field ? "Fix the fields marked above" : "could not be saved",
  );
  expect(q(el, "[data-test=save-settings-cell]")!.hasAttribute("disabled")).toBe(false);
  q(el, "[data-test=save-settings-cell]")!.click();
  await settle(el);
  expect(a.updateStation).toHaveBeenCalledTimes(2);
  expect(q(el, "[data-test=settings-minutes]")).toBeNull();
});
it("keeps the cell closed when refresh fails after a successful write", async () => {
  const a = api({
    load: vi.fn().mockResolvedValueOnce(view).mockRejectedValue(new Error("offline")),
  });
  const el = await mount(a);
  await openWarm(el);
  typeMinutes(el, "8");
  await settle(el);
  q(el, "[data-test=save-settings-cell]")!.click();
  await settle(el);
  expect(a.updateStation).toHaveBeenCalledTimes(1);
  expect(q(el, "[data-test=settings-minutes]")).toBeNull();
  expect(el.shadowRoot!.textContent).toContain("could not be loaded");
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

          status: { open: true, why: "open" },

          fallbackStationId: "bar",
          today: null,
          closedSendsTo: "grill",
        },
      ],
    },
  };
}
it("refuses a missing Settings yes/no choice before a write and recovers after choosing", async () => {
  const a = api();
  const el = await mount(a);
  await openWarm(el);
  typeMinutes(el, "0");
  await settle(el);
  q(el, "[data-test=save-settings-cell]")!.click();
  await settle(el);
  expect(a.updateStation).not.toHaveBeenCalled();
  expect(minutesField(el).error).not.toBe("");
  expect(q(el, "[data-test=save-settings-cell]")!.hasAttribute("disabled")).toBe(true);
  typeMinutes(el, "4");
  await settle(el);
  expect(q(el, "[data-test=save-settings-cell]")!.hasAttribute("disabled")).toBe(false);
  q(el, "[data-test=save-settings-cell]")!.click();
  await settle(el);
  expect(a.updateStation).toHaveBeenCalledExactlyOnceWith("bar", { warmAfterMinutes: 4 });
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
  await openWarm(el);
  typeMinutes(el, "8");
  await settle(el);
  q(el, "[data-test=save-settings-cell]")!.click();
  await settle(el);
  expect(q(el, "[data-test=save-settings-cell]")!.hasAttribute("disabled")).toBe(true);
  expect(q(el, "[data-test=cancel-settings-cell]")!.hasAttribute("disabled")).toBe(true);
  q(el, "[data-test=settings-minutes]")!.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }),
  );
  await settle(el);
  expect(q(el, "[data-test=settings-minutes]")).not.toBeNull();
  expect(a.updateStation).toHaveBeenCalledTimes(1);
  resolve();
  await settle(el);
  expect(q(el, "[data-test=settings-minutes]")).toBeNull();
});

it("rechecks a previously submitted Settings draft on every change and focuses its invalid field", async () => {
  const el = await mount(api());
  await openWarm(el);
  typeMinutes(el, "0");
  await settle(el);
  q(el, "[data-test=save-settings-cell]")!.click();
  await settle(el);
  typeMinutes(el, "4");
  await settle(el);
  typeMinutes(el, "0");
  await settle(el);
  expect(q(el, "[data-test=save-settings-cell]")!.hasAttribute("disabled")).toBe(true);
  expect(minutesField(el).error).toContain("Use whole minutes");
});
it("live Settings reads retain its draft and save refusal", async () => {
  const liveData = new LiveData();
  const server = structuredClone(view);
  const load = vi.fn(async () => structuredClone(server));
  const el = await mount(
    api({ liveData, load, updateStation: vi.fn().mockRejectedValue(new Error("offline")) }),
  );
  await openWarm(el);
  typeMinutes(el, "8");
  await settle(el);
  q(el, "[data-test=save-settings-cell]")!.click();
  await settle(el);
  server.stations[0]!.name = "Main bar";
  liveData.invalidate([{ type: "kitchen_stations", id: "bar" }]);
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  await settle(el);
  expect(minutesField(el).value).toBe("8");
  expect(q(el, "wt-form-actions")?.shadowRoot?.textContent).toContain("could not be saved");
  expect(minutesField(el).getAttribute("label")).toContain("Main bar");
});

it("focuses the invalid Settings field after submission", async () => {
  const el = await mount(api());
  await openWarm(el);
  typeMinutes(el, "0");
  await settle(el);
  q(el, "[data-test=save-settings-cell]")!.click();
  await settle(el);
  expect(minutesField(el).shadowRoot!.activeElement).not.toBeNull();
});
it("puts a field refusal beside the field and a correction summary above the buttons", async () => {
  const el = await mount(
    api({
      updateStation: vi.fn().mockRejectedValue({
        code: "management.request_invalid",
        params: { field: "warmAfterMinutes" },
      }),
    }),
  );
  await openWarm(el);
  typeMinutes(el, "8");
  await settle(el);
  q(el, "[data-test=save-settings-cell]")!.click();
  await settle(el);
  expect(minutesField(el).error).toContain("Use whole minutes");
  expect(q(el, "wt-form-actions")?.shadowRoot?.textContent).toContain(
    "Fix the fields marked above",
  );
});

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
      await page.screenshot({
        path: `__screenshots__/look/timing-${locale}-${theme}-${width}-saved.png`,
      });
      await page.elementLocator(override).click();
      await settle(el);
      const input = q(el, "[data-test=settings-minutes]") as WtInput;
      await input.updateComplete;
      expect(input.label).toContain(locale === "en" ? "Warm" : "Aviso");
      await expectNoA11yViolations(host);
      await page.screenshot({
        path: `__screenshots__/look/timing-${locale}-${theme}-${width}-editor.png`,
      });
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
      await page.screenshot({
        path: `__screenshots__/look/timing-${locale}-${theme}-${width}-refused.png`,
      });
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

it.each([
  ["active", true, "bar"],
  ["inactive", false, "disabled"],
  ["unset", true, null],
  ["self", true, "grill"],
] as const)(
  "Settings retires the fallback column for a %s stored choice",
  async (_kind, active, stored) => {
    const initial = fallbackView();
    initial.stations[1]!.active = active;
    initial.routing.stations[1]!.active = active;
    initial.routing.stationTimes[1]!.fallbackStationId = stored;
    const save = vi.fn();
    const a = api({ load: vi.fn().mockResolvedValue(initial), setStationFallback: save });
    const el = await mount(a);
    const table = el.shadowRoot!.querySelector<WtDataTable>("[data-test=settings-table]")!;
    expect(table.columns.map((column) => column.key)).toEqual([
      "name",
      "warmAfterMinutes",
      "overdueAfterMinutes",
      "forgottenAfterMinutes",
    ]);
    expect(
      q(el, "[data-test^=edit-settings-fallback-], [data-test^=settings-fallback-]"),
    ).toBeNull();
    expect(save).not.toHaveBeenCalled();
    expect(initial.routing.stationTimes[1]!.fallbackStationId).toBe(stored);
  },
);

it.each([
  ["active", true, "bar"],
  ["inactive", false, "disabled"],
  ["unset", true, null],
  ["self", true, "grill"],
] as const)(
  "The station editor keeps the non-default rest choice independent of a %s stored fallback",
  async (_kind, active, stored) => {
    const initial = fallbackView();
    initial.stations[1]!.active = active;
    initial.routing.stations[1]!.active = active;
    initial.routing.stationTimes[1]!.fallbackStationId = stored;
    const fallback = vi.fn();
    const update = vi.fn(async (id: string, values: { showsRestOfOrder?: boolean }) => {
      const station = initial.stations.find((row) => row.id === id)!;
      if (values.showsRestOfOrder !== undefined) station.showsRestOfOrder = values.showsRestOfOrder;
    });
    const el = await mount(
      api({
        load: vi.fn().mockResolvedValue(initial),
        updateStation: update,
        setStationFallback: fallback,
      }),
    );
    el.shadowRoot!.querySelector("wt-tabs")!.dispatchEvent(
      new CustomEvent("wt-tab-change", { detail: { value: "stations" } }),
    );
    await settle(el);
    const table = el
      .shadowRoot!.querySelector("prep-station-table")!
      .shadowRoot!.querySelector("wt-data-table")!.shadowRoot!;
    table.querySelector<HTMLElement>("[data-test=edit-grill]")!.click();
    await settle(el);
    const editor =
      el.shadowRoot!.querySelector<HTMLElementTagNameMap["prep-station-editor"]>(
        "prep-station-editor",
      )!;
    await editor.updateComplete;
    const input = editor.shadowRoot!.querySelector<HTMLElementTagNameMap["wt-switch"]>(
      "wt-switch[name=showsRestOfOrder]",
    )!;
    expect(input.checked).toBe(false);
    const save = editor.shadowRoot!.querySelector<HTMLElement>("[data-test=save-station-edit]")!;
    expect(save.hasAttribute("disabled")).toBe(true);
    input.dispatchEvent(new CustomEvent("wt-change", { detail: { checked: true } }));
    await editor.updateComplete;
    expect(save.hasAttribute("disabled")).toBe(false);
    save.click();
    await vi.waitFor(() =>
      expect(update).toHaveBeenCalledExactlyOnceWith("grill", { showsRestOfOrder: true }),
    );
    await vi.waitFor(() => expect(el.shadowRoot!.querySelector("prep-station-editor")).toBeNull());
    expect(fallback).not.toHaveBeenCalled();
    expect(initial.routing.stationTimes[1]!.fallbackStationId).toBe(stored);
    expect(initial.stations[1]!.active).toBe(active);
  },
);
