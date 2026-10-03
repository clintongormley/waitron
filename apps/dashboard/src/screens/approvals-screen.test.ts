import { LiveData } from "@waitron/dashboard-kit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupWidgets, mountWidget } from "../widgets/test-helpers.js";
import { codeMessage } from "../i18n/codes.js";
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
    email: null,
  },
  {
    personId: "p2",
    displayName: "Beto",
    role: "staff",
    status: "active",
    hasPassword: false,
    hasTotp: false,
    email: null,
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
    expect(api.listPendingSwaps).toHaveBeenCalledTimes(2); // both queues reloaded via #loadQueues
    expect(api.listPendingAbsences).toHaveBeenCalledTimes(2);
    // A decide reloads only the queues: staff is fetched once on connect and NOT refetched.
    expect(api.listStaff).toHaveBeenCalledTimes(1);
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
    // A rejected decide must surface its code as the banner and release the single-flight `busy`
    // gate, so a following decide is NOT dropped.
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

it("refreshes displayed absences when their data changes elsewhere", async () => {
  const liveData = new LiveData();
  const api = Object.assign(stubApi(), { liveData });
  const { el } = await mountWidget<HTMLElement & { api: DashboardApi }>(
    "dashboard-approvals-screen",
    { api },
  );
  const rows = (): unknown[] => (el as unknown as Record<string, unknown[]>)["absences"]!;
  await vi.waitFor(() => expect(rows()?.length).toBeGreaterThan(0));
  vi.mocked(api.listPendingAbsences).mockResolvedValue([]);
  liveData.invalidate([{ type: "absences", id: "changed-elsewhere" }]);
  await vi.waitFor(() => expect(rows()).toEqual([]));
  expect(api.listPendingAbsences).toHaveBeenCalledTimes(2);
});

describe("approvals-screen — remaining decisions", () => {
  it("rejects a swap → calls decideSwap with 'rejected' and reloads the queues", async () => {
    const api = stubApi();
    const { el } = await mountWidget<ApprovalsScreen>("dashboard-approvals-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=reject-swap-sw1]")!.click();
    await flush(el);
    expect(api.decideSwap).toHaveBeenCalledExactlyOnceWith("sw1", "rejected");
    expect(api.listPendingSwaps).toHaveBeenCalledTimes(2);
  });

  it("approves an absence → calls decideAbsence with 'approved' and reloads the queues", async () => {
    const api = stubApi();
    const { el } = await mountWidget<ApprovalsScreen>("dashboard-approvals-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=approve-absence-ab1]")!.click();
    await flush(el);
    expect(api.decideAbsence).toHaveBeenCalledExactlyOnceWith("ab1", "approved");
    expect(api.listPendingAbsences).toHaveBeenCalledTimes(2);
  });

  it("files at most one absence decision when two buttons are clicked together", async () => {
    const api = stubApi();
    const { el } = await mountWidget<ApprovalsScreen>("dashboard-approvals-screen", { api });
    await flush(el);
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=approve-absence-ab1]")!.click();
    el.shadowRoot!.querySelector<HTMLElement>("[data-test=reject-absence-ab1]")!.click();
    await flush(el);
    expect(api.decideAbsence).toHaveBeenCalledExactlyOnceWith("ab1", "approved");
  });
});

