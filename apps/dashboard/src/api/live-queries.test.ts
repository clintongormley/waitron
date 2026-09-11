import { expect, it, vi } from "vitest";
import { DashboardApi } from "./client.js";
import { dashboardQuery } from "./live-queries.js";

it("counts the initial screen read as activity and subsequent refreshes as passive", async () => {
  const fetchImpl = vi.fn<(path: string, init: RequestInit) => Promise<Response>>(
    async () => new Response("[]", { status: 200 }),
  );
  const active = vi.fn();
  const api = new DashboardApi("", fetchImpl, undefined, active);
  const query = dashboardQuery(api, "listPrinters", []);
  await query.read();
  expect(new Headers(fetchImpl.mock.calls[0]![1].headers).has("x-waitron-live")).toBe(false);
  await query.read();
  expect(new Headers(fetchImpl.mock.calls[1]![1].headers).get("x-waitron-live")).toBe("1");
  expect(active).toHaveBeenCalledOnce();
});

it.each([
  ["getOverdueOrders", [], "ticket_items"],
  ["getDailyClose", ["2026-09-11"], "sale_substitutions"],
  ["getDailyClose", ["2026-09-11"], "sale_lines"],
  ["getSalesPeriod", ["2026-09-01", "2026-09-11"], "sale_substitutions"],
  ["getPlannedVsActual", ["location", "2026-09-01", "2026-09-11"], "roster_versions"],
] as const)(
  "refreshes %s when its contributing %s query changes through %s",
  async (name, args, type) => {
    const fetchImpl = vi.fn(async () => new Response("[]"));
    const api = new DashboardApi("", fetchImpl);
    const observed = api.liveData.observe(dashboardQuery(api, name, [...args]), () => {});
    try {
      await vi.waitFor(() => expect(observed.snapshot.status).toBe("ready"));
      api.liveData.invalidate([{ type, id: "changed-elsewhere" }]);
      await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    } finally {
      observed.unsubscribe();
    }
  },
);
