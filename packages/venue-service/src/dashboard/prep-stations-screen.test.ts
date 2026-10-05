import { page } from "vitest/browser";
import { afterEach, expect, it, vi } from "vitest";
import { expectNoA11yViolations } from "@waitron/ui/src/a11y-helpers.js";
import { middleWithin, textLines } from "@waitron/ui/src/test-helpers.js";
import { LiveData, setLocale } from "@waitron/dashboard-kit";
import { registerIcons, applyTokens, type WtCombobox, type WtInput } from "@waitron/ui";
import type { PrepStationsApi, PrepStationsView, StationHealthSnapshot } from "./routing-client.js";
import type { PrepStationsScreen } from "./prep-stations-screen.js";
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
it("shows watcher cards and station and tester follow lines", async () => {
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
          stationId: null,
          watcherId: "pass",
        },
      ],
      watchers: [pass, runner],
    }),
    explain: vi.fn().mockResolvedValue({
      route: { kind: "station", stationId: "bar" },
      decidedBy: { kind: "default" },
      fallbacks: [],
      noReplacement: false,
      stations: [],
    }),
  });
  const el = await mount(a);
  expect(q(el, '[data-test="watcher-pass"]')?.textContent).toContain("Follows: every station");
  expect(q(el, '[data-test="watcher-pass"]')?.textContent).toContain("For: every service zone");
  expect(q(el, '[data-test="watcher-pass"]')?.textContent).toContain("Runs the pass");
  expect(q(el, '[data-test="watcher-pass"]')?.textContent).toContain("Pass screen");
  expect(q(el, '[data-test="watcher-pass"]')?.textContent).toContain("Expo printer");
  expect(q(el, '[data-test="watcher-runner"]')?.textContent).toContain("Follows: Bar");
  expect(q(el, '[data-test="watcher-runner"]')?.textContent).toContain("For: Terrace");
  expect(q(el, '[data-test="station-bar"]')?.textContent).toContain(
    "Watched by: Pass, Terrace runner",
  );
  q(el, '[data-test="new-watcher"]');
  el.shadowRoot!.querySelector<HTMLElement>('[data-test="test-product"]')?.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "bread" } }),
  );
  await settle(el);
  expect(q(el, '[data-test="test-answer"]')?.textContent).toContain("Watched by: Pass");
  window.history.replaceState(null, "", "/manage?dashboard=prep-stations");
});

it("creates, edits and confirms removal of a watcher", async () => {
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
  };
  const a = api({
    load: vi.fn().mockResolvedValue({ ...view, watchers: [pass] }),
    createWatcher: vi.fn(),
    updateWatcher: vi.fn(),
    removeWatcher: vi.fn(),
  });
  const el = await mount(a);
  q(el, '[data-test="new-watcher"]')!.click();
  await settle(el);
  expect(q(el, '[data-test="watcher-modal"]')).not.toBeNull();
  q(el, '[data-test="watcher-modal"] watcher-form')!.dispatchEvent(
    new CustomEvent("watcher-save", {
      detail: {
        input: {
          name: "Runner",
          everyStation: true,
          stationIds: [],
          everyZone: true,
          zoneIds: [],
          runsPass: false,
        },
      },
    }),
  );
  await settle(el);
  expect(a.createWatcher).toHaveBeenCalled();
  q(el, '[data-test="edit-watcher-pass"]')!.click();
  await settle(el);
  q(el, '[data-test="watcher-modal"] watcher-form')!.dispatchEvent(
    new CustomEvent("watcher-save", {
      detail: {
        input: {
          name: "Pass",
          everyStation: true,
          stationIds: [],
          everyZone: true,
          zoneIds: [],
          runsPass: true,
        },
      },
    }),
  );
  await settle(el);
  expect(a.updateWatcher).toHaveBeenCalledWith("pass", expect.any(Object));
  q(el, '[data-test="remove-watcher-pass"]')!.click();
  await settle(el);
  expect(q(el, '[data-test="remove-watcher-modal"]')?.textContent).toContain("Disable Pass?");
  q(el, '[data-test="confirm-remove-watcher"]')!.click();
  await settle(el);
  expect(a.removeWatcher).toHaveBeenCalledWith("pass");
});

it("names no watcher for a routed dish and says nothing for no preparation", async () => {
  setLocale("en");
  const a = api({
    explain: vi
      .fn()
      .mockResolvedValueOnce({
        route: { kind: "station", stationId: "bar" },
        decidedBy: { kind: "default" },
        fallbacks: [],
        noReplacement: false,
        stations: [],
      })
      .mockResolvedValueOnce({
        route: { kind: "no_preparation" },
        decidedBy: { kind: "claim", categoryId: "cocktails" },
        fallbacks: [],
        noReplacement: false,
        stations: [],
      }),
  });
  const el = await mount(a);
  const select = q(el, '[data-test="test-product"]')!;
  select.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "bread" } }));
  await settle(el);
  expect(q(el, '[data-test="test-answer"]')?.textContent).toContain("No watcher follows it.");
  select.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "bread" } }));
  await settle(el);
  expect(q(el, '[data-test="test-answer"]')?.textContent).not.toContain("watcher follows");
  window.history.replaceState(null, "", "/manage?dashboard=prep-stations");
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
const q = (el: PrepStationsScreen, s: string) => el.shadowRoot!.querySelector<HTMLElement>(s);
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
  expect(q(el, '[data-test="station-upstairs"]')?.textContent).toContain(expected);
  expect(q(el, '[data-test="station-bar"]')?.textContent).toContain(
    "Always open: this is the default station",
  );
  expect(q(el, '[data-test="edit-hours-bar"]')).toBeNull();
  expect(q(el, '[data-test="close-today-bar"]')).toBeNull();
});

it.each([
  ["management.request_invalid", { field: "showsRestOfOrder" }, true],
  ["station.not_found", {}, false],
] as const)(
  "shows a %s refusal without changing the station switch",
  async (code, params, fieldError) => {
    const a = api({ updateStation: vi.fn().mockRejectedValue({ code, params }) });
    const el = await mount(a);
    const card = q(el, '[data-test="station-bar"]')!;
    const toggle = card.querySelector<HTMLElement>('wt-switch[name="showsRestOfOrder"]')!;
    toggle.dispatchEvent(new CustomEvent("wt-change", { detail: { checked: true } }));
    await settle(el);
    expect(a.updateStation).toHaveBeenCalledWith("bar", { showsRestOfOrder: true });
    expect(card.querySelector('wt-switch[name="showsRestOfOrder"]')!.hasAttribute("checked")).toBe(
      false,
    );
    const error = card.querySelector<HTMLElement>('[role="alert"]')!;
    expect(error.textContent).toContain("could not be saved");
    expect(error.hasAttribute("data-field-error")).toBe(fieldError);
  },
);

it("confirms a by-hand closure and clears it back to the schedule", async () => {
  setLocale("en");
  const a = api({
    load: vi.fn().mockResolvedValue(withUpstairs({ open: true, why: "in_hours" })),
    setStationToday: vi.fn(),
  });
  const el = await mount(a);
  q(el, '[data-test="close-today-upstairs"]')!.click();
  await settle(el);
  expect(q(el, '[data-test="station-action-modal"]')?.textContent).toContain(
    "Upstairs bar's work goes to Bar until 06:00 tomorrow.",
  );
  expect(a.setStationToday).not.toHaveBeenCalled();
  q(el, '[data-test="confirm-station-action"]')!.click();
  await settle(el);
  expect(a.setStationToday).toHaveBeenCalledWith("upstairs", "closed");
});

it("shows no replacement in the confirmation when a closed station has no fallback", async () => {
  setLocale("en");
  const next = withUpstairs(
    { open: true, why: "in_hours" },
    { fallbackStationId: null, closedSendsTo: null },
  );
  next.routing.todayEnds = { timeOfDay: "06:00", tomorrow: false };
  const el = await mount(api({ load: vi.fn().mockResolvedValue(next) }));
  q(el, '[data-test="close-today-upstairs"]')!.click();
  await settle(el);
  expect(q(el, '[data-test="station-action-modal"]')?.textContent).toContain(
    "the till will ask where to send its dishes, until 06:00 today.",
  );
});
it("explains exceptions, claims, defaults and an unroutable product", async () => {
  setLocale("en");
  const a = api({
    load: vi.fn().mockResolvedValue({
      ...view,
      routing: {
        ...view.routing,
        exceptions: [
          {
            id: "ex",
            position: 0,
            zoneId: null,
            categoryId: "cocktails",
            productId: null,
            target: { kind: "station", stationId: "bar" },
            neverMatches: false,
            stationOff: false,
          },
        ],
      },
    }),
    explain: vi
      .fn()
      .mockResolvedValueOnce({
        route: { kind: "station", stationId: "bar" },
        decidedBy: { kind: "exception", exceptionId: "ex" },
        fallbacks: [],
        noReplacement: false,
        stations: [{ id: "bar", name: "Bar", active: true }],
      })
      .mockResolvedValueOnce({
        route: { kind: "station", stationId: "bar" },
        decidedBy: { kind: "claim", categoryId: "cocktails" },
        fallbacks: [],
        noReplacement: false,
        stations: [{ id: "bar", name: "Bar", active: true }],
      })
      .mockResolvedValueOnce({
        route: { kind: "station", stationId: "bar" },
        decidedBy: { kind: "default" },
        fallbacks: [],
        noReplacement: false,
        stations: [{ id: "bar", name: "Bar", active: true }],
      })
      .mockResolvedValueOnce({
        route: null,
        decidedBy: null,
        fallbacks: [],
        noReplacement: false,
        stations: [],
      }),
  });
  const el = await mount(a);
  const select = q(el, '[data-test="test-product"]')!;
  for (const expected of [
    "Because: the exception 'Cocktails → Bar'",
    "Because: Bar claims Cocktails",
    "Because: nothing else matched, so the default station takes it",
    "Nothing can make this: no rule matched and no default station is active.",
  ]) {
    select.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "bread" } }));
    await settle(el);
    expect(q(el, '[data-test="test-answer"]')!.textContent).toContain(expected);
  }
});

