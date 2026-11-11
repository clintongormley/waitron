import { vi } from "vitest";
import { LiveData } from "@waitron/dashboard-kit";
import type { DashboardApi } from "../api/client.js";
export function modulesClient(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    liveData: new LiveData(),
    listModules: vi.fn().mockResolvedValue([
      { id: "workforce", category: "module", enabled: true },
      { id: "workforce-es", category: "module", enabled: false },
      { id: "payments", category: "module", enabled: true },
      { id: "bookings", category: "module", enabled: false },
      { id: "staffing", category: "module", enabled: true },
      { id: "sumup", category: "card-provider", enabled: true },
      { id: "stripe", category: "card-provider", enabled: true },
    ]),
    listPaymentProviders: vi.fn().mockResolvedValue([
      { providerId: "sumup", state: "connected", canUnpair: true },
      { providerId: "stripe", state: "not_connected", canUnpair: false },
    ]),
    ...overrides,
  } as unknown as DashboardApi;
}
