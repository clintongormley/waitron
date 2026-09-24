import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { DashboardApi, PersonSummary, PlannedVsActualRow } from "../api/client.js";
import { PlannedActualScreen } from "./planned-actual-screen.js";

const staff: PersonSummary[] = [
  {
    personId: "p1",
    displayName: "Ana",
    role: "staff",
    status: "active",
    hasPassword: false,
    hasTotp: false,
    email: null,
  },
];
const locations = [{ id: "loc-1", name: "Main" }];
const rows: PlannedVsActualRow[] = [
  {
    personId: "p1",
    workDate: "2026-03-02",
    plannedMinutes: 240,
    workedMinutes: 225,
    lateMinutes: 15,
    noShow: false,
    unplanned: false,
  },
];

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    getLocations: vi.fn().mockResolvedValue(locations),
    listStaff: vi.fn().mockResolvedValue(staff),
    getPlannedVsActual: vi.fn().mockResolvedValue(rows),
    ...overrides,
  } as unknown as DashboardApi;
}
async function flush(el: PlannedActualScreen): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}
// The location select is inside `<dashboard-location-picker>`'s shadow root.
const locationSelect = (el: PlannedActualScreen) =>
  el
    .shadowRoot!.querySelector("dashboard-location-picker")!
    .shadowRoot!.querySelector<HTMLSelectElement>("[data-test=location-select]")!;
afterEach(cleanupWidgets);