it.each(["en", "es"])(
  "shows every extra outcome and rechecks removable picks in %s",
  async (locale) => {
    setLocale(locale);
    const names = ["Chips", "Cheese", "Sauce", "Olives", "Pickles"];
    const products = names.map((name) => ({ id: name.toLowerCase(), name }));
    const a = api({
      load: vi.fn().mockResolvedValue({
        ...view,
        testProducts: [...view.testProducts, ...products],
        categories: [...view.categories, { id: "sides", name: "Sides", parentId: "food" }],
        routing: {
          ...view.routing,
          stations: [
            ...view.routing.stations,
            { id: "fryer", name: "Fryer", active: true },
            { id: "closed", name: "Closed", active: true },
          ],
        },
      }),
      explain: vi.fn().mockResolvedValue({
        route: { kind: "station", stationId: "bar" },
        decidedBy: { kind: "default" },
        fallbacks: [],
        noReplacement: false,
        clockReadable: true,
        stations: [
          { id: "bar", name: "Bar", active: true },
          { id: "fryer", name: "Fryer", active: true },
          { id: "closed", name: "Closed", active: true },
        ],
        extrasWaitOnDish: false,
        extras: [
          {
            productId: "chips",
            outcome: { kind: "made", stationId: "fryer" },
            decidedBy: { kind: "claim", categoryId: "sides" },
            fallbacks: [{ stationId: "closed", why: "closed_by_hand" }],
          },
          {
            productId: "cheese",
            outcome: { kind: "follows_dish", why: "no_rule" },
            decidedBy: null,
            fallbacks: [],
          },
          {
            productId: "sauce",
            outcome: { kind: "follows_dish", why: "no_preparation" },
            decidedBy: null,
            fallbacks: [],
          },
          {
            productId: "olives",
            outcome: { kind: "follows_dish", why: "no_replacement" },
            decidedBy: { kind: "claim", categoryId: "sides" },
            fallbacks: [{ stationId: "closed", why: "closed_by_hand" }],
          },
          {
            productId: "pickles",
            outcome: { kind: "follows_dish", why: "same_station" },
            decidedBy: null,
            fallbacks: [],
          },
        ],
      }),
    });
    const el = await mount(a);
    q(el, '[data-test="test-product"]')!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "bread" } }),
    );
    await settle(el);
    for (const id of products.map((p) => p.id)) {
      q(el, '[data-test="test-extra"]')!.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: id } }),
      );
      await settle(el);
    }
    expect(a.explain).toHaveBeenLastCalledWith(
      "bread",
      null,
      undefined,
      products.map((p) => p.id),
    );
    const answer = q(el, '[data-test="test-answer"]')!.textContent!;
    for (const name of names) expect(answer).toContain(`${name}:`);
    expect(answer).toContain(
      locale === "en"
        ? "Closed claims Food › Sides"
        : "Closed tiene asignada la categoría Food › Sides",
    );
    expect(answer).toContain(locale === "en" ? "follows the dish" : "sigue al plato");
    expect(answer).toContain(
      locale === "en" ? "Closed is closed by hand" : "Closed se ha cerrado a mano",
    );
    for (const sentence of locale === "en"
      ? [
          "Cheese: follows the dish — no exception or claim covers it",
          "Sauce: follows the dish — what covers it needs no preparation, so it stays on the dish's ticket",
          "Olives: follows the dish — Closed is closed and nothing can replace it",
          "Pickles: follows the dish — it is made at Bar, where the dish is",
        ]
      : [
          "Cheese: sigue al plato — ninguna excepción ni asignación lo cubre",
          "Sauce: sigue al plato — lo que lo cubre no necesita preparación",
          "Olives: sigue al plato — Closed está cerrada y nada puede sustituirla",
          "Pickles: sigue al plato — se prepara en Bar, donde se prepara el plato",
        ])
      expect(answer).toContain(sentence);
    q(el, '[data-test="remove-extra-chips"]')!.click();
    await settle(el);
    expect(a.explain).toHaveBeenLastCalledWith("bread", null, undefined, [
      "cheese",
      "sauce",
      "olives",
      "pickles",
    ]);
  },
);

it.each(["en", "es"])(
  "waits for the dish before describing picked extras in %s",
  async (locale) => {
    setLocale(locale);
    const a = api({
      explain: vi.fn().mockResolvedValue({
        route: null,
        decidedBy: null,
        fallbacks: [],
        noReplacement: false,
        clockReadable: true,
        stations: [],
        extras: [],
        extrasWaitOnDish: true,
      }),
    });
    const el = await mount(a);
    q(el, '[data-test="test-product"]')!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "bread" } }),
    );
    q(el, '[data-test="test-extra"]')!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "bread" } }),
    );
    await settle(el);
    expect(q(el, '[data-test="test-answer"]')!.textContent).toContain(
      locale === "en"
        ? "Extras: decided once the dish has a station to go to"
        : "Extras: se deciden cuando el plato tenga una estación de destino",
    );
  },
);

it.each(["en", "es"])("names the exception that sends an extra elsewhere in %s", async (locale) => {
  setLocale(locale);
  const a = api({
    load: vi.fn().mockResolvedValue({
      ...view,
      products: [...view.products, { id: "chips", name: "Chips" }],
      testProducts: [...view.testProducts, { id: "chips", name: "Chips" }],
      routing: {
        ...view.routing,
        exceptions: [
          {
            id: "extra-rule",
            position: 0,
            zoneId: null,
            categoryId: null,
            productId: "chips",
            target: { kind: "station", stationId: "bar" },
            neverMatches: false,
            stationOff: false,
          },
        ],
      },
    }),
    explain: vi.fn().mockResolvedValue({
      route: { kind: "no_preparation" },
      decidedBy: null,
      fallbacks: [],
      noReplacement: false,
      clockReadable: true,
      stations: [{ id: "bar", name: "Bar", active: true }],
      extrasWaitOnDish: false,
      extras: [
        {
          productId: "chips",
          outcome: { kind: "made", stationId: "bar" },
          decidedBy: { kind: "exception", exceptionId: "extra-rule" },
          fallbacks: [],
        },
      ],
    }),
  });
  const el = await mount(a);
  q(el, '[data-test="test-product"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "bread" } }),
  );
  q(el, '[data-test="test-extra"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "chips" } }),
  );
  await settle(el);
  expect(q(el, '[data-test="test-answer"]')!.textContent).toContain(
    locale === "en"
      ? "Chips: made at Bar, because of the exception 'Chips → Bar'"
      : "Chips: se prepara en Bar, porque lo indica la excepción «Chips → Bar»",
  );
});

it("opens a product tester link with its product selected", async () => {
  setLocale("en");
  const before = location.href;
  history.replaceState(null, "", "/manage/prep-stations/test/lager");
  try {
    const el = await mount(
      api({
        load: vi
          .fn()
          .mockResolvedValue({ ...view, testProducts: [{ id: "lager", name: "Lager" }] }),
      }),
    );
    expect((q(el, '[data-test="test-product"]') as HTMLElement & { value: string }).value).toBe(
      "lager",
    );
    expect(q(el, '[data-test="test-answer"]')!.textContent).toContain("Nothing can make this");
  } finally {
    history.replaceState(null, "", before);
  }
});

it("keeps inactive product names in retained exceptions without offering variants as exception subjects", async () => {
  setLocale("en");
  const named: PrepStationsView = {
    ...view,
    products: [
      { id: "lager", name: "Lager" },
      { id: "retired", name: "Retired lager" },
    ],
    testProducts: [
      { id: "lager", name: "Lager" },
      { id: "large", name: "Lager · Large" },
    ],
    routing: {
      ...view.routing,
      exceptions: [
        {
          id: "retained",
          position: 0,
          zoneId: null,
          categoryId: null,
          productId: "retired",
          target: { kind: "no_preparation" },
          stationOff: false,
          neverMatches: false,
        },
      ],
    },
  };
  const el = await mount(api({ load: vi.fn().mockResolvedValue(named) }));
  expect(q(el, '[data-test="exceptions"]')!.textContent).toContain(
    "Retired lager → No preparation",
  );
  q(el, '[data-test="add-exception"]')!.click();
  await settle(el);
  const options = (
    q(el, '[data-test="exception-what"]') as HTMLElement & { options: { value: string }[] }
  ).options.map((option) => option.value);
  expect(options).toContain("product:retired");
  expect(options).not.toContain("product:large");
  expect(
    (
      q(el, '[data-test="test-product"]') as HTMLElement & { options: { value: string }[] }
    ).options.map((option) => option.value),
  ).toContain("large");
});

it("clears a completed tester answer when Back removes the product", async () => {
  const before = location.href;
  history.replaceState(null, "", "/manage/prep-stations/test/lager");
  try {
    const el = await mount(
      api({
        explain: vi.fn().mockResolvedValue({
          route: { kind: "station", stationId: "bar" },
          decidedBy: { kind: "default" },
          fallbacks: [],
          noReplacement: false,
          stations: [{ id: "bar", name: "Bar", active: true }],
        }),
      }),
    );
    expect(q(el, '[data-test="test-answer"]')!.textContent).toContain("Made at: Bar");
    history.replaceState(null, "", "/manage/prep-stations");
    dispatchEvent(new PopStateEvent("popstate"));
    await settle(el);
    expect((q(el, '[data-test="test-product"]') as HTMLElement & { value: string }).value).toBe("");
    expect(q(el, '[data-test="test-answer"]')!.textContent).not.toContain("Made at: Bar");
  } finally {
    history.replaceState(null, "", before);
  }
});

it("ignores a pending tester answer after Back removes the product", async () => {
  const before = location.href;
  history.replaceState(null, "", "/manage/prep-stations/test/lager");
  let complete!: (value: {
    route: { kind: "station"; stationId: string };
    decidedBy: { kind: "default" };
    fallbacks: [];
    noReplacement: false;
    stations: { id: string; name: string; active: boolean }[];
  }) => void;
  const pending = new Promise<Parameters<typeof complete>[0]>((resolve) => {
    complete = resolve;
  });
  try {
    const el = await mount(api({ explain: vi.fn().mockReturnValue(pending) }));
    history.replaceState(null, "", "/manage/prep-stations");
    dispatchEvent(new PopStateEvent("popstate"));
    await settle(el);
    complete({
      route: { kind: "station", stationId: "bar" },
      decidedBy: { kind: "default" },
      fallbacks: [],
      noReplacement: false,
      stations: [{ id: "bar", name: "Bar", active: true }],
    });
    await settle(el);
    expect(q(el, '[data-test="test-answer"]')!.textContent).not.toContain("Made at: Bar");
  } finally {
    history.replaceState(null, "", before);
  }
});

