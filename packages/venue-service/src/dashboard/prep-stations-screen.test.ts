import { afterEach, expect, it, vi } from "vitest";
import { LiveData, setLocale } from "@waitron/dashboard-kit";
import { applyTokens } from "@waitron/ui";
import type { PrepStationsApi, PrepStationsView } from "./routing-client.js";
import type { PrepStationsScreen } from "./prep-stations-screen.js";
import "./prep-stations-screen.js";

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
};
function api(overrides: Partial<PrepStationsApi> = {}): PrepStationsApi {
  return {
    load: vi.fn().mockResolvedValue(view),
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
async function mount(a: PrepStationsApi): Promise<PrepStationsScreen> {
  const host = document.createElement("div");
  applyTokens(host);
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
    "Nothing can make this: no rule matched and no default station is switched on.",
  ]) {
    select.dispatchEvent(new CustomEvent("wt-change", { detail: { value: "bread" } }));
    await settle(el);
    expect(q(el, '[data-test="test-answer"]')!.textContent).toContain(expected);
  }
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
it("keeps No preparation available and names claims on switched-off stations", async () => {
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
  expect(el.shadowRoot!.textContent).toContain("Switched off: no replacement, the till asks");
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
  expect(rows[1]!.textContent).toContain("Its station is switched off");
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
    "Choose a folder or product, a service zone, or both",
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
    expect(q(el, '[role="alert"]')?.textContent).toContain("This station is switched off");
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
    "Choose a folder or product",
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
    "Choose a folder or product",
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
  expect(q(el, '[role="alert"]')?.textContent).toContain("This station is switched off");
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
  expect(q(el, '[data-field-error="claim"]')?.textContent).toContain("switched off");
  expect(q(el, '[data-test="claim-choice"]')).not.toBeNull();
  expect(q(el, '[data-test="routing-preview"]')).toBeNull();
});
it.each([
  ["en", "Old bar (Switched off)"],
  ["es-ES", "Old bar (Desactivada)"],
] as const)("names a retained inactive exception station in %s", async (locale, expected) => {
  setLocale(locale);
  const el = await mount(api({ load: vi.fn().mockResolvedValue(exceptionView) }));
  q(el, '[data-test="edit-exception-b"]')!.click();
  await settle(el);
  const target = q(el, '[data-test="exception-target"]')!;
  expect(target.shadowRoot!.querySelector(".trigger .value")!.textContent?.trim()).toBe(expected);
});

it("retains a switched-off fallback in its editor but clears it for Switch off", async () => {
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
  expect(combo.options).toContainEqual({ value: "old", label: "Old bar (switched off)" });
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
      code === "station.fallback_loop" ? "loop" : "switched off",
    );
  },
);
it("keeps the new fallback after a failed switch-off and reports the failure in the body", async () => {
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
it("switches an inactive station on and keeps its dark-screen warning in that card", async () => {
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
  expect(q(el, '[data-test="station-upstairs"]')!.textContent).toContain(
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

it("refreshes the saved fallback when the following switch-off fails", async () => {
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
  const closes = form.shadowRoot!.querySelector<HTMLInputElement>('[data-test="closes-0"]')!;
  closes.value = "03:00";
  closes.dispatchEvent(new Event("input", { bubbles: true }));
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
    q(el, "station-hours-form")!.shadowRoot!.querySelector<HTMLInputElement>(
      '[data-test="closes-0"]',
    )!.value,
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
  ["switched_off", "Upstairs bar is switched off, so its work goes to Downstairs bar."],
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
    "Nothing can make this: no rule matched and no default station is switched on.",
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
  const when = q(el, '[data-test="test-when"]') as HTMLSelectElement;
  expect(when.value).toBe("now");
  when.value = "at";
  when.dispatchEvent(new Event("change"));
  await settle(el);
  const day = q(el, '[data-test="test-weekday"]') as HTMLSelectElement;
  day.value = "5";
  day.dispatchEvent(new Event("change"));
  const time = q(el, '[data-test="test-time"]') as HTMLInputElement;
  time.value = "22:00";
  time.dispatchEvent(new Event("input"));
  await settle(el);
  expect(a.explain).toHaveBeenLastCalledWith("bread", null, { weekday: 5, timeOfDay: "22:00" });
  when.value = "now";
  when.dispatchEvent(new Event("change"));
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
  const when = q(el, '[data-test="test-when"]') as HTMLSelectElement;
  when.value = "at";
  when.dispatchEvent(new Event("change"));
  await settle(el);
  expect(q(el, '[data-test="test-answer"]')!.textContent).toContain("Made at: Bar");
  const count = vi.mocked(a.explain).mock.calls.length;
  const time = q(el, '[data-test="test-time"]') as HTMLInputElement;
  time.value = "";
  time.dispatchEvent(new Event("input"));
  await settle(el);
  expect(q(el, "#test-time-error")!.textContent).toContain("Choose a time.");
  expect(time.getAttribute("aria-invalid")).toBe("true");
  expect(q(el, '[data-test="test-answer"]')!.textContent).not.toContain("Made at: Bar");
  expect(vi.mocked(a.explain).mock.calls.length).toBe(count);
});
