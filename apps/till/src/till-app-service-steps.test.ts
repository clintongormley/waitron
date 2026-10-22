import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { deviceZonesFixture } from "../test/device-zones.js";
import { dueStepSignal } from "../test/service-steps.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { currentLocale, setLocale, t } from "./i18n/t.js";
import { codeMessage } from "./i18n/codes.js";
import type { FloorZone, TableState, TillApi } from "./api/client.js";
import type { TillFloorScreen } from "./screens/till-floor-screen.js";
import type { TillApp } from "./till-app.js";
import "./till-app.js";

const locale = currentLocale();
afterEach(() => {
  cleanupWidgets();
  setLocale(locale);
});

const room: FloorZone = {
  id: "z1",
  name: "Room",
  displayOrder: 0,
  active: true,
  closesAt: null,
  closed: false,
  hasPlan: false,
  layoutSetName: null,
  layoutDue: null,
  serviceMode: "table_tab",
};

function seated(signals: TableState["signals"]): TableState {
  return {
    id: "t9",
    label: "T9",
    zoneId: "z1",
    state: "open-tab",
    condition: "held",
    hasOpenTab: true,
    tabLineCount: 2,
    tabTotal: "20.00",
    pendingDeliveries: 0,
    pendingToServe: 0,
    readyToServe: 0,
    timingBand: "fresh",
    nextReservation: null,
    today: null,
    signals,
    party: {
      id: "p9",
      kitchenNote: { scope: { partyId: "p9" }, note: null, revision: 0, ownerRevision: 1 },
      revision: 1,
      guestCount: 2,
      state: "open",
      name: null,
      displayName: "T9",
      mainBillId: null,
      outstanding: "0.00",
      billCount: 1,
      tableIds: ["t9"],
      unsentDrafts: [],
      reminder: null,
    },
  };
}

/** The floor holds the step until Done has been sent, then reads without it. */
function floorUntilDone(markServiceStepDone: ReturnType<typeof vi.fn>) {
  return vi.fn(async () =>
    markServiceStepDone.mock.calls.length === 0
      ? [seated([dueStepSignal("Dessert?")])]
      : [seated([])],
  );
}

async function mount(markServiceStepDone: ReturnType<typeof vi.fn>) {
  setLocale("en-GB");
  const api = {
    getLocales: vi
      .fn()
      .mockResolvedValue({ locales: [{ code: "en-GB", label: "English" }], venueDefault: "en-GB" }),
    getContentLanguages: vi
      .fn()
      .mockResolvedValue({ defaultLanguage: "en", languages: ["en", "es"] }),
    getTill: vi.fn().mockResolvedValue({
      locale: "en-GB",
      invoiceLocale: "en-GB",
      venueName: "Restaurant",
      nif: "B12345678",
      orderFlow: "prepay",
      bumpMode: "line",
      fireControl: "waiter",
      courses: [],
      cardProvider: "none",
      tipsEnabled: false,
      formFactor: "till",
      capabilities: ["take-orders"],
      inactivityTimeoutSeconds: null,
      nodeId: "node",
      servers: [],
    }),
    getDeviceIdentity: vi.fn().mockResolvedValue({
      deviceId: "device",
      name: "Till",
      formFactor: "till",
      profileId: "profile",
    }),
    getDeviceZones: vi.fn().mockResolvedValue(deviceZonesFixture([], ["z1"])),
    listDefaultZoneOffers: vi.fn().mockRejectedValue({ code: "server.internal" }),
    listZoneOffers: vi.fn().mockRejectedValue({ code: "server.internal" }),
    setServiceZone: vi.fn(),
    listStaff: vi.fn().mockResolvedValue([]),
    listWorkingOrders: vi.fn().mockResolvedValue([]),
    listCounterWaiting: vi.fn().mockResolvedValue([]),
    listStations: vi.fn().mockResolvedValue([]),
    getStationQueue: vi.fn().mockResolvedValue({ items: [], notices: [] }),
    listSentDepartmentTransfers: vi.fn().mockResolvedValue({ requests: [] }),
    listZones: vi.fn().mockResolvedValue([room]),
    getTablesState: floorUntilDone(markServiceStepDone),
    markServiceStepDone,
    logout: vi.fn().mockResolvedValue(undefined),
    putLocale: vi.fn().mockResolvedValue(undefined),
  };
  const { el } = await mountWidget<TillApp>("till-app", { api: api as unknown as TillApi });
  await vi.waitFor(() => expect(el.shadowRoot!.querySelector("till-lock-screen")).not.toBeNull());
  el.shadowRoot!.querySelector("till-lock-screen")!.dispatchEvent(
    new CustomEvent("logged-in", {
      detail: { personId: "person", displayName: "Ana", permissions: [], locale: "en-GB" },
      bubbles: true,
      composed: true,
    }),
  );
  const floor = () => el.shadowRoot!.querySelector<TillFloorScreen>("till-floor-screen");
  await vi.waitFor(() =>
    expect(floor()?.shadowRoot?.querySelector('[data-table="t9"] [data-step-done]')).toBeTruthy(),
  );
  return { el, floor: floor()!, api };
}

const done = (floor: TillFloorScreen) =>
  floor.shadowRoot!.querySelector<HTMLButtonElement>('[data-table="t9"] [data-step-done]');

it("sends Done on the card's step to the server, then reads the floor without it", async () => {
  const markServiceStepDone = vi.fn().mockResolvedValue({ cleared: ["step-Dessert?"] });
  const { floor, api } = await mount(markServiceStepDone);
  const reads = api.getTablesState.mock.calls.length;

  await userEvent.click(done(floor)!);

  expect(markServiceStepDone).toHaveBeenCalledExactlyOnceWith("p9", "step-Dessert?");
  await vi.waitFor(() => expect(api.getTablesState.mock.calls.length).toBe(reads + 1));
  await vi.waitFor(() => expect(done(floor)).toBeNull());
  expect(
    floor.shadowRoot!.querySelector('[data-table="t9"] [data-chip="service-step"]'),
  ).toBeNull();
});

it("says a deleted step no longer exists, and still reads the floor", async () => {
  const markServiceStepDone = vi.fn().mockRejectedValue({
    code: "service_step.not_found",
    status: 404,
  });
  const { el, floor, api } = await mount(markServiceStepDone);
  const reads = api.getTablesState.mock.calls.length;

  await userEvent.click(done(floor)!);

  await vi.waitFor(() => expect(api.getTablesState.mock.calls.length).toBe(reads + 1));
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector(".error")?.textContent).toContain(
      codeMessage("service_step.not_found"),
    ),
  );
});

it.each([
  ["a closed party", { code: "party.not_open" }, () => codeMessage("party.not_open")],
  ["a failure with no code", new Error("offline"), () => t("table.error")],
])("says why Done was refused for %s, and still reads the floor", async (_name, refusal, said) => {
  const markServiceStepDone = vi.fn().mockRejectedValue(refusal);
  const { el, floor, api } = await mount(markServiceStepDone);
  const reads = api.getTablesState.mock.calls.length;

  await userEvent.click(done(floor)!);

  await vi.waitFor(() => expect(api.getTablesState.mock.calls.length).toBe(reads + 1));
  await vi.waitFor(() =>
    expect(el.shadowRoot!.querySelector(".error")?.textContent).toContain(said()),
  );
});
