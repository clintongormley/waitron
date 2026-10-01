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
    removeClaim: vi.fn(),
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
it("shows station claims by full folder path and unassigned work with default destination", async () => {
  const el = await mount(api());
  expect(q(el, '[data-test="station-bar"]')!.textContent).toContain("Drinks › Cocktails");
  expect(q(el, '[data-test="unassigned"]')!.textContent).toContain("Food");
  expect(q(el, '[data-test="unassigned"]')!.textContent).toContain("Bread");
  expect(q(el, '[data-test="unassigned"]')!.textContent).toContain("Bar");
});
it("assigns an unassigned folder and removes a claim", async () => {
  const a = api();
  const el = await mount(a);
  q(el, '[data-test="assign-food"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "bar" } }),
  );
  await settle(el);
  expect(a.setClaim).toHaveBeenCalledWith("food", { kind: "station", stationId: "bar" });
  q(el, '[data-test="remove-cocktails"]')!.click();
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

it("assigns an unassigned product through a product exception", async () => {
  const a = api();
  const el = await mount(a);
  q(el, '[data-test="assign-bread"]')!.dispatchEvent(
    new CustomEvent("wt-change", { detail: { value: "bar" } }),
  );
  await settle(el);
  expect(a.createException).toHaveBeenCalledWith({
    zoneId: null,
    categoryId: null,
    productId: "bread",
    target: { kind: "station", stationId: "bar" },
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
  const a = api({ setClaim: vi.fn().mockRejectedValue({ code: "route.station_inactive" }) });
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
  const a = api({ createException: vi.fn().mockRejectedValue({ code: "route.station_inactive" }) });
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