describe("planned-actual-screen", () => {
  it("loads locations, staff and the week's rows on connect, resolving the person name", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PlannedActualScreen>("dashboard-planned-actual-screen", {
      api,
    });
    await flush(el);
    expect(api.getLocations).toHaveBeenCalledTimes(1);
    expect(api.getPlannedVsActual).toHaveBeenCalledWith(
      "loc-1",
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
    expect(el.shadowRoot!.textContent).toContain("Ana");
    expect(el.shadowRoot!.textContent).toContain("240");
  });

  it("passes a Monday..Monday+7 half-open window (from = Monday, to = from + 7 days)", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PlannedActualScreen>("dashboard-planned-actual-screen", {
      api,
    });
    await flush(el);
    const week = el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=week-picker]")!;
    week.value = "2026-04-08"; // a Wednesday → Monday 2026-04-06, to 2026-04-13
    week.dispatchEvent(new Event("change"));
    await flush(el);
    expect(api.getPlannedVsActual).toHaveBeenLastCalledWith("loc-1", "2026-04-06", "2026-04-13");
  });

  it("reloads on a location change", async () => {
    const api = stubApi({
      getLocations: vi.fn().mockResolvedValue([
        { id: "loc-1", name: "Main" },
        { id: "loc-2", name: "Annex" },
      ]),
    });
    const { el } = await mountWidget<PlannedActualScreen>("dashboard-planned-actual-screen", {
      api,
    });
    await flush(el);
    const select = locationSelect(el);
    select.value = "loc-2";
    select.dispatchEvent(new Event("change"));
    await flush(el);
    expect(api.getPlannedVsActual).toHaveBeenLastCalledWith(
      "loc-2",
      expect.any(String),
      expect.any(String),
    );
  });

  it("shows the empty prompt when the week has no rows", async () => {
    const api = stubApi({ getPlannedVsActual: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<PlannedActualScreen>("dashboard-planned-actual-screen", {
      api,
    });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=empty]")).not.toBeNull();
  });

  it("shows the no-location prompt when the tenant has no locations", async () => {
    const api = stubApi({ getLocations: vi.fn().mockResolvedValue([]) });
    const { el } = await mountWidget<PlannedActualScreen>("dashboard-planned-actual-screen", {
      api,
    });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=no-location]")).not.toBeNull();
    expect(api.getPlannedVsActual).not.toHaveBeenCalled();
  });

  it("shows the error banner when a load rejects", async () => {
    const api = stubApi({
      getPlannedVsActual: vi.fn().mockRejectedValue({ code: "convenio.not_found" }),
    });
    const { el } = await mountWidget<PlannedActualScreen>("dashboard-planned-actual-screen", {
      api,
    });
    await flush(el);
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("convenio.not_found");
  });

  it("renders the no-show / unplanned flags, and the raw id when the person is unknown", async () => {
    const api = stubApi({
      getPlannedVsActual: vi.fn().mockResolvedValue([
        {
          personId: "ghost",
          workDate: "2026-03-03",
          plannedMinutes: 0,
          workedMinutes: 60,
          lateMinutes: 0,
          noShow: true,
          unplanned: true,
        },
      ]),
    });
    const { el } = await mountWidget<PlannedActualScreen>("dashboard-planned-actual-screen", {
      api,
    });
    await flush(el);
    const text = el.shadowRoot!.textContent ?? "";
    expect(text).toContain("Ausencia"); // planned.no_show, es
    expect(text).toContain("No previsto"); // planned.unplanned, es
    expect(text).toContain("ghost"); // raw id shown when the person is not in the staff list
  });

  it("ignores a cleared week input (Invalid Date) without reloading", async () => {
    const api = stubApi();
    const { el } = await mountWidget<PlannedActualScreen>("dashboard-planned-actual-screen", {
      api,
    });
    await flush(el);
    expect(api.getPlannedVsActual).toHaveBeenCalledTimes(1);
    const week = el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=week-picker]")!;
    week.value = "";
    week.dispatchEvent(new Event("change"));
    await flush(el);
    expect(api.getPlannedVsActual).toHaveBeenCalledTimes(1);
  });

  it("surfaces a rejected location change as the error banner", async () => {
    const api = stubApi({
      getLocations: vi.fn().mockResolvedValue([
        { id: "loc-1", name: "Main" },
        { id: "loc-2", name: "Annex" },
      ]),
      getPlannedVsActual: vi
        .fn()
        .mockResolvedValueOnce(rows) // initial connect load succeeds
        .mockRejectedValue({ code: "convenio.not_found" }), // the location-change load rejects
    });
    const { el } = await mountWidget<PlannedActualScreen>("dashboard-planned-actual-screen", {
      api,
    });
    await flush(el);
    const select = locationSelect(el);
    select.value = "loc-2";
    select.dispatchEvent(new Event("change"));
    await flush(el);
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("convenio.not_found");
  });

  it("surfaces a rejected week change as the error banner", async () => {
    const api = stubApi({
      getPlannedVsActual: vi
        .fn()
        .mockResolvedValueOnce(rows) // initial connect load succeeds
        .mockRejectedValue({ code: "convenio.not_found" }), // the week-change load rejects
    });
    const { el } = await mountWidget<PlannedActualScreen>("dashboard-planned-actual-screen", {
      api,
    });
    await flush(el);
    const week = el.shadowRoot!.querySelector<HTMLInputElement>("[data-test=week-picker]")!;
    week.value = "2026-04-08";
    week.dispatchEvent(new Event("change"));
    await flush(el);
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("convenio.not_found");
  });

  it("falls back to server.internal when a thrown error carries no code", async () => {
    const api = stubApi({ getLocations: vi.fn().mockRejectedValue(new Error("network down")) });
    const { el } = await mountWidget<PlannedActualScreen>("dashboard-planned-actual-screen", {
      api,
    });
    await flush(el);
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("server.internal");
  });

  it("preserves the selected location across a disconnect/reconnect", async () => {
    // Keeping a still-valid selection is reachable only across a reconnect: on the first connect
    // there is no selection yet.
    const api = stubApi({
      getLocations: vi.fn().mockResolvedValue([
        { id: "loc-1", name: "Main" },
        { id: "loc-2", name: "Annex" },
      ]),
    });
    const { el, host } = await mountWidget<PlannedActualScreen>("dashboard-planned-actual-screen", {
      api,
    });
    await flush(el);
    const select = locationSelect(el);
    select.value = "loc-2";
    select.dispatchEvent(new Event("change"));
    await flush(el);

    el.remove(); // disconnectedCallback
    host.appendChild(el); // connectedCallback → #load re-runs with loc-2 still selected
    await flush(el);

    expect(api.getPlannedVsActual).toHaveBeenLastCalledWith(
      "loc-2",
      expect.any(String),
      expect.any(String),
    );
    const reselect = locationSelect(el);
    expect(reselect.value).toBe("loc-2");
  });
});