it("explains a no-preparation claim as an assignment", async () => {
  setLocale("en");
  const el = await mount(
    api({
      load: vi.fn().mockResolvedValue({
        ...view,
        routing: {
          ...view.routing,
          claims: [
            { categoryId: "cocktails", target: { kind: "no_preparation" }, stationOff: false },
          ],
        },
      }),
      explain: vi.fn().mockResolvedValue({
        route: { kind: "no_preparation" },
        decidedBy: { kind: "claim", categoryId: "cocktails" },
        fallbacks: [],
        noReplacement: false,
        stations: [],
      }),
    }),
  );
  q(el, '[data-test="test-product"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "bread" } }),
  );
  await settle(el);
  expect(q(el, '[data-test="test-answer"]')!.textContent).toContain(
    "Cocktails is assigned to No preparation",
  );
});
it("shows station claims by full folder path and unassigned work with default destination", async () => {
  const el = await mount(api());
  expect(q(el, '[data-test="station-bar"]')!.textContent).toContain("Drinks › Cocktails");
  expect(q(el, '[data-test="unassigned"]')!.textContent).toContain("Food");
  expect(q(el, '[data-test="unassigned"]')!.textContent).toContain("Bread");
  expect(q(el, '[data-test="unassigned"]')!.textContent).toContain("Bar");
});
it("previews an assignment and saves only after confirmation", async () => {
  const a = api({
    preview: vi.fn().mockResolvedValue([
      {
        productId: "bread",
        productName: "Bread",
        zoneId: null,
        zoneName: null,
        from: { kind: "station", stationId: "bar" },
        to: { kind: "no_preparation" },
      },
    ]),
  });
  const el = await mount(a);
  q(el, '[data-test="assign-bread"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "no_preparation" } }),
  );
  await settle(el);
  expect(a.preview).toHaveBeenCalledWith({
    kind: "assignment",
    productId: "bread",
    target: { kind: "no_preparation" },
  });
  expect(q(el, '[data-test="routing-preview"]')?.textContent).toContain("Bread");
  expect(a.assignProduct).not.toHaveBeenCalled();
  q(el, '[data-test="confirm-routing"]')!.click();
  await settle(el);
  expect(a.assignProduct).toHaveBeenCalledWith("bread", { kind: "no_preparation" });
});
it("cancels a claim preview without saving", async () => {
  const a = api();
  const el = await mount(a);
  q(el, '[data-test="remove-cocktails"]')!.click();
  await settle(el);
  expect(a.removeClaim).not.toHaveBeenCalled();
  q(el, '[data-test="cancel-routing"]')!.click();
  await settle(el);
  expect(a.removeClaim).not.toHaveBeenCalled();
  expect(q(el, '[data-test="remove-cocktails"]')).not.toBeNull();
});
it("clears a cancelled unfiled product choice", async () => {
  const a = api();
  const el = await mount(a);
  q(el, '[data-test="assign-bread"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "bar" } }),
  );
  await settle(el);
  q(el, '[data-test="cancel-routing"]')!.click();
  await settle(el);
  expect((q(el, '[data-test="assign-bread"]') as HTMLElement & { value: string }).value).toBe("");
  expect(a.assignProduct).not.toHaveBeenCalled();
});
it("assigns an unassigned folder and removes a claim", async () => {
  const a = api();
  const el = await mount(a);
  q(el, '[data-test="assign-food"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "bar" } }),
  );
  await settle(el);
  expect(a.setClaim).not.toHaveBeenCalled();
  q(el, '[data-test="confirm-routing"]')!.click();
  await settle(el);
  expect(a.setClaim).toHaveBeenCalledWith("food", { kind: "station", stationId: "bar" });
  q(el, '[data-test="remove-cocktails"]')!.click();
  await settle(el);
  expect(a.removeClaim).not.toHaveBeenCalled();
  q(el, '[data-test="confirm-routing"]')!.click();
  await settle(el);
  expect(a.removeClaim).toHaveBeenCalledWith("cocktails");
});
it("moves station actions into this screen and rejects unordered thresholds beside overdue", async () => {
  const a = api();
  const el = await mount(a);
  q(el, '[data-test="default-bar"]')?.click();
  q(el, '[data-test="edit-bar"]')!.click();
  await settle(el);
  q(el, '[data-test="overdue"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "5" } }),
  );
  q(el, '[data-test="save-station"]')!.click();
  await settle(el);
  expect(q(el, '[data-field-error="overdueAfterMinutes"]')).not.toBeNull();
  expect(a.updateStation).not.toHaveBeenCalled();
  q(el, '[data-test="switch-off-bar"]')!.click();
  await settle(el);
  q(el, '[data-test="confirm-station-action"]')!.click();
  await settle(el);
  expect(a.deactivateStation).toHaveBeenCalledWith("bar");
});

