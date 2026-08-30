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
    const select = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=location-select]")!;
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
    // A flagged row whose personId is NOT in the staff list: covers both flag branches (no-show +
    // unplanned) and the `#name` fallback to the raw id when a row references someone off-list.
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
    week.value = ""; // <input type=date> cleared → `Date.parse` is NaN → the handler bails
    week.dispatchEvent(new Event("change"));
    await flush(el);
    expect(api.getPlannedVsActual).toHaveBeenCalledTimes(1); // no extra load
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
    const select = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=location-select]")!;
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
    // The `?? "server.internal"` arm: a codeless rejection (a bare Error / network fault) must still
    // land a readable banner rather than an empty one.
    const api = stubApi({ getLocations: vi.fn().mockRejectedValue(new Error("network down")) });
    const { el } = await mountWidget<PlannedActualScreen>("dashboard-planned-actual-screen", {
      api,
    });
    await flush(el);
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("server.internal");
  });

  it("preserves the selected location across a disconnect/reconnect", async () => {
    // `#load` runs on every connect; its `some(...)` guard keeps a still-valid selection rather than
    // snapping back to the first location. Reachable only across a reconnect (on the first connect the
    // selection is empty), so exercise the guard's keep-branch by removing and re-appending the element.
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
    const select = el.shadowRoot!.querySelector<HTMLSelectElement>("[data-test=location-select]")!;
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
    const reselect = el.shadowRoot!.querySelector<HTMLSelectElement>(
      "[data-test=location-select]",
    )!;
    expect(reselect.value).toBe("loc-2");
  });
});
