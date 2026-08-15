import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import type { DashboardApi, PendingAbsence, PendingSwap, PersonSummary } from "../api/client.js";
import { ApprovalsScreen } from "./approvals-screen.js";

const staff: PersonSummary[] = [
  {
    personId: "p1",
    displayName: "Ana",
    role: "staff",
    status: "active",
    hasPassword: false,
    hasTotp: false,
  },
  {
    personId: "p2",
    displayName: "Beto",
    role: "staff",
    status: "active",
    hasPassword: false,
    hasTotp: false,
  },
];
const swap: PendingSwap = {
  id: "sw1",
  requestedByPersonId: "p1",
  fromShiftId: "s1",
  toPersonId: "p2",
  toShiftId: null,
  status: "accepted",
  createdAt: "2026-03-02T00:00:00Z",
};
const absence: PendingAbsence = {
  id: "ab1",
  personId: "p1",
  kind: "holiday",
  startsOn: "2026-03-02",
  endsOn: "2026-03-04",
  status: "requested",
  note: "trip",
  createdAt: "2026-03-02T00:00:00Z",
};

function stubApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    listStaff: vi.fn().mockResolvedValue(staff),
    listPendingSwaps: vi.fn().mockResolvedValue([swap]),
    listPendingAbsences: vi.fn().mockResolvedValue([absence]),
    decideSwap: vi.fn().mockResolvedValue(undefined),
    decideAbsence: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as DashboardApi;
}
async function flush(el: ApprovalsScreen): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}
afterEach(cleanupWidgets);

describe("approvals-screen", () => {
  it("loads and renders the two queues, resolving person names via listStaff", async () => {
    const api = stubApi();
    const { el } = await mountWidget<ApprovalsScreen>("dashboard-approvals-screen", { api });
    await flush(el);
    expect(api.listPendingSwaps).toHaveBeenCalledTimes(1);
    expect(api.listPendingAbsences).toHaveBeenCalledTimes(1);
    const text = el.shadowRoot!.textContent ?? "";
    expect(text).toContain("Ana"); // requester name resolved
    expect(text).toContain("Vacaciones"); // absence kind, es
  });

  it("approves a swap → calls decideSwap and reloads both queues", async () => {
    const api = stubApi();
    const { el } = await mountWidget<ApprovalsScreen>("dashboard-approvals-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=approve-swap-sw1]")!.click();
    await flush(el);
    expect(api.decideSwap).toHaveBeenCalledWith("sw1", "approved");
    expect(api.listPendingSwaps).toHaveBeenCalledTimes(2); // reloaded
  });

  it("rejects an absence → calls decideAbsence with 'rejected'", async () => {
    const api = stubApi();
    const { el } = await mountWidget<ApprovalsScreen>("dashboard-approvals-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=reject-absence-ab1]")!.click();
    await flush(el);
    expect(api.decideAbsence).toHaveBeenCalledWith("ab1", "rejected");
  });

  it("files at most one decide when a button is double-clicked (single-flight)", async () => {
    const api = stubApi();
    const { el } = await mountWidget<ApprovalsScreen>("dashboard-approvals-screen", { api });
    await flush(el);
    const btn = el.shadowRoot!.querySelector<HTMLElement>("[data-test=approve-swap-sw1]")!;
    btn.click();
    btn.click();
    await flush(el);
    expect(api.decideSwap).toHaveBeenCalledTimes(1);
  });

  it("shows the empty prompts when both queues are empty", async () => {
    const api = stubApi({
      listPendingSwaps: vi.fn().mockResolvedValue([]),
      listPendingAbsences: vi.fn().mockResolvedValue([]),
    });
    const { el } = await mountWidget<ApprovalsScreen>("dashboard-approvals-screen", { api });
    await flush(el);
    expect(el.shadowRoot!.querySelector("[data-test=no-swaps]")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("[data-test=no-absences]")).not.toBeNull();
  });

  it("shows the error banner when a load rejects", async () => {
    const api = stubApi({
      listPendingSwaps: vi.fn().mockRejectedValue({ code: "management_session.required" }),
    });
    const { el } = await mountWidget<ApprovalsScreen>("dashboard-approvals-screen", { api });
    await flush(el);
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe(
      "management_session.required",
    );
  });

  it("surfaces a rejected decide as the error banner and releases busy for a retry", async () => {
    // The decide handlers' catch path (both #decideSwap and #decideAbsence): a rejected decide must
    // surface the thrown code as the errorKey banner and release the single-flight `busy` gate in the
    // `finally`, so a following decide is NOT dropped. The route codes ride through verbatim (a code
    // absent would fall back to server.internal via the ?? arm).
    const api = stubApi({
      decideSwap: vi.fn().mockRejectedValue({ code: "swap.not_decidable" }),
      decideAbsence: vi.fn().mockRejectedValue({ code: "absence.not_found" }),
    });
    const { el } = await mountWidget<ApprovalsScreen>("dashboard-approvals-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=approve-swap-sw1]")!.click();
    await flush(el);
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("swap.not_decidable");
    // busy was released in the finally, so this second decide fires rather than being single-flighted
    // away — proven both by decideAbsence being called and by the banner switching to its code.
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=reject-absence-ab1]")!.click();
    await flush(el);
    expect(api.decideAbsence).toHaveBeenCalledWith("ab1", "rejected");
    expect((el as unknown as { errorKey: string | null }).errorKey).toBe("absence.not_found");
  });
});