it("assigns an unassigned product through its effective route", async () => {
  const a = api();
  const el = await mount(a);
  q(el, '[data-test="assign-bread"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "bar" } }),
  );
  await settle(el);
  expect(a.assignProduct).not.toHaveBeenCalled();
  q(el, '[data-test="confirm-routing"]')!.click();
  await settle(el);
  expect(a.assignProduct).toHaveBeenCalledWith("bread", {
    kind: "station",
    stationId: "bar",
  });
});
it("shows linked printers and kitchen screens read-only", async () => {
  const a = api({
    load: vi.fn().mockResolvedValue({
      ...view,
      printers: [{ id: "p1", name: "Bar printer" }],
      stationPrinters: [{ stationId: "bar", printerId: "p1" }],
      devices: [
        { id: "d1", label: "Bar display", stationId: "bar", kind: "kds_station", active: true },
      ],
    }),
  });
  const el = await mount(a);
  const card = q(el, '[data-test="station-bar"]')!;
  expect(card.textContent).toContain("Bar printer");
  expect(card.textContent).toContain("Bar display");
  expect(card.querySelector('a[href="/manage/printing-rules"]')).not.toBeNull();
  expect(card.querySelector('a[href="/manage/devices"]')).not.toBeNull();
});
it("puts an inactive-station refusal beside the claim choice", async () => {
  const a = api({ preview: vi.fn().mockRejectedValue({ code: "route.station_inactive" }) });
  const el = await mount(a);
  q(el, '[data-test="claim-bar"]')!.click();
  await settle(el);
  q(el, '[data-test="claim-choice"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "food" } }),
  );
  await settle(el);
  expect(q(el, '[data-field-error="claim"]')).not.toBeNull();
});
it("keeps No preparation available and names claims on disabled stations", async () => {
  const changed = {
    ...view,
    routing: {
      ...view.routing,
      claims: [
        ...view.routing.claims,
        {
          categoryId: "food",
          target: { kind: "station" as const, stationId: "old" },
          stationOff: true,
        },
      ],
      stations: [...view.routing.stations, { id: "old", name: "Old pass", active: false }],
    },
  };
  const el = await mount(api({ load: vi.fn().mockResolvedValue(changed) }));
  expect(q(el, '[data-test="no-preparation"]')).not.toBeNull();
  expect(q(el, '[data-test="station-old"]')).toBeNull();
  expect(el.shadowRoot!.textContent).toContain("Old pass");
  expect(el.shadowRoot!.textContent).toContain("Disabled: no replacement, the till asks");
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
  q(el, '[data-test="default-terrace"]')!.click();
  await settle(el);
  expect(a.setDefaultStation).toHaveBeenCalledWith("terrace");
});
it("offers claimed folders by path and names their current station", async () => {
  const el = await mount(api());
  q(el, '[data-test="claim-bar"]')!.click();
  await settle(el);
  const choice = q(el, '[data-test="claim-choice"]') as HTMLElement & {
    options: { label: string }[];
  };
  expect(choice.options.map((o) => o.label)).toContain("Drinks › Cocktails (Bar)");
});
it("puts an inactive-station refusal beside an unassigned product choice", async () => {
  const a = api({ preview: vi.fn().mockRejectedValue({ code: "route.station_inactive" }) });
  const el = await mount(a);
  q(el, '[data-test="assign-bread"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "bar" } }),
  );
  await settle(el);
  expect(q(el, '[data-field-error="bread"]')).not.toBeNull();
});
it("saves station name, order and all three thresholds together", async () => {
  const a = api();
  const el = await mount(a);
  q(el, '[data-test="edit-bar"]')!.click();
  await settle(el);
  q(el, '[data-test="name"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "Terrace bar" } }),
  );
  q(el, '[data-test="displayOrder"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "3" } }),
  );
  q(el, '[data-test="save-station"]')!.click();
  await settle(el);
  expect(a.updateStation).toHaveBeenCalledWith("bar", {
    name: "Terrace bar",
    displayOrder: 3,
    warmAfterMinutes: 5,
    overdueAfterMinutes: 10,
    forgottenAfterMinutes: 15,
  });
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
  q(el, '[data-test="save-station"]')!.click();
  await settle(el);
  expect(a.createStation).not.toHaveBeenCalled();
  expect(q(el, '[data-field-error="name"]')).not.toBeNull();
});
it("reports rejected station actions without exposing a code", async () => {
  const a = api({ deactivateStation: vi.fn().mockRejectedValue({ code: "station.not_found" }) });
  const el = await mount(a);
  q(el, '[data-test="switch-off-bar"]')!.click();
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
it("saves a station when Enter is pressed in its order field", async () => {
  const a = api();
  const el = await mount(a);
  q(el, '[data-test="edit-bar"]')!.click();
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
  expect(a.updateStation).toHaveBeenCalledWith("bar", {
    name: "Bar",
    displayOrder: 1,
    warmAfterMinutes: 5,
    overdueAfterMinutes: 10,
    forgottenAfterMinutes: 15,
  });
});
it("does not save a nonnumeric threshold", async () => {
  const a = api();
  const el = await mount(a);
  q(el, '[data-test="edit-bar"]')!.click();
  await settle(el);
  q(el, '[data-test="overdue"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "soon" } }),
  );
  q(el, '[data-test="save-station"]')!.click();
  await settle(el);
  expect(a.updateStation).not.toHaveBeenCalled();
  expect(q(el, '[data-field-error="overdueAfterMinutes"]')).not.toBeNull();
});
it("does not save an edited station removed by live refresh", async () => {
  const liveData = new LiveData();
  const load = vi
    .fn()
    .mockResolvedValueOnce(view)
    .mockResolvedValue({ ...view, stations: [] });
  const a = api({ liveData, load });
  const el = await mount(a);
  q(el, '[data-test="edit-bar"]')!.click();
  await settle(el);
  const staleSave = q(el, '[data-test="save-station"]')!;
  liveData.invalidate([{ type: "kitchen_stations", id: "bar" }]);
  await vi.waitFor(() => expect(q(el, '[data-test="station-bar"]')).toBeNull());
  staleSave.click();
  await settle(el);
  expect(a.updateStation).not.toHaveBeenCalled();
});
it("guards repeated Enter saves while a station write is pending and allows retry", async () => {
  let reject!: (error: unknown) => void;
  const pending = new Promise((_, fail) => {
    reject = fail;
  });
  const updateStation = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(undefined);
  const a = api({ updateStation });
  const el = await mount(a);
  q(el, '[data-test="edit-bar"]')!.click();
  await settle(el);
  const input = q(el, '[data-test="displayOrder"]')!.shadowRoot!.querySelector("input")!;
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
  q(el, '[data-test="save-station"]')!.click();
  expect(updateStation).toHaveBeenCalledTimes(1);
  reject({ code: "management.request_invalid" });
  await settle(el);
  enter();
  await settle(el);
  expect(updateStation).toHaveBeenCalledTimes(2);
});

const exceptionView: PrepStationsView = {
  ...view,
  zones: [{ id: "terrace", name: "Terrace" }],
  routing: {
    ...view.routing,
    stations: [...view.routing.stations, { id: "old", name: "Old bar", active: false }],
    exceptions: [
      {
        id: "b",
        position: 20,
        zoneId: "terrace",
        categoryId: "cocktails",
        productId: null,
        target: { kind: "station", stationId: "old" },
        neverMatches: true,
        stationOff: true,
      },
      {
        id: "a",
        position: 10,
        zoneId: null,
        categoryId: null,
        productId: "bread",
        target: { kind: "no_preparation" },
        neverMatches: false,
        stationOff: false,
      },
    ],
  },
};
it("lists exceptions by position as sentences and identifies both warnings", async () => {
  const el = await mount(api({ load: vi.fn().mockResolvedValue(exceptionView) }));
  const rows = [...el.shadowRoot!.querySelectorAll('[data-test="exceptions"] tbody tr')];
  expect(rows.map((row) => row.getAttribute("data-id"))).toEqual(["a", "b"]);
  expect(rows[0]!.textContent).toContain("Bread → No preparation");
  expect(rows[1]!.textContent).toContain("Cocktails from Terrace → Old bar");
  expect(rows[1]!.textContent).toContain("Never used: an exception above always catches it first");
  expect(rows[1]!.textContent).toContain("Its station is disabled");
});
it.each([
  [1280, "light"],
  [1280, "dark"],
  [390, "light"],
  [390, "dark"],
] as const)(
  "puts an exception's grip and row menu on the first line of a wrapping rule at %ipx (%s)",
  async (frame, theme) => {
    const width = window.innerWidth,
      height = window.innerHeight;
    await page.viewport(frame, 844);
    try {
      // Long enough to wrap even across a desktop-wide table.
      const long = "Bread baked in the wood oven every morning and sliced at the pass, ".repeat(6);
      const el = await mount(
        api({
          load: vi.fn().mockResolvedValue({
            ...exceptionView,
            products: [{ id: "bread", name: long }],
          }),
        }),
        theme,
      );
      expect(el.parentElement!.getAttribute("data-theme")).toBe(theme);
      const row = q(el, '[data-test="exceptions"] tr[data-id="a"]')!;
      const rule = row.children[1]!;
      const handle = q(el, '[data-test="drag-a"]')!;

      expect(window.innerWidth).toBe(frame);
      expect(rule.textContent).toContain(long.trim());
      expect(row.getBoundingClientRect().height).toBeGreaterThan(
        handle.getBoundingClientRect().height * 1.5,
      );
      expect(textLines(rule).length, "the rule wraps").toBeGreaterThan(1);
      const line = textLines(rule)[0]!;
      const within = middleWithin(line);
      const icon = (handle.querySelector("wt-icon") ?? handle).getBoundingClientRect();
      const menu = row.querySelector("wt-row-actions")!.getBoundingClientRect();
      expect(
        { icon: within(icon), menu: within(menu) },
        JSON.stringify({ line, icon, menu }),
      ).toEqual({ icon: true, menu: true });
    } finally {
      await page.viewport(width, height);
    }
  },
);
it("sorts equal-position exceptions by id and restores that order after cancellation", async () => {
  const tied = {
    ...exceptionView,
    routing: {
      ...exceptionView.routing,
      exceptions: exceptionView.routing.exceptions.map((row) => ({ ...row, position: 10 })),
    },
  };
  const a = api({ load: vi.fn().mockResolvedValue(tied), reorderExceptions: vi.fn() });
  const el = await mount(a);
  const ids = () =>
    [...el.shadowRoot!.querySelectorAll('[data-test="exceptions"] tbody tr')].map((row) =>
      row.getAttribute("data-id"),
    );
  expect(ids()).toEqual(["a", "b"]);
  q(el, '[data-test="drag-b"]')!.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }),
  );
  await settle(el);
  expect(ids()).toEqual(["b", "a"]);
  q(el, '[data-test="cancel-routing"]')!.click();
  await settle(el);
  expect(ids()).toEqual(["a", "b"]);
  expect(a.reorderExceptions).not.toHaveBeenCalled();
});
it("moves the second exception up by keyboard and sends the complete new order", async () => {
  const a = api({
    load: vi.fn().mockResolvedValue(exceptionView),
    reorderExceptions: vi.fn().mockResolvedValue(undefined),
  });
  const el = await mount(a);
  q(el, '[data-test="drag-b"]')!.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }),
  );
  await settle(el);
  expect(a.reorderExceptions).not.toHaveBeenCalled();
  q(el, '[data-test="confirm-routing"]')!.click();
  await settle(el);
  expect(a.reorderExceptions).toHaveBeenCalledWith(["b", "a"]);
});
it("refuses an exception without a subject or zone beside What", async () => {
  const a = api();
  const el = await mount(a);
  q(el, '[data-test="add-exception"]')!.click();
  await settle(el);
  q(el, '[data-test="exception-target"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "bar" } }),
  );
  q(el, '[data-test="save-exception"]')!.click();
  await settle(el);
  expect(q(el, '[data-field-error="condition"]')?.textContent).toContain(
    "Choose a category or product, a service zone, or both",
  );
  expect(a.createException).not.toHaveBeenCalled();
});
it("confirms deletion before calling the exception endpoint", async () => {
  const a = api({
    load: vi.fn().mockResolvedValue(exceptionView),
    deleteException: vi.fn().mockResolvedValue(undefined),
  });
  const el = await mount(a);
  q(el, '[data-test="delete-a"]')!.click();
  await settle(el);
  expect(a.deleteException).not.toHaveBeenCalled();
  q(el, '[data-test="confirm-delete-exception"]')!.click();
  await settle(el);
  expect(a.deleteException).not.toHaveBeenCalled();
  q(el, '[data-test="confirm-routing"]')!.click();
  await settle(el);
  expect(a.deleteException).toHaveBeenCalledWith("a");
});
it("drags the second exception above the first and saves the complete order on release", async () => {
  const a = api({
    load: vi.fn().mockResolvedValue(exceptionView),
    reorderExceptions: vi.fn().mockResolvedValue(undefined),
  });
  const el = await mount(a);
  const handle = q(el, '[data-test="drag-b"]')!;
  const first = q(el, '[data-id="a"]')!.getBoundingClientRect();
  handle.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 9, bubbles: true }));
  document.dispatchEvent(
    new PointerEvent("pointermove", { pointerId: 9, clientY: first.top + first.height / 2 }),
  );
  document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 9 }));
  await settle(el);
  expect(a.reorderExceptions).not.toHaveBeenCalled();
  q(el, '[data-test="confirm-routing"]')!.click();
  await settle(el);
  expect(a.reorderExceptions).toHaveBeenCalledWith(["b", "a"]);
});
it("restores the saved order when a dragged reorder preview is cancelled", async () => {
  const a = api({ load: vi.fn().mockResolvedValue(exceptionView), reorderExceptions: vi.fn() });
  const el = await mount(a);
  const handle = q(el, '[data-test="drag-b"]')!;
  const first = q(el, '[data-id="a"]')!.getBoundingClientRect();
  handle.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 10, bubbles: true }));
  document.dispatchEvent(
    new PointerEvent("pointermove", { pointerId: 10, clientY: first.top + first.height / 2 }),
  );
  document.dispatchEvent(new PointerEvent("pointerup", { pointerId: 10 }));
  await settle(el);
  expect(a.preview).toHaveBeenCalledWith({ kind: "exception_order", ids: ["b", "a"] });
  expect(
    [...el.shadowRoot!.querySelectorAll('[data-test="exceptions"] tbody tr')].map((row) =>
      row.getAttribute("data-id"),
    ),
  ).toEqual(["b", "a"]);
  q(el, '[data-test="cancel-routing"]')!.click();
  await settle(el);
  expect(
    [...el.shadowRoot!.querySelectorAll('[data-test="exceptions"] tbody tr')].map((row) =>
      row.getAttribute("data-id"),
    ),
  ).toEqual(["a", "b"]);
  expect(a.reorderExceptions).not.toHaveBeenCalled();
});
it("writes a chosen folder and zone to the selected station", async () => {
  const a = api({
    load: vi.fn().mockResolvedValue(exceptionView),
    createException: vi.fn().mockResolvedValue(undefined),
  });
  const el = await mount(a);
  q(el, '[data-test="add-exception"]')!.click();
  await settle(el);
  q(el, '[data-test="exception-what"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "category:cocktails" } }),
  );
  q(el, '[data-test="exception-zone"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "terrace" } }),
  );
  q(el, '[data-test="exception-target"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "bar" } }),
  );
  await settle(el);
  q(el, '[data-test="save-exception"]')!.click();
  await settle(el);
  expect(a.createException).not.toHaveBeenCalled();
  q(el, '[data-test="confirm-routing"]')!.click();
  await settle(el);
  expect(a.createException).toHaveBeenCalledWith({
    zoneId: "terrace",
    categoryId: "cocktails",
    productId: null,
    target: { kind: "station", stationId: "bar" },
  });
});
it.each(["create", "update"] as const)(
  "shows an inactive station refusal when an exception %s is rejected after preview",
  async (operation) => {
    setLocale("en");
    const refusal = { code: "route.station_inactive" };
    const a = api({
      load: vi.fn().mockResolvedValue(exceptionView),
      createException: vi.fn().mockRejectedValue(refusal),
      updateException: vi.fn().mockRejectedValue(refusal),
    });
    const el = await mount(a);
    q(
      el,
      operation === "create" ? '[data-test="add-exception"]' : '[data-test="edit-exception-a"]',
    )!.click();
    await settle(el);
    if (operation === "create") {
      q(el, '[data-test="exception-zone"]')!.dispatchEvent(
        new CustomEvent("wt-change", { detail: { value: "terrace" } }),
      );
    }
    q(el, '[data-test="exception-target"]')!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "bar" } }),
    );
    await settle(el);
    q(el, '[data-test="save-exception"]')!.click();
    await settle(el);
    expect(q(el, '[data-test="routing-preview"]')).not.toBeNull();
    q(el, '[data-test="confirm-routing"]')!.click();
    await settle(el);
    expect(q(el, '[data-test="routing-preview"]')).toBeNull();
    expect(q(el, '[role="alert"]')?.textContent).toContain("This station is disabled");
    expect(q(el, '[role="alert"]')?.textContent).not.toContain("could not be saved");
  },
);
it("keeps a dragged reorder pending while its confirmed save is in flight", async () => {
  let finish!: () => void;
  const saving = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const reordered = {
    ...exceptionView,
    routing: {
      ...exceptionView.routing,
      exceptions: exceptionView.routing.exceptions.map((e) => ({
        ...e,
        position: e.id === "b" ? 0 : 1,
      })),
    },
  };
  const a = api({
    load: vi.fn().mockResolvedValueOnce(exceptionView).mockResolvedValue(reordered),
    reorderExceptions: vi.fn().mockReturnValue(saving),
  });
  const el = await mount(a);
  q(el, '[data-test="drag-b"]')!.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }),
  );
  await settle(el);
  q(el, '[data-test="confirm-routing"]')!.click();
  await settle(el);
  q(el, '[data-test="cancel-routing"]')!.click();
  q(el, '[data-test="routing-preview"]')!.dispatchEvent(new CustomEvent("wt-close"));
  await settle(el);
  expect(q(el, '[data-test="routing-preview"]')).not.toBeNull();
  expect(
    [...el.shadowRoot!.querySelectorAll('[data-test="exceptions"] tbody tr')].map((row) =>
      row.getAttribute("data-id"),
    ),
  ).toEqual(["b", "a"]);
  expect(a.reorderExceptions).toHaveBeenCalledWith(["b", "a"]);
  finish();
  await settle(el);
  expect(q(el, '[data-test="routing-preview"]')).toBeNull();
  expect(
    [...el.shadowRoot!.querySelectorAll('[data-test="exceptions"] tbody tr')].map((row) =>
      row.getAttribute("data-id"),
    ),
  ).toEqual(["b", "a"]);
});
it("puts the server's condition refusal beside What", async () => {
  const a = api({
    load: vi.fn().mockResolvedValue(exceptionView),
    createException: vi
      .fn()
      .mockRejectedValue({ code: "management.request_invalid", params: { field: "condition" } }),
  });
  const el = await mount(a);
  q(el, '[data-test="add-exception"]')!.click();
  await settle(el);
  q(el, '[data-test="exception-zone"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "terrace" } }),
  );
  q(el, '[data-test="exception-target"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "bar" } }),
  );
  await settle(el);
  q(el, '[data-test="save-exception"]')!.click();
  await settle(el);
  q(el, '[data-test="confirm-routing"]')!.click();
  await settle(el);
  expect(q(el, '[data-field-error="condition"]')?.textContent).toContain(
    "Choose a category or product",
  );
});
it("shows Everything and Any service zone as the form defaults", async () => {
  setLocale("en");
  const el = await mount(api());
  q(el, '[data-test="add-exception"]')!.click();
  await settle(el);
  expect(
    q(el, '[data-test="exception-what"]')!.shadowRoot!.querySelector(".trigger .value")!
      .textContent,
  ).toContain("Everything");
  expect(
    q(el, '[data-test="exception-zone"]')!.shadowRoot!.querySelector(".trigger .value")!
      .textContent,
  ).toContain("Any service zone");
});
it("restores the server order if reordering is refused", async () => {
  setLocale("en");
  const a = api({
    load: vi.fn().mockResolvedValue(exceptionView),
    preview: vi.fn().mockRejectedValue({ code: "management.request_invalid" }),
  });
  const el = await mount(a);
  q(el, '[data-test="drag-b"]')!.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }),
  );
  await settle(el);
  expect(
    [...el.shadowRoot!.querySelectorAll('[data-test="exceptions"] tbody tr')].map((row) =>
      row.getAttribute("data-id"),
    ),
  ).toEqual(["a", "b"]);
  expect(q(el, '[role="alert"]')?.textContent).toContain("could not be saved");
});
it("edits an existing exception without changing its position", async () => {
  const a = api({
    load: vi.fn().mockResolvedValue(exceptionView),
    updateException: vi.fn().mockResolvedValue(undefined),
    reorderExceptions: vi.fn(),
  });
  const el = await mount(a);
  q(el, '[data-test="edit-exception-a"]')!.click();
  await settle(el);
  q(el, '[data-test="exception-target"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "bar" } }),
  );
  await settle(el);
  q(el, '[data-test="save-exception"]')!.click();
  await settle(el);
  expect(a.updateException).not.toHaveBeenCalled();
  q(el, '[data-test="confirm-routing"]')!.click();
  await settle(el);
  expect(a.updateException).toHaveBeenCalledWith("a", {
    zoneId: null,
    categoryId: null,
    productId: "bread",
    target: { kind: "station", stationId: "bar" },
  });
  expect(a.reorderExceptions).not.toHaveBeenCalled();
});

