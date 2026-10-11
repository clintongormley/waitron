import { afterEach, expect, vi } from "vitest";
import { applyTokens } from "@waitron/ui";
import { setLocale, type DashboardRequest } from "@waitron/dashboard-kit";
import type { DeleteImpact } from "@waitron/shared";
import { VenueServiceApi, type VenueServiceView } from "../src/dashboard/client.js";
import "../src/dashboard/department-dialogs.js";
export const view: VenueServiceView = {
  departments: [
    {
      id: "d1",
      name: "Restaurant",
      tradingName: "Casa",
      active: true,
    },
    { id: "d2", name: "Deli", tradingName: "Shop", active: true },
    {
      id: "d3",
      name: "Closed",
      tradingName: "Closed",
      active: false,
    },
  ],
  zones: [
    {
      id: "z1",
      name: "Patio",
      departmentId: "d1",
      departmentName: "Restaurant",
      serviceMode: "ticket_then_pay",
      active: true,
    },
  ],
  floorZones: [{ id: "z1", name: "Patio", active: true }],
  salePolicies: { departments: [], zones: [] },
  readiness: [],
  settings: { editSentLines: true },
  kitchenTicketGrouping: "combined",
  printHeldWork: false,
  releaseReminderMinutes: null,
  clearingWorkflow: false,
};

const hosts: HTMLElement[] = [];
afterEach(() => {
  hosts.splice(0).forEach((h) => h.remove());
  setLocale("en");
});
export const allowedImpact: DeleteImpact = {
  target: { id: "d1", name: "Restaurant" },
  refusals: [],
  ends: [],
  removes: [],
};
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
export async function mountDelete(
  overrides: Partial<VenueServiceApi> = {},
  theme = "light",
  kind: "department" | "zone" = "department",
) {
  setLocale("en");
  const host = document.createElement("div");
  applyTokens(host);
  host.dataset.theme = theme;
  document.body.append(host);
  hosts.push(host);
  const impact = {
    ...allowedImpact,
    target: kind === "zone" ? { id: "z1", name: "Patio" } : allowedImpact.target,
  };
  const request = vi.fn(async () => impact);
  const api = new VenueServiceApi(request as DashboardRequest);
  Object.assign(api, {
    watchDepartmentDeleteImpact: undefined,
    watchZoneDeleteImpact: undefined,
    getDepartmentDeleteImpact: vi.fn().mockResolvedValue(impact),
    getZoneDeleteImpact: vi.fn().mockResolvedValue(impact),
    deleteDepartment: vi.fn().mockResolvedValue(impact),
    deleteZone: vi.fn().mockResolvedValue(impact),
    ...overrides,
  });
  const screen = document.createElement("department-dialogs");
  screen.api = api;
  screen.model = structuredClone(view);
  host.append(screen);
  await screen.updateComplete;
  return { screen, host, api, request, kind };
}
export async function openDelete(
  screen: HTMLElementTagNameMap["department-dialogs"],
  kind: "department" | "zone" = "department",
) {
  screen.dialog =
    kind === "department"
      ? { kind: "delete-department", row: view.departments[0]! }
      : { kind: "delete-zone", row: view.floorZones[0]! };
  await screen.updateComplete;
  const dialog = screen.shadowRoot!.querySelector("wt-delete-dialog");
  expect(dialog).not.toBeNull();
  await dialog!.updateComplete;
  return dialog!;
}
