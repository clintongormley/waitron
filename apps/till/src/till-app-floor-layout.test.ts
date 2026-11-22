import { afterEach, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { emit, party } from "../test/allergy-app-fixture.js";
import { deviceZonesFixture } from "../test/device-zones.js";
import { cleanupWidgets, mountWidget } from "./widgets/test-helpers.js";
import { currentLocale, setLocale } from "./i18n/t.js";
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

const offered: FloorZone = {
  id: "z1",
  name: "Room",
  displayOrder: 0,
  active: true,
  closesAt: null,
  closed: false,
  hasPlan: true,
  layoutSetName: "Lunch",
  layoutDue: { setId: "set-dinner", revision: 3, periodName: "Dinner" },
  serviceMode: "table_tab",
};
const updated: FloorZone = { ...offered, layoutSetName: "Dinner", layoutDue: null };

const placed: TableState = {
  id: "t1",
  label: "1",
  shortName: "1",
  zoneId: "z1",
  state: "free",
  condition: "free",
  hasOpenTab: false,
  pendingDeliveries: 0,
  pendingToServe: 0,
  readyToServe: 0,
  timingBand: "fresh",
  nextReservation: null,
  today: {
    placement: { x: 2, y: 3, width: 8, height: 8, shape: "rect", rotation: 0 },
    seats: 4,
    fixed: false,
    takenOff: false,
    joinId: null,
    joinSeats: null,
    zoneRevision: 5,
  },
  signals: [],
  party: null,
};

async function mount(over: Record<string, unknown>) {
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
    getTablesState: vi.fn().mockResolvedValue([placed]),
    logout: vi.fn().mockResolvedValue(undefined),
    putLocale: vi.fn().mockResolvedValue(undefined),
    ...over,
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
    expect(floor()?.shadowRoot?.querySelector("[data-layout-due]")).toBeTruthy(),
  );
  return { el, floor: floor()!, api };
}

const banner = (floor: TillFloorScreen) => floor.shadowRoot!.querySelector("[data-layout-due]");

it.each(["drag", "Join with"])(
  "%s lets staff take over the blocked draft before retrying",
  async (entry) => {
    const blockedParty = entry === "drag" ? "p2" : "p1";
    const original = { billId: "b2", editorVersion: 7, draftId: "d2", draftRevision: 3 };
    const conflict = { ...original, editorId: "luis", editorName: "Luis" };
    const own = { billId: "b1", editorVersion: 2, draftId: "d1", draftRevision: 1 };
    const newEdit = { ...original, editorVersion: 8 };
    let received = conflict;
    const rows = [
      { ...placed, party: party({ id: "p1", tableIds: ["t1"] }) },
      {
        ...placed,
        id: "t2",
        label: "2",
        shortName: "2",
        today: { ...placed.today!, placement: { ...placed.today!.placement, x: 20 } },
        party: party({ id: "p2", tableIds: ["t2"] }),
      },
    ];
    const joinTables = vi
      .fn<TillApi["joinTables"]>()
      .mockRejectedValueOnce({ code: "draft.taken_over", conflicts: [conflict] })
      .mockResolvedValue({} as Awaited<ReturnType<TillApi["joinTables"]>>);
    const takeOverDraft = vi.fn(async () => {
      received = { ...newEdit, editorId: "person", editorName: "Ana" };
    });
    const { el, floor } = await mount({
      listZones: vi.fn().mockResolvedValue([offered]),
      getTablesState: vi.fn().mockResolvedValue(rows),
      listDrafts: vi.fn(async (id: string) => ({
        drafts: [],
        billEdits:
          id === blockedParty ? [received] : [{ ...own, editorId: "person", editorName: "Ana" }],
      })),
      joinTables,
      takeOverDraft,
    });
    const root = floor.shadowRoot!;
    const join = async () => {
      const map = root.querySelector("wt-floor-map")!;
      if (entry === "drag") {
        emit(map, "wt-table-drag-end", { tableId: "t1", x: 17, y: 3, targetId: "t2" });
      } else {
        emit(map, "wt-table-details", { tableId: "t1" });
        await floor.updateComplete;
        const sheet = root.querySelector("till-table-details-sheet")!;
        await sheet.updateComplete;
        await userEvent.click(
          sheet.shadowRoot!.querySelector<HTMLElement>('[data-today-action="join-with"]')!,
        );
        const choices = root.querySelector("till-join-with-dialog")!;
        emit(choices, "join-with-pick", { tableId: "t1", targetId: "t2" });
        emit(choices, "join-with-close");
      }
      await vi.waitFor(() => expect(root.querySelector("till-today-seats-dialog")).not.toBeNull());
      emit(root.querySelector("till-today-seats-dialog")!, "today-seats-confirm", { seats: 4 });
    };
    await join();
    await vi.waitFor(() => expect(joinTables).toHaveBeenCalledOnce());
    const prompt = () => el.shadowRoot!.querySelector("till-bill-edit-conflicts-dialog");
    await vi.waitFor(() => expect(prompt()).not.toBeNull());
    expect(root.querySelector("[data-floor-refusal]")).toBeNull();
    const buttons = prompt()!.shadowRoot!;
    await userEvent.click(buttons.querySelector<HTMLElement>('[data-split-take-over="b2"]')!);
    await userEvent.click(buttons.querySelector<HTMLElement>("[data-confirm-take-over]")!);
    expect(takeOverDraft).toHaveBeenCalledExactlyOnceWith(
      blockedParty,
      "d2",
      { revision: 3, expectedEdit: original, submissionId: expect.any(String) },
      { signal: expect.any(AbortSignal) },
    );
    await userEvent.click(buttons.querySelector<HTMLElement>("[data-finish-conflicts]")!);
    await vi.waitFor(() => expect(prompt()).toBeNull());
    expect(joinTables).toHaveBeenCalledOnce();
    await join();
    await vi.waitFor(() => expect(joinTables).toHaveBeenCalledTimes(2));
    expect(joinTables.mock.calls[1]?.[2].expectedEdits).toEqual([own, newEdit]);
  },
);