it("offers only active stations for a new exception and names a switched-off edit target", async () => {
  const changed: PrepStationsView = {
    ...exceptionView,
    stations: [
      ...view.stations,
      { ...view.stations[0]!, id: "old", name: "Old bar", active: false, isDefault: false },
    ],
  };
  const el = await mount(api({ load: vi.fn().mockResolvedValue(changed) }));
  q(el, '[data-test="add-exception"]')!.click();
  await settle(el);
  const choice = q(el, '[data-test="exception-target"]') as HTMLElement & {
    options: { value: string; label: string }[];
  };
  expect(choice.options.map((o) => o.value)).toEqual(["bar", "no_preparation"]);
  q(el, '[slot="cancel"]')!.click();
  await settle(el);
  const editEl = await mount(api({ load: vi.fn().mockResolvedValue(exceptionView) }));
  q(editEl, '[data-test="edit-exception-b"]')!.click();
  await settle(editEl);
  const edited = q(editEl, '[data-test="exception-target"]') as HTMLElement & {
    options: { value: string; label: string }[];
  };
  expect(edited.options.map((o) => o.value)).toContain("old");
  expect(edited.shadowRoot!.querySelector(".trigger .value")!.textContent).toContain("Old bar");
});

it("shows affected products and their old and new destinations before an assignment is saved", async () => {
  setLocale("en");
  const a = api({
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
    ]),
  });
  const el = await mount(a);
  q(el, '[data-test="assign-bread"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "no_preparation" } }),
  );
  await settle(el);
  const rows = [...el.shadowRoot!.querySelectorAll('[data-test="routing-preview"] tbody tr')];
  expect(rows.map((row) => row.textContent!.replace(/\s+/g, " ").trim())).toEqual([
    "Bread Any service zone No station No preparation",
    "Bread Terrace Bar unknown",
  ]);
  expect(a.assignProduct).not.toHaveBeenCalled();
});

it("shows No replacement for a previewed dead end", async () => {
  setLocale("en");
  const a = api({
    preview: vi.fn().mockResolvedValue([
      {
        productId: "bread",
        productName: "Bread",
        zoneId: null,
        zoneName: null,
        from: { kind: "station", stationId: "bar" },
        to: null,
        toNoReplacement: true,
      },
    ]),
  });
  const el = await mount(a);
  q(el, '[data-test="assign-bread"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "no_preparation" } }),
  );
  await settle(el);
  expect(q(el, '[data-test="routing-preview"]')!.textContent).toContain("No replacement");
});

it("shows a refused preview without opening confirmation or writing an exception", async () => {
  setLocale("en");
  const a = api({
    preview: vi.fn().mockRejectedValue({
      code: "management.request_invalid",
      params: { field: "condition" },
    }),
  });
  const el = await mount(a);
  q(el, '[data-test="add-exception"]')!.click();
  await settle(el);
  q(el, '[data-test="exception-zone"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "terrace" } }),
  );
  q(el, '[data-test="exception-target"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "bar" } }),
  );
  await settle(el);
  q(el, '[data-test="save-exception"]')!.click();
  await settle(el);
  expect(q(el, '[data-field-error="condition"]')?.textContent).toContain(
    "Choose a category or product",
  );
  expect(q(el, '[data-test="routing-preview"]')).toBeNull();
  expect(a.createException).not.toHaveBeenCalled();
});

it("keeps an exception editable after its confirmed write fails", async () => {
  setLocale("en");
  const a = api({
    load: vi.fn().mockResolvedValue(exceptionView),
    updateException: vi.fn().mockRejectedValue(new Error("offline")),
  });
  const el = await mount(a);
  q(el, '[data-test="edit-exception-a"]')!.click();
  await settle(el);
  q(el, '[data-test="save-exception"]')!.click();
  await settle(el);
  q(el, '[data-test="confirm-routing"]')!.click();
  await settle(el);
  expect(q(el, '[data-test="routing-preview"]')).toBeNull();
  expect(q(el, '[data-test="exception-what"]')).not.toBeNull();
  expect(q(el, '[role="alert"]')?.textContent).toContain("could not be saved");
});

it("shows a tester failure without inventing an answer", async () => {
  setLocale("en");
  const a = api({
    explain: vi.fn().mockRejectedValue(new Error("offline")),
  });
  const el = await mount(a);
  const select = q(el, '[data-test="test-product"]')!;
  select.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "bread" } }));
  await settle(el);
  expect(q(el, '[data-test="test-answer"]')!.textContent).not.toContain("Made at: Bar");
  expect(q(el, '[data-test="test-answer"] [role="alert"]')).not.toBeNull();
});

it("previews a claimed folder moving from a station to No preparation", async () => {
  setLocale("en");
  const a = api();
  const el = await mount(a);
  q(el, '[data-test="claim-no-preparation"]')!.click();
  await settle(el);
  q(el, '[data-test="claim-choice"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "cocktails" } }),
  );
  await settle(el);
  expect(q(el, '[data-test="routing-preview"]')!.textContent).toContain("Drinks › Cocktails");
  expect(q(el, '[data-test="routing-preview"]')!.textContent).toContain("Bar");
  expect(q(el, '[data-test="routing-preview"]')!.textContent).toContain("No preparation");
  q(el, '[data-test="confirm-routing"]')!.click();
  await settle(el);
  expect(a.setClaim).toHaveBeenCalledWith("cocktails", { kind: "no_preparation" });
});

it("lets the tester change zones and clear the product without retaining a route", async () => {
  const a = api({
    load: vi.fn().mockResolvedValue({
      ...view,
      zones: [
        { id: "terrace", name: "Terrace", active: true },
        { id: "closed", name: "Closed", active: false },
      ],
    }),
    explain: vi.fn().mockResolvedValue({
      route: { kind: "station", stationId: "bar" },
      decidedBy: { kind: "default" },
      fallbacks: [],
      noReplacement: false,
      stations: [],
    }),
  });
  const el = await mount(a);
  const zone = q(el, '[data-test="test-zone"]') as HTMLElement & {
    options: { value: string }[];
  };
  expect(zone.options.map((option) => option.value)).toEqual(["", "terrace"]);
  q(el, '[data-test="test-product"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "bread" } }),
  );
  zone.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "terrace" } }));
  await settle(el);
  expect(a.explain).toHaveBeenCalledWith("bread", "terrace");
  expect(q(el, '[data-test="test-answer"]')!.textContent).toContain("Made at: Bar");
  q(el, '[data-test="test-product"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "" } }),
  );
  await settle(el);
  expect(q(el, '[data-test="test-answer"]')!.textContent).not.toContain("Made at: Bar");
});

it("saves a product exception after changing its subject and clearing its zone", async () => {
  const a = api({ load: vi.fn().mockResolvedValue(exceptionView) });
  const el = await mount(a);
  q(el, '[data-test="add-exception"]')!.click();
  await settle(el);
  q(el, '[data-test="exception-zone"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "terrace" } }),
  );
  q(el, '[data-test="exception-what"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "category:cocktails" } }),
  );
  q(el, '[data-test="exception-what"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "product:bread" } }),
  );
  q(el, '[data-test="exception-zone"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "" } }),
  );
  q(el, '[data-test="exception-target"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "no_preparation" } }),
  );
  await settle(el);
  q(el, '[data-test="save-exception"]')!.click();
  await settle(el);
  expect(a.preview).toHaveBeenCalledWith({
    kind: "exception",
    id: null,
    input: {
      zoneId: null,
      categoryId: null,
      productId: "bread",
      target: { kind: "no_preparation" },
    },
  });
  q(el, '[data-test="confirm-routing"]')!.click();
  await settle(el);
  expect(a.createException).toHaveBeenCalledWith({
    zoneId: null,
    categoryId: null,
    productId: "bread",
    target: { kind: "no_preparation" },
  });
});

