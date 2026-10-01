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
function api(overrides: Partial<PrepStationsApi> = {}): PrepStationsApi {
  return {
    load: vi.fn().mockResolvedValue(view),
    setClaim: vi.fn(),
    createException: vi.fn(),
    assignProduct: vi.fn(),
    removeClaim: vi.fn(),
    preview: vi.fn().mockResolvedValue([]),
    explain: vi.fn().mockResolvedValue({ route: null, decidedBy: null, skipped: [], stations: [] }),
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
it("explains exceptions, claims, defaults, skipped rules and an unroutable product", async () => {
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
        skipped: [],
        stations: [{ id: "bar", name: "Bar", active: true }],
      })
      .mockResolvedValueOnce({
        route: { kind: "station", stationId: "bar" },
        decidedBy: { kind: "claim", categoryId: "cocktails" },
        skipped: [{ decision: { kind: "claim", categoryId: "drinks" }, stationId: "off" }],
        stations: [
          { id: "bar", name: "Bar", active: true },
          { id: "off", name: "Cocktail bar", active: false },
        ],
      })
      .mockResolvedValueOnce({
        route: { kind: "station", stationId: "bar" },
        decidedBy: { kind: "default" },
        skipped: [],
        stations: [{ id: "bar", name: "Bar", active: true }],
      })
      .mockResolvedValueOnce({ route: null, decidedBy: null, skipped: [], stations: [] }),
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
    if (expected.includes("Bar claims"))
      expect(q(el, '[data-test="test-answer"]')!.textContent).toContain(
        "Skipped: Cocktail bar claims Drinks, but Cocktail bar is switched off",
      );
  }
});

it("opens a product tester link with its product selected", async () => {
  setLocale("en");
  const before = location.href;
  history.replaceState(null, "", "/manage/prep-stations/test/lager");
  try {
    const el = await mount(
      api({
        load: vi.fn().mockResolvedValue({ ...view, products: [{ id: "lager", name: "Lager" }] }),
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
        skipped: [],
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
  expect(el.shadowRoot!.textContent).toContain("Switched off: its work goes to the next rule");
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