it("refreshes displayed rows when their data changes elsewhere", async () => {
  const liveData = new LiveData();
  const api = Object.assign(stubApi(), { liveData });
  const { el } = await mountWidget<HTMLElement & { api: DashboardApi }>(
    "dashboard-planned-actual-screen",
    { api },
  );
  const rows = (): unknown[] => (el as unknown as Record<string, unknown[]>)["rows"]!;
  await vi.waitFor(() => expect(rows()?.length).toBeGreaterThan(0));
  vi.mocked(api.getPlannedVsActual).mockResolvedValue([]);
  liveData.invalidate([{ type: "shifts", id: "changed-elsewhere" }]);
  await vi.waitFor(() => expect(rows()).toEqual([]));
  expect(api.getPlannedVsActual).toHaveBeenCalledTimes(2);
});

describe("planned-actual-screen — location refreshes", () => {
  const twoLocations = [
    { id: "loc-1", name: "Main" },
    { id: "loc-2", name: "Annex" },
  ];

  it("moves to a remaining location when a refresh removes the selected one", async () => {
    const liveData = new LiveData();
    const api = Object.assign(stubApi({ getLocations: vi.fn().mockResolvedValue(twoLocations) }), {
      liveData,
    });
    const { el } = await mountWidget<PlannedActualScreen>("dashboard-planned-actual-screen", {
      api,
    });
    await flush(el);
    const select = locationSelect(el);
    select.value = "loc-2";
    select.dispatchEvent(new Event("change"));
    await flush(el);
    expect(api.getPlannedVsActual).toHaveBeenLastCalledWith(
      "loc-2",
      expect.any(String),
      expect.any(String),
    );
    vi.mocked(api.getLocations).mockResolvedValue([
      { id: "loc-1", name: "Main" },
      { id: "loc-3", name: "Terrace" },
    ]);
    liveData.invalidate([{ type: "locations", id: "loc-2" }]);
    await vi.waitFor(() =>
      expect(api.getPlannedVsActual).toHaveBeenLastCalledWith(
        "loc-1",
        expect.any(String),
        expect.any(String),
      ),
    );
    expect(locationSelect(el).value).toBe("loc-1");
  });

  // The rows query depends on locations itself, so the refresh re-reads it once on its own; the
  // screen must not start a second load for a location it already shows.
  it("keeps the selected location, re-reading its rows once, when a refresh still lists it", async () => {
    const liveData = new LiveData();
    const api = Object.assign(stubApi({ getLocations: vi.fn().mockResolvedValue(twoLocations) }), {
      liveData,
    });
    const { el } = await mountWidget<PlannedActualScreen>("dashboard-planned-actual-screen", {
      api,
    });
    await flush(el);
    const select = locationSelect(el);
    select.value = "loc-2";
    select.dispatchEvent(new Event("change"));
    await flush(el);
    const rowLoads = vi.mocked(api.getPlannedVsActual).mock.calls.length;
    vi.mocked(api.getLocations).mockResolvedValue([
      ...twoLocations,
      { id: "loc-3", name: "Terrace" },
    ]);
    liveData.invalidate([{ type: "locations", id: "loc-3" }]);
    await vi.waitFor(() => expect(api.getLocations).toHaveBeenCalledTimes(2));
    await flush(el);
    await flush(el);
    const since = vi.mocked(api.getPlannedVsActual).mock.calls.slice(rowLoads);
    expect(since.map(([locationId]) => locationId)).toEqual(["loc-2"]);
    expect(locationSelect(el).value).toBe("loc-2");
  });
});