it("refuses negative order and invalid warm and forgotten thresholds together", async () => {
  const a = api();
  const el = await mount(a);
  q(el, '[data-test="edit-bar"]')!.click();
  await settle(el);
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
  q(el, '[data-test="default-terrace"]')!.click();
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

it("shows an inactive station refusal from exception preview without calling its write", async () => {
  setLocale("en");
  const a = api({
    load: vi.fn().mockResolvedValue(exceptionView),
    preview: vi.fn().mockRejectedValue({ code: "route.station_inactive" }),
    updateException: vi.fn(),
  });
  const el = await mount(a);
  q(el, '[data-test="edit-exception-a"]')!.click();
  await settle(el);
  q(el, '[data-test="exception-target"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "bar" } }),
  );
  await settle(el);
  q(el, '[data-test="save-exception"]')!.click();
  await settle(el);
  expect(q(el, '[role="alert"]')?.textContent).toContain("This station is disabled");
  expect(q(el, '[data-test="routing-preview"]')).toBeNull();
  expect(a.updateException).not.toHaveBeenCalled();
});

it("keeps a refused folder claim next to its choice after confirmation", async () => {
  setLocale("en");
  const a = api({ setClaim: vi.fn().mockRejectedValue({ code: "route.station_inactive" }) });
  const el = await mount(a);
  q(el, '[data-test="claim-bar"]')!.click();
  await settle(el);
  q(el, '[data-test="claim-choice"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "food" } }),
  );
  await settle(el);
  q(el, '[data-test="confirm-routing"]')!.click();
  await settle(el);
  expect(q(el, '[data-field-error="claim"]')?.textContent).toContain(
    "This station is disabled. Choose an active station.",
  );
  expect(q(el, '[data-test="claim-choice"]')).not.toBeNull();
  expect(q(el, '[data-test="routing-preview"]')).toBeNull();
});
it.each([
  ["en", "Old bar (Disabled)"],
  ["es-ES", "Old bar (Deshabilitada)"],
] as const)("names a retained disabled exception station in %s", async (locale, expected) => {
  setLocale(locale);
  const el = await mount(api({ load: vi.fn().mockResolvedValue(exceptionView) }));
  q(el, '[data-test="edit-exception-b"]')!.click();
  await settle(el);
  const target = q(el, '[data-test="exception-target"]')!;
  expect(target.shadowRoot!.querySelector(".trigger .value")!.textContent?.trim()).toBe(expected);
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
  q(el, '[data-test="change-fallback-upstairs"]')!.click();
  await settle(el);
  const combo = q(el, '[data-test="station-fallback"]') as HTMLElement & {
    value: string;
    options: { value: string; label: string }[];
  };
  expect(combo.options).toContainEqual({ value: "old", label: "Old bar (disabled)" });
  expect(combo.value).toBe("old");
  q(el, '[data-test="station-action-modal"]')!.dispatchEvent(new CustomEvent("wt-close"));
  await settle(el);
  q(el, '[data-test="switch-off-upstairs"]')!.click();
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
    expect(q(el, '[data-test="station-upstairs"]')!.textContent).toContain("until 06:00 today");
    if (why === "closed_by_hand")
      expect(q(el, '[data-test="station-upstairs"]')!.textContent).toContain(
        "No replacement: the till will ask where to send its dishes.",
      );
    expect(q(el, '[data-test="change-fallback-bar"]')).toBeNull();
  },
);
it("reports unreadable venue time on every station card", async () => {
  const next = withUpstairs({ open: true, why: "in_hours" });
  next.routing.clockReadable = false;
  const el = await mount(api({ load: vi.fn().mockResolvedValue(next) }));
  for (const id of ["bar", "upstairs"])
    expect(q(el, `[data-test="station-${id}"]`)!.textContent).toContain(
      "Opening hours are not applied: the venue's time zone or day cutover cannot be read.",
    );
});
it.each(["open", null] as const)("saves the by-hand action %s", async (state) => {
  const a = api({
    load: vi
      .fn()
      .mockResolvedValue(withUpstairs({ open: false, why: "closed_by_hand" }, { today: "closed" })),
    setStationToday: vi.fn(),
  });
  const el = await mount(a);
  q(el, `[data-test="${state ? "open-today" : "schedule"}-upstairs"]`)!.click();
  await settle(el);
  q(el, '[data-test="confirm-station-action"]')!.click();
  await settle(el);
  expect(a.setStationToday).toHaveBeenCalledWith("upstairs", state);
});
it("shows a refused by-hand closure at the end of the dialog body and allows retry", async () => {
  const a = api({
    load: vi.fn().mockResolvedValue(withUpstairs({ open: true, why: "in_hours" })),
    setStationToday: vi.fn().mockRejectedValue({ code: "time_zone.unreadable" }),
  });
  const el = await mount(a);
  q(el, '[data-test="close-today-upstairs"]')!.click();
  await settle(el);
  q(el, '[data-test="confirm-station-action"]')!.click();
  await settle(el);
  const dialog = q(el, '[data-test="station-action-modal"]')!;
  expect(dialog.querySelector('[role="alert"]')!.textContent).toContain("time zone");
  expect(dialog.querySelector('[role="alert"]')!.nextElementSibling?.localName).toBe(
    "wt-form-actions",
  );
  expect(
    (q(el, '[data-test="confirm-station-action"]') as HTMLElement & { disabled: boolean }).disabled,
  ).toBe(false);
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
    const next = withUpstairs(
      sourceOpen ? { open: true, why: "in_hours" } : { open: false, why: "out_of_hours" },
      { fallbackStationId: null },
    );
    next.routing.stationTimes[0] = {
      ...next.routing.stationTimes[0]!,
      status: targetOpen ? { open: true, why: "in_hours" } : { open: false, why: "out_of_hours" },
      closedSendsTo: destination || null,
    };
    const a = api({ load: vi.fn().mockResolvedValue(next), setStationFallback: vi.fn() });
    const el = await mount(a);
    q(el, '[data-test="change-fallback-upstairs"]')!.click();
    await settle(el);
    const combo = q(el, '[data-test="station-fallback"]') as HTMLElement & {
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
    q(el, '[data-test="confirm-station-action"]')!.click();
    await settle(el);
    expect(q(el, '[data-test="fallback-confirmation"]')!.textContent).toContain(expected);
    if (sourceOpen)
      expect(q(el, '[data-test="fallback-confirmation"]')!.textContent).not.toContain(
        "That starts now.",
      );
    expect(a.setStationFallback).not.toHaveBeenCalled();
    q(el, '[data-test="confirm-station-action"]')!.click();
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
  q(el, '[data-test="change-fallback-upstairs"]')!.click();
  await settle(el);
  q(el, '[data-test="station-fallback"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "" } }),
  );
  await settle(el);
  q(el, '[data-test="confirm-station-action"]')!.click();
  await settle(el);
  q(el, '[data-test="confirm-station-action"]')!.click();
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
    q(el, '[data-test="change-fallback-upstairs"]')!.click();
    await settle(el);
    q(el, '[data-test="station-fallback"]')!.dispatchEvent(
      new CustomEvent("wt-change", { detail: { value: "bar" } }),
    );
    await settle(el);
    q(el, '[data-test="confirm-station-action"]')!.click();
    await settle(el);
    q(el, '[data-test="confirm-station-action"]')!.click();
    await settle(el);
    expect(q(el, '[data-field-error="fallback"]')?.textContent).toContain(
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
  q(el, '[data-test="switch-off-upstairs"]')!.click();
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
    heading: "Deshabilitadas",
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
    const off = q(on, '[data-test="switch-off-upstairs"]')!;
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
    const card = q(el, '[data-test="inactive-upstairs"]')!;
    expect(card.closest("section")!.querySelector("h2")!.textContent!.trim()).toBe(heading);
    expect(card.textContent).toContain(hint);
    const back = q(el, '[data-test="switch-on-upstairs"]')!;
    expect(back.textContent!.trim()).toBe(enable);
    back.click();
    await settle(el);
    expect(q(el, '[data-test="station-action-modal"]')!.getAttribute("heading")).toBe(enable);
  },
);
it("enables a disabled station and keeps its dark-screen warning in that card", async () => {
  const next = withUpstairs({ open: false, why: "switched_off" }, { closedSendsTo: null });
  next.stations[1]!.active = false;
  next.routing.stations[1]!.active = false;
  const a = api({
    load: vi.fn().mockResolvedValue(next),
    activateStation: vi.fn(),
    listOutputsDown: vi.fn().mockResolvedValue({
      printersDown: [],
      screensDark: [{ stationId: "upstairs", stationName: "Upstairs bar", lastSeenAt: null }],
    }),
  });
  const el = await mount(a);
  expect(q(el, '[data-test="inactive-upstairs"]')!.textContent).toContain(
    "No replacement: the till asks.",
  );
  expect(q(el, '[data-test="inactive-upstairs"]')!.textContent).toContain("has ever checked in");
  expect(q(el, '[data-test="station-bar"]')!.textContent).not.toContain("has ever checked in");
  q(el, '[data-test="switch-on-upstairs"]')!.click();
  await settle(el);
  q(el, '[data-test="confirm-station-action"]')!.click();
  await settle(el);
  expect(a.activateStation).toHaveBeenCalledWith("upstairs");
});
it("shows each output warning only on its station", async () => {
  const a = api({
    load: vi.fn().mockResolvedValue(withUpstairs({ open: true, why: "in_hours" })),
    listOutputsDown: vi.fn().mockResolvedValue({
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
  });
  const el = await mount(a);
  const card = q(el, '[data-test="station-upstairs"]')!;
  expect(card.textContent).toContain(
    "Printer Epson has printed nothing since something sent to it at 20:14 got stuck.",
  );
  expect(card.textContent).toContain(
    "Dishes are waiting, and no kitchen screen here has checked in since 20:10.",
  );
  expect(q(el, '[data-test="station-bar"]')!.textContent).not.toContain("got stuck");
  expect(q(el, '[data-test="station-bar"]')!.textContent).not.toContain("Dishes are waiting");
});
it("saves the whole hours list and places a server row refusal beside that row", async () => {
  const a = api({
    load: vi
      .fn()
      .mockResolvedValue(
        withUpstairs(
          { open: true, why: "in_hours" },
          { hours: [{ weekday: 5, opensAt: "22:00", closesAt: "02:00" }] },
        ),
      ),
    setStationHours: vi
      .fn()
      .mockRejectedValue({ code: "station.invalid", params: { field: "hours.0" } }),
  });
  const el = await mount(a);
  expect(q(el, '[data-test="interim-station-hours"]')!.textContent).toContain(
    "Friday 22:00–02:00 (next day)",
  );
  q(el, '[data-test="edit-hours-upstairs"]')!.click();
  await settle(el);
  const form = q(el, "station-hours-form")!;
  form.shadowRoot!.querySelector<HTMLElement>('[data-test="save-hours"]')!.click();
  await settle(el);
  expect(a.setStationHours).toHaveBeenCalledWith("upstairs", [
    { weekday: 5, opensAt: "22:00", closesAt: "02:00" },
  ]);
  expect(form.shadowRoot!.querySelectorAll('[data-field-error="hours.0"]')).toHaveLength(2);
});

it("refreshes output warnings every minute and clears the timer when removed", async () => {
  const timers = new Map<ReturnType<typeof setInterval>, TimerHandler>();
  const original = window.setInterval.bind(window);
  const interval = vi.spyOn(window, "setInterval").mockImplementation((handler, delay, ...args) => {
    const id = original(handler, delay, ...args) as unknown as ReturnType<typeof setInterval>;
    if (delay === 60_000) timers.set(id, handler);
    return id;
  });
  const clear = vi.spyOn(window, "clearInterval");
  try {
    const a = api({
      load: vi.fn().mockResolvedValue(withUpstairs({ open: true, why: "in_hours" })),
      listOutputsDown: vi
        .fn()
        .mockResolvedValueOnce({ printersDown: [], screensDark: [] })
        .mockResolvedValue({
          printersDown: [],
          screensDark: [{ stationId: "upstairs", stationName: "Upstairs bar", lastSeenAt: null }],
        }),
    });
    const el = await mount(a);
    expect(q(el, '[data-test="station-upstairs"]')!.textContent).not.toContain(
      "has ever checked in",
    );
    for (const handler of timers.values()) if (typeof handler === "function") handler();
    await settle(el);
    expect(q(el, '[data-test="station-upstairs"]')!.textContent).toContain("has ever checked in");
    el.remove();
    expect(
      [...timers.keys()].some((id) => clear.mock.calls.some(([cleared]) => cleared === id)),
    ).toBe(true);
  } finally {
    interval.mockRestore();
    clear.mockRestore();
  }
});

it("offers the fallback directly on the active station card and confirms a changed selection", async () => {
  const a = api({
    load: vi.fn().mockResolvedValue(withUpstairs({ open: false, why: "out_of_hours" })),
    setStationFallback: vi.fn(),
  });
  const el = await mount(a);
  const combo = q(el, '[data-test="fallback-upstairs"]') as HTMLElement & {
    value: string;
    options: { value: string; label: string }[];
  };
  expect(combo).not.toBeNull();
  expect(combo.value).toBe("bar");
  expect(combo.options[0]).toEqual({ value: "", label: "No replacement (the till asks)" });
  combo.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "" } }));
  await settle(el);
  expect(q(el, '[data-test="fallback-confirmation"]')!.textContent).toContain(
    "While Upstairs bar is closed, the till will ask where to send its dishes.",
  );
  expect(a.setStationFallback).not.toHaveBeenCalled();
  q(el, '[data-test="confirm-station-action"]')!.click();
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
  q(el, '[data-test="switch-off-upstairs"]')!.click();
  await settle(el);
  q(el, '[data-test="station-fallback"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "bar" } }),
  );
  await settle(el);
  q(el, '[data-test="confirm-station-action"]')!.click();
  await settle(el);
  q(el, '[data-test="confirm-station-action"]')!.click();
  await settle(el);
  expect((q(el, '[data-test="fallback-upstairs"]') as HTMLElement & { value: string }).value).toBe(
    "bar",
  );
  expect(q(el, '[data-test="station-upstairs"]')!.textContent).toContain("Its work goes to Bar.");
  expect(
    q(el, '[data-test="station-action-modal"]')!.querySelector('[role="alert"]')!.textContent,
  ).toContain("could not be saved");
});

it("localizes the fallback search field in Spanish", async () => {
  setLocale("es-ES");
  const el = await mount(
    api({ load: vi.fn().mockResolvedValue(withUpstairs({ open: true, why: "in_hours" })) }),
  );
  const combo = q(el, '[data-test="fallback-upstairs"]')!;
  combo.shadowRoot!.querySelector<HTMLElement>(".trigger")!.click();
  await settle(el);
  expect(combo.shadowRoot!.querySelector<HTMLInputElement>("input")!.placeholder).toBe(
    "Buscar estaciones",
  );
});

it("keeps the edited hours through a live routing refresh and saves that draft", async () => {
  const liveData = new LiveData();
  const saved = withUpstairs(
    { open: false, why: "out_of_hours" },
    { hours: [{ weekday: 5, opensAt: "22:00", closesAt: "02:00" }] },
  );
  const a = api({
    liveData,
    load: vi.fn(async () => structuredClone(saved)),
    setStationHours: vi.fn(),
  });
  const el = await mount(a);
  q(el, '[data-test="edit-hours-upstairs"]')!.click();
  await settle(el);
  const form = q(el, "station-hours-form")!;
  const closes = form.shadowRoot!.querySelector<WtInput>('[data-test="closes-0"]')!;
  closes.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "03:00" } }));
  await settle(el);
  liveData.invalidate([{ type: "products", id: "bread" }]);
  await vi.waitFor(() => expect(a.load).toHaveBeenCalledTimes(2));
  await settle(el);
  expect(closes.value).toBe("03:00");
  form.shadowRoot!.querySelector<HTMLElement>('[data-test="save-hours"]')!.click();
  await settle(el);
  expect(a.setStationHours).toHaveBeenCalledWith("upstairs", [
    { weekday: 5, opensAt: "22:00", closesAt: "03:00" },
  ]);
  q(el, '[data-test="edit-hours-upstairs"]')!.click();
  await settle(el);
  expect(
    q(el, "station-hours-form")!.shadowRoot!.querySelector<WtInput>('[data-test="closes-0"]')!
      .value,
  ).toBe("02:00");
});