describe("approvals-screen — recovery after the server answers again", () => {
  const errorText = (el: ApprovalsScreen) =>
    el.shadowRoot!.querySelector("[data-test=error]")?.textContent?.trim();

  it("clears a failed refresh's message once the server answers again", async () => {
    const liveData = new LiveData();
    const api = Object.assign(stubApi(), { liveData });
    const { el } = await mountWidget<ApprovalsScreen>("dashboard-approvals-screen", { api });
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=approve-swap-sw1]")).not.toBeNull(),
    );
    vi.mocked(api.listPendingSwaps).mockRejectedValue({ code: "connection.failed" });
    liveData.refresh();
    await vi.waitFor(() => expect(errorText(el)).toBe(codeMessage("connection.failed")));
    vi.mocked(api.listPendingSwaps).mockResolvedValue([swap]);
    liveData.refresh();
    await vi.waitFor(() => expect(errorText(el)).toBeUndefined());
    expect(el.shadowRoot!.querySelector("[data-test=approve-swap-sw1]")).not.toBeNull();
  });

  it("loads both queues once the staff read that failed on opening succeeds", async () => {
    const liveData = new LiveData();
    const api = Object.assign(
      stubApi({
        listStaff: vi
          .fn()
          .mockRejectedValueOnce({ code: "connection.failed" })
          .mockResolvedValue(staff),
      }),
      { liveData },
    );
    const { el } = await mountWidget<ApprovalsScreen>("dashboard-approvals-screen", { api });
    await vi.waitFor(() => expect(errorText(el)).toBe(codeMessage("connection.failed")));
    expect(api.listPendingSwaps).not.toHaveBeenCalled();
    liveData.refresh();
    await vi.waitFor(() =>
      expect(el.shadowRoot!.querySelector("[data-test=approve-swap-sw1]")).not.toBeNull(),
    );
    const text = el.shadowRoot!.textContent ?? "";
    expect(text).toContain("Ana");
    expect(text).toContain("Vacaciones");
    expect(errorText(el)).toBeUndefined();
  });

  it("reads the queues again when reattached while the staff read fails, once it succeeds", async () => {
    const liveData = new LiveData();
    const api = Object.assign(stubApi(), { liveData });
    const { el, host } = await mountWidget<ApprovalsScreen>("dashboard-approvals-screen", { api });
    await vi.waitFor(() => expect(api.listPendingSwaps).toHaveBeenCalledOnce());
    el.remove();
    vi.mocked(api.listStaff).mockRejectedValueOnce({ code: "connection.failed" });
    host.appendChild(el);
    await vi.waitFor(() => expect(errorText(el)).toBe(codeMessage("connection.failed")));
    liveData.refresh();
    await vi.waitFor(() => expect(api.listPendingSwaps).toHaveBeenCalledTimes(2));
    expect(api.listPendingAbsences).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(errorText(el)).toBeUndefined());
  });

  it.each(["connection.failed", "server.internal"])(
    "keeps a failed decision's message through a re-read failing with %s and the reads' recovery",
    async (rereadCode) => {
      const liveData = new LiveData();
      const api = Object.assign(
        stubApi({ decideSwap: vi.fn().mockRejectedValue({ code: "connection.failed" }) }),
        { liveData },
      );
      const { el } = await mountWidget<ApprovalsScreen>("dashboard-approvals-screen", { api });
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector("[data-test=approve-swap-sw1]")).not.toBeNull(),
      );
      vi.mocked(api.listPendingSwaps).mockRejectedValue({ code: "connection.failed" });
      liveData.refresh();
      await vi.waitFor(() => expect(errorText(el)).toBe(codeMessage("connection.failed")));
      el.shadowRoot!.querySelector<HTMLElement>("[data-test=approve-swap-sw1]")!.click();
      await vi.waitFor(() => expect(api.decideSwap).toHaveBeenCalledOnce());
      await flush(el);
      vi.mocked(api.listPendingSwaps).mockRejectedValue({ code: rereadCode });
      liveData.refresh();
      await vi.waitFor(() => expect(api.listPendingSwaps).toHaveBeenCalledTimes(3));
      await flush(el);
      vi.mocked(api.listPendingSwaps).mockResolvedValue([swap, { ...swap, id: "sw2" }]);
      liveData.refresh();
      await vi.waitFor(() =>
        expect(el.shadowRoot!.querySelector("[data-test=swap-sw2]")).not.toBeNull(),
      );
      await flush(el);
      expect(errorText(el)).toBe(codeMessage("connection.failed"));
    },
  );
});