async function press(floor: TillFloorScreen): Promise<void> {
  floor.shadowRoot!.querySelector<HTMLElement>("[data-update-layout]")!.click();
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await floor.updateComplete;
  }
}

it("re-reads the zones and the tables after Update layout, so the banner goes at once", async () => {
  const listZones = vi.fn().mockResolvedValueOnce([offered]).mockResolvedValue([updated]);
  const updateLayoutToday = vi.fn().mockResolvedValue({ zoneId: "z1", revision: 6 });
  const { floor, api } = await mount({ listZones, updateLayoutToday });
  const zoneReads = listZones.mock.calls.length;
  const tableReads = api.getTablesState.mock.calls.length;
  await press(floor);
  expect(updateLayoutToday).toHaveBeenCalledExactlyOnceWith(
    "z1",
    { setId: "set-dinner", revision: 3 },
    5,
  );
  expect(listZones.mock.calls.length).toBe(zoneReads + 1);
  expect(api.getTablesState.mock.calls.length).toBe(tableReads + 1);
  expect(banner(floor)).toBeNull();
});

it("sends null for a room the tables read holds none of, and the banner goes after the update", async () => {
  const listZones = vi.fn().mockResolvedValueOnce([offered]).mockResolvedValue([updated]);
  const updateLayoutToday = vi.fn().mockResolvedValue({ zoneId: "z1", revision: 2 });
  const { floor } = await mount({
    listZones,
    updateLayoutToday,
    getTablesState: vi.fn().mockResolvedValue([]),
  });
  await press(floor);
  expect(updateLayoutToday).toHaveBeenCalledExactlyOnceWith(
    "z1",
    { setId: "set-dinner", revision: 3 },
    null,
  );
  expect(banner(floor)).toBeNull();
});

it("re-reads both after a layout_changed refusal and shows what is now due", async () => {
  const later = { ...offered, layoutDue: { setId: "set-late", revision: 1, periodName: "Late" } };
  const listZones = vi.fn().mockResolvedValueOnce([offered]).mockResolvedValue([later]);
  const updateLayoutToday = vi
    .fn()
    .mockRejectedValue({ code: "floor_today.layout_changed", zoneId: "z1" });
  const { floor, api } = await mount({ listZones, updateLayoutToday });
  const tableReads = api.getTablesState.mock.calls.length;
  await press(floor);
  expect(api.getTablesState.mock.calls.length).toBe(tableReads + 1);
  expect(banner(floor)!.querySelector('[role="status"]')!.textContent!.trim()).toBe(
    "Late layout is ready.",
  );
  expect(floor.shadowRoot!.querySelector("[data-floor-refusal]")!.textContent!.trim()).toBe(
    codeMessage("floor_today.layout_changed"),
  );
});

it("re-reads the zones after Reset to … plan, so a banner offering only that set's edit goes at once", async () => {
  const edited: FloorZone = {
    ...offered,
    layoutSetName: "Dinner",
    layoutDue: { setId: "set-dinner", revision: 4, periodName: null },
  };
  const listZones = vi.fn().mockResolvedValueOnce([edited]).mockResolvedValue([updated]);
  const resetZoneToday = vi.fn().mockResolvedValue({ zoneId: "z1", revision: 6 });
  const { floor } = await mount({ listZones, resetZoneToday });
  expect(banner(floor)!.querySelector('[role="status"]')!.textContent!.trim()).toBe(
    "A newer layout is ready.",
  );
  const zoneReads = listZones.mock.calls.length;
  floor
    .shadowRoot!.querySelector("till-floor-zone-menu")!
    .dispatchEvent(
      new CustomEvent("zone-reset", { detail: { zoneId: "z1" }, bubbles: true, composed: true }),
    );
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await floor.updateComplete;
  }
  expect(resetZoneToday).toHaveBeenCalledExactlyOnceWith("z1", 5);
  expect(listZones.mock.calls.length).toBe(zoneReads + 1);
  expect(banner(floor)).toBeNull();
});