it.each(["success", "refusal"] as const)(
  "keeps the pending hours editor until its %s is visible",
  async (outcome) => {
    let resolve!: () => void;
    let reject!: (reason: unknown) => void;
    const pending = new Promise<void>((ok, no) => {
      resolve = ok;
      reject = no;
    });
    const a = api({
      load: vi
        .fn()
        .mockResolvedValue(
          withUpstairs(
            { open: false, why: "out_of_hours" },
            { hours: [{ weekday: 5, opensAt: "22:00", closesAt: "02:00" }] },
          ),
        ),
      setStationHours: vi.fn(() => pending),
    });
    const el = await mount(a);
    q(el, '[data-test="edit-hours-upstairs"]')!.click();
    await settle(el);
    const form = q(el, "station-hours-form")!;
    form.shadowRoot!.querySelector<HTMLElement>('[data-test="save-hours"]')!.click();
    await settle(el);
    const cancel = form.shadowRoot!.querySelector<HTMLElement & { disabled: boolean }>(
      'wt-button[slot="cancel"]',
    )!;
    expect(cancel.disabled).toBe(true);
    cancel.click();
    form.dispatchEvent(new CustomEvent("hours-cancel"));
    q(el, '[data-test="close-today-upstairs"], [data-test="open-today-upstairs"]')!.click();
    await settle(el);
    expect(q(el, "station-hours-form")).toBe(form);
    if (outcome === "refusal") reject({ code: "station.not_found" });
    else resolve();
    await settle(el);
    if (outcome === "refusal") {
      expect(q(el, "station-hours-form")).toBe(form);
      expect(form.shadowRoot!.querySelector('[role="alert"]')!.textContent).toContain(
        "could not be saved",
      );
      expect(cancel.disabled).toBe(false);
      cancel.click();
      await settle(el);
    }
    expect(q(el, "station-hours-form")).toBeNull();
    q(el, '[data-test="edit-hours-upstairs"]')!.click();
    await settle(el);
    expect(q(el, "station-hours-form")).not.toBeNull();
  },
);

it.each(["success", "refusal"] as const)(
  "guards the pending close dialog against cancellation until %s",
  async (outcome) => {
    let resolve!: () => void;
    let reject!: (reason: unknown) => void;
    const pending = new Promise<void>((ok, no) => {
      resolve = ok;
      reject = no;
    });
    const a = api({
      load: vi.fn().mockResolvedValue(withUpstairs({ open: true, why: "in_hours" })),
      setStationToday: vi.fn(() => pending),
    });
    const el = await mount(a);
    q(el, '[data-test="close-today-upstairs"]')!.click();
    await settle(el);
    q(el, '[data-test="confirm-station-action"]')!.click();
    await settle(el);
    const dialog = q(el, '[data-test="station-action-modal"]')!;
    const cancel = dialog.querySelector<HTMLElement & { disabled: boolean }>(
      'wt-button[slot="cancel"]',
    )!;
    expect(cancel.disabled).toBe(true);
    cancel.click();
    dialog.dispatchEvent(new CustomEvent("wt-close"));
    q(el, '[data-test="edit-hours-upstairs"]')!.click();
    await settle(el);
    expect(q(el, '[data-test="station-action-modal"]')).toBe(dialog);
    if (outcome === "refusal") reject({ code: "time_zone.unreadable" });
    else resolve();
    await settle(el);
    if (outcome === "refusal") {
      expect(
        q(el, '[data-test="station-action-modal"]')!.querySelector('[role="alert"]')!.textContent,
      ).toContain("time zone");
      cancel.click();
      await settle(el);
    }
    expect(q(el, '[data-test="station-action-modal"]')).toBeNull();
    q(el, '[data-test="edit-hours-upstairs"]')!.click();
    await settle(el);
    expect(q(el, "station-hours-form")).not.toBeNull();
  },
);

it.each([
  [
    "out_of_hours",
    "Upstairs bar is closed outside its opening hours, so its work goes to Downstairs bar.",
  ],
  ["closed_by_hand", "Upstairs bar is closed by hand today, so its work goes to Downstairs bar."],
  ["switched_off", "Upstairs bar is disabled, so its work goes to Downstairs bar."],
])("explains %s before the destination", async (why, sentence) => {
  const el = await mount(
    api({
      explain: vi.fn().mockResolvedValue({
        route: { kind: "station", stationId: "downstairs" },
        decidedBy: { kind: "claim", categoryId: "cocktails" },
        fallbacks: [{ stationId: "upstairs", why }],
        noReplacement: false,
        clockReadable: true,
        stations: [
          { id: "upstairs", name: "Upstairs bar", active: true },
          { id: "downstairs", name: "Downstairs bar", active: true },
        ],
      }),
    }),
  );
  q(el, '[data-test="test-product"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "bread" } }),
  );
  await settle(el);
  const answer = q(el, '[data-test="test-answer"]')!.textContent!;
  expect(answer).toContain(sentence);
  expect(answer).toContain("Because: Upstairs bar claims Cocktails");
  expect(answer.indexOf(sentence)).toBeLessThan(answer.indexOf("Made at:"));
});
it("explains each fallback and the final dead end without saying no rule matched", async () => {
  const el = await mount(
    api({
      explain: vi.fn().mockResolvedValue({
        route: null,
        decidedBy: { kind: "claim", categoryId: "cocktails" },
        fallbacks: [
          { stationId: "upstairs", why: "out_of_hours" },
          { stationId: "bar", why: "closed_by_hand" },
        ],
        noReplacement: true,
        clockReadable: true,
        stations: [
          { id: "upstairs", name: "Upstairs bar", active: true },
          { id: "bar", name: "Downstairs bar", active: true },
        ],
      }),
    }),
  );
  q(el, '[data-test="test-product"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "bread" } }),
  );
  await settle(el);
  const answer = q(el, '[data-test="test-answer"]')!.textContent!;
  expect(answer).toContain(
    "Upstairs bar is closed outside its opening hours, so its work goes to Downstairs bar.",
  );
  expect(answer).toContain(
    "Downstairs bar is closed by hand today, and it has no replacement, so the till asks the waiter where to make this.",
  );
  expect(answer).not.toContain("no rule matched");
  expect(answer).not.toContain("Made at:");
});
it("keeps the no-default explanation and reports unreadable opening hours", async () => {
  const el = await mount(
    api({
      explain: vi.fn().mockResolvedValue({
        route: null,
        decidedBy: null,
        fallbacks: [],
        noReplacement: false,
        clockReadable: false,
        stations: [],
      }),
    }),
  );
  q(el, '[data-test="test-product"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "bread" } }),
  );
  await settle(el);
  expect(q(el, '[data-test="test-answer"]')!.textContent).toContain(
    "Nothing can make this: no rule matched and no default station is active.",
  );
  expect(q(el, '[data-test="test-answer"]')!.textContent).toContain(
    "The venue's time zone or day cutover cannot be read, so opening hours are not applied.",
  );
});
it("sends both the chosen weekday and time and returns to now", async () => {
  const a = api();
  const el = await mount(a);
  q(el, '[data-test="test-product"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "bread" } }),
  );
  await settle(el);
  const when = q(el, '[data-test="test-when"]') as WtCombobox;
  expect(when.value).toBe("now");
  when.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "at" } }));
  await settle(el);
  const day = q(el, '[data-test="test-weekday"]')!;
  day.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "5" } }));
  const time = q(el, '[data-test="test-time"]') as WtInput;
  time.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "22:00" } }));
  await settle(el);
  expect(a.explain).toHaveBeenLastCalledWith("bread", null, { weekday: 5, timeOfDay: "22:00" });
  when.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "now" } }));
  await settle(el);
  expect(a.explain).toHaveBeenLastCalledWith("bread", null);
});

