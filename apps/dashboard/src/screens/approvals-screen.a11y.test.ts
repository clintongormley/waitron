import { afterEach, describe, it, vi } from "vitest";
import { cleanupWidgets, expectNoA11yViolations, mountWidget } from "../widgets/test-helpers.js";
import "./approvals-screen.js";
import type { ApprovalsScreen } from "./approvals-screen.js";
import type { DashboardApi, PendingAbsence, PendingSwap, PersonSummary } from "../api/client.js";

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
const swaps: PendingSwap[] = [
  {
    id: "sw1",
    requestedByPersonId: "p1",
    fromShiftId: "s1",
    toPersonId: "p2",
    toShiftId: null,
    status: "accepted",
    createdAt: "2026-03-02T00:00:00Z",
  },
];
const absences: PendingAbsence[] = [
  {
    id: "ab1",
    personId: "p1",
    kind: "holiday",
    startsOn: "2026-03-02",
    endsOn: "2026-03-04",
    status: "requested",
    note: null,
    createdAt: "2026-03-02T00:00:00Z",
  },
];

function stubApi(withRows: boolean): DashboardApi {
  return {
    listStaff: vi.fn().mockResolvedValue(staff),
    listPendingSwaps: vi.fn().mockResolvedValue(withRows ? swaps : []),
    listPendingAbsences: vi.fn().mockResolvedValue(withRows ? absences : []),
  } as unknown as DashboardApi;
}
async function flush(el: ApprovalsScreen): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  await el.updateComplete;
}
afterEach(cleanupWidgets);

describe.each(["light", "dark"] as const)("approvals-screen a11y (%s theme)", (theme) => {
  it("renders accessibly with pending rows", async () => {
    const { el, host } = await mountWidget<ApprovalsScreen>(
      "dashboard-approvals-screen",
      { api: stubApi(true) },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });
  it("renders accessibly with empty queues", async () => {
    const { el, host } = await mountWidget<ApprovalsScreen>(
      "dashboard-approvals-screen",
      { api: stubApi(false) },
      theme,
    );
    await flush(el);
    await expectNoA11yViolations(host);
  });
});