it("clears the scheduled answer and shows the required-time problem when time is removed", async () => {
  setLocale("en");
  const a = api({
    explain: vi.fn().mockResolvedValue({
      route: { kind: "station", stationId: "bar" },
      decidedBy: { kind: "default" },
      fallbacks: [],
      noReplacement: false,
      clockReadable: true,
      stations: view.routing.stations,
    }),
  });
  const el = await mount(a);
  q(el, '[data-test="test-product"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "bread" } }),
  );
  const when = q(el, '[data-test="test-when"]')!;
  when.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "at" } }));
  await settle(el);
  expect(q(el, '[data-test="test-answer"]')!.textContent).toContain("Made at: Bar");
  const count = vi.mocked(a.explain).mock.calls.length;
  const time = q(el, '[data-test="test-time"]') as WtInput;
  time.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "" } }));
  await settle(el);
  expect(q(el, "#test-time-error")!.textContent).toContain("Choose a time.");
  expect(time.getAttribute("aria-invalid")).toBe("true");
  expect(q(el, '[data-test="test-answer"]')!.textContent).not.toContain("Made at: Bar");
  expect(vi.mocked(a.explain).mock.calls.length).toBe(count);
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

it("opens the default Stations tab and places create actions beside the tabs", async () => {
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
  expect(q(el, '[data-test="new-watcher"]')!.closest('[slot="actions"]')).not.toBeNull();
  expect(el.shadowRoot!.querySelectorAll('[data-test="new-watcher"]')).toHaveLength(1);
  q(el, '[data-test="new-watcher"]')!.click();
  await settle(el);
  expect(el.shadowRoot!.querySelector("watcher-form")).not.toBeNull();
});

it.each(["tickets", "watchers", "settings"])(
  "opens the %s deep link and selects Routing with its tester retained",
  async (tab) => {
    history.replaceState(null, "", `/manage/prep-stations/view/${tab}/test/bread`);
    const el = await mount(api());
    const tabs = el.shadowRoot!.querySelector("wt-tabs");
    expect(tabs, "the page owns a tab strip").not.toBeNull();
    await tabs!.updateComplete;
    expect(tabs!.value).toBe(tab);
    tabs!.shadowRoot!.querySelector<HTMLButtonElement>('[data-key="routing"]')!.click();
    await settle(el);
    expect(location.pathname).toBe("/manage/prep-stations/view/routing/test/bread");
    expect(q(el, '[data-test="test-product"]')!.closest('[slot="routing"]')).not.toBeNull();
    expect((q(el, '[data-test="test-product"]') as WtCombobox).value).toBe("bread");
    expect(q(el, '[data-test="claim-bar"]')!.closest('[slot="routing"]')).not.toBeNull();
    expect(q(el, '[data-test="add-exception"]')!.closest('[slot="routing"]')).not.toBeNull();
  },
);

it("keeps old tester links visible and restores panels on Back without adding history entries", async () => {
  history.replaceState(null, "", "/manage/prep-stations/test/bread");
  const count = history.length;
  const el = await mount(api());
  const tabs = el.shadowRoot!.querySelector("wt-tabs");
  expect(tabs, "the page owns a tab strip").not.toBeNull();
  await tabs!.updateComplete;
  expect(tabs!.value).toBe("routing");
  expect(location.pathname).toBe("/manage/prep-stations/view/routing/test/bread");
  expect(history.length).toBe(count);
  history.replaceState(null, "", "/manage/prep-stations/view/watchers");
  dispatchEvent(new PopStateEvent("popstate"));
  await settle(el);
  expect(tabs!.value).toBe("watchers");
  expect((q(el, '[data-test="test-product"]') as WtCombobox).value).toBe("");
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

it("keeps interim station hours outside every tab and opens the existing editor", async () => {
  const el = await mount(
    api({ load: vi.fn().mockResolvedValue(withUpstairs({ open: true, why: "in_hours" })) }),
  );
  const action = q(el, '[data-test="edit-hours-upstairs"]')!;
  expect(action.closest("wt-tabs")).toBeNull();
  expect(action.closest('[data-test="interim-station-hours"]')).not.toBeNull();
  action.click();
  await settle(el);
  expect(el.shadowRoot!.querySelector("station-hours-form")).not.toBeNull();
});

it.each([
  {
    locale: "en",
    claim: "Claim a category",
    field: "Category",
    disable: "Disable",
    enable: "Enable",
  },
  {
    locale: "es",
    claim: "Asignar una categoría",
    field: "Categoría",
    disable: "Deshabilitar",
    enable: "Habilitar",
  },
])(
  "uses category and Disable/Enable wording for retained stations and watchers ($locale)",
  async ({ locale, claim, field, disable, enable }) => {
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
    };
    const el = await mount(
      api({
        load: vi
          .fn()
          .mockResolvedValue({ ...view, stations: [...view.stations, disabled], watchers: [pass] }),
      }),
    );
    expect(q(el, '[data-test="claim-bar"]')!.textContent!.trim()).toBe(claim);
    expect(q(el, '[data-test="switch-off-bar"]')!.textContent!.trim()).toBe(disable);
    expect(q(el, '[data-test="switch-on-upstairs"]')!.textContent!.trim()).toBe(enable);
    expect(q(el, '[data-test="remove-watcher-pass"]')!.textContent!.trim()).toBe(disable);
    q(el, '[data-test="claim-bar"]')!.click();
    await settle(el);
    expect((q(el, '[data-test="claim-choice"]') as WtCombobox).label).toBe(field);
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
    setStationToday: vi.fn(),
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
it.each([
  ["open", { open: false, why: "out_of_hours" }, "open", "Open for today"],
  ["close", { open: true, why: "in_hours" }, "closed", "Close for today"],
] as const)(
  "Today confirms a %s action on the selected station before writing",
  async (action, status, state, label) => {
    setLocale("en");
    const { a, el } = await mountToday(
      withUpstairs(status, {
        hours: [{ weekday: 1, opensAt: "12:00", closesAt: "01:00" }],
      }),
    );
    const button = healthSummary(el)!.querySelector<HTMLElement>(
      `[data-test="${action}-today-upstairs"]`,
    );
    expect(button).not.toBeNull();
    expect(button!.textContent!.trim()).toBe(label);
    button!.click();
    await settle(el);
    expect(q(el, '[data-test="station-action-modal"]')!.getAttribute("heading")).toBe(label);
    expect(a.setStationToday).not.toHaveBeenCalled();
    q(el, '[data-test="confirm-station-action"]')!.click();
    await settle(el);
    expect(a.setStationToday).toHaveBeenCalledExactlyOnceWith("upstairs", state);
  },
);
it("Today names the effective fallback and returns a by-hand closure to the schedule", async () => {
  setLocale("en");
  const { a, el } = await mountToday(
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
  const button = cell.querySelector<HTMLElement>('[data-test="schedule-upstairs"]');
  expect(button).not.toBeNull();
  expect(cell.querySelector('[data-test="open-today-upstairs"]')).toBeNull();
  button!.click();
  await settle(el);
  expect(a.setStationToday).not.toHaveBeenCalled();
  q(el, '[data-test="confirm-station-action"]')!.click();
  await settle(el);
  expect(a.setStationToday).toHaveBeenCalledExactlyOnceWith("upstairs", null);
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
it("Today keeps its confirmation and refusal after a write fails and allows a retry", async () => {
  setLocale("en");
  const { a, el } = await mountToday(
    withUpstairs(
      { open: true, why: "in_hours" },
      {
        hours: [{ weekday: 1, opensAt: "12:00", closesAt: "01:00" }],
      },
    ),
    {
      setStationToday: vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue(undefined),
    },
  );
  const button = healthSummary(el)!.querySelector<HTMLElement>(
    '[data-test="close-today-upstairs"]',
  );
  expect(button).not.toBeNull();
  button!.click();
  await settle(el);
  q(el, '[data-test="confirm-station-action"]')!.click();
  await settle(el);
  expect(q(el, '[data-test="station-action-modal"]')!.textContent).toContain("could not be saved");
  q(el, '[data-test="confirm-station-action"]')!.click();
  await settle(el);
  expect(a.setStationToday).toHaveBeenCalledTimes(2);
  expect(q(el, '[data-test="station-action-modal"]')).toBeNull();
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
] as const)("Today controls remain accessible in %s %s at %ipx", async (locale, theme, width) => {
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
    const close = summary.querySelector<HTMLElement>('[data-test="close-today-upstairs"]')!;
    const schedule = summary.querySelector<HTMLElement>('[data-test="schedule-closed"]')!;
    expect(close.textContent!.trim()).toBe(locale === "en" ? "Close for today" : "Cerrar por hoy");
    expect(schedule.textContent!.trim()).toBe(
      locale === "en" ? "Back to the schedule" : "Volver al horario",
    );
    expect(el.getBoundingClientRect().right).toBeLessThanOrEqual(width);
    expect(close.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    await expectNoA11yViolations(host);
    await page.elementLocator(close).click();
    await settle(el);
    await expectNoA11yViolations(host);
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
    ).not.toBeNull();
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
      expect(healthSummary(el)!.querySelector('[data-test="open-today-upstairs"]')).not.toBeNull();
      await vi.advanceTimersByTimeAsync(60_000);
      await settle(el);
      const cell = healthSummary(el)!.querySelectorAll("tbody tr")[1]!.querySelectorAll("td")[1]!;
      expect(cell.textContent).toContain("Open until 01:00 tomorrow");
      expect(cell.querySelector('[data-test="close-today-upstairs"]')).not.toBeNull();
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

it("reorders Stations with the keyboard, retains focus and leaves routing priorities unchanged", async () => {
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
  expect(next.routing.claims).toEqual(view.routing.claims);
  expect(next.routing.exceptions).toEqual([]);
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
      const { el } = await mountToday(withUpstairs({ open: true, why: "in_hours" }), {}, theme);
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
      const rename = menu.querySelector<HTMLElement>('[data-test="rename-upstairs"]')!;
      await page.elementLocator(rename).click();
      await settle(el);
      expect(menu.shadowRoot!.querySelector("[popover]")!.matches(":popover-open")).toBe(false);
      expect(
        q(el, '[data-test="station-rename"]')!.getBoundingClientRect().right,
      ).toBeLessThanOrEqual(width);
      await expectNoA11yViolations(host);
    } finally {
      document.body.style.background = previous.body;
      document.documentElement.style.background = previous.canvas;
      await page.viewport(previous.width, previous.height);
    }
  },
);

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
      stationId: "bar",
      watcherId: null,
      kind: "kds_station",
      active: true,
    },
    {
      id: "elsewhere",
      label: "Other screen",
      stationId: "upstairs",
      watcherId: null,
      kind: "kds_station",
      active: true,
    },
    {
      id: "off",
      label: "Disabled screen",
      stationId: "bar",
      watcherId: null,
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
  q(el, '[data-test="save-watcher-printers-pass"]')!.click();
  await settle(el);
  expect(a.setWatcherPrinters).toHaveBeenCalledExactlyOnceWith("pass", ["watcher"]);
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
        path: `look/watcher-printers-${locale}-${theme}-${width}-picker.png`,
      });
      await page.elementLocator(combo.shadowRoot!.querySelector(".trigger")!).click();
      q(el, '[data-test="save-watcher-printers-pass"]')!.click();
      await settle(el);
      expect(
        q(el, '[data-test="watcher-printer-actions-pass"]')!.shadowRoot!.textContent,
      ).toContain(locale === "en" ? "Fix the fields" : "Corrige los campos");
      await expectNoA11yViolations(host);
      await page.screenshot({
        path: `look/watcher-printers-${locale}-${theme}-${width}-refusal.png`,
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
