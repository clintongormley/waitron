import { expect, it, vi } from "vitest";
import { DashboardApi } from "./client.js";
it("uses passive status and encoded preview reads, and an active exact confirmation body", async () => {
  const view = { eligible: true, clockRevision: 4 };
  const fetchImpl = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(view), { headers: { "content-type": "application/json" } }),
  );
  const api = new DashboardApi("", fetchImpl);
  expect(await api.getVenueZoneRepair()).toEqual(view);
  expect(await api.getVenueZoneRepair("Atlantic/Canary")).toEqual(view);
  await api.background.confirmVenueZone({
    timeZone: "Atlantic/Canary",
    expectedClockRevision: 4,
    confirmed: true,
  });
  expect(fetchImpl.mock.calls.map(([path]) => path)).toEqual([
    "/management-api/venue-details/time-zone-repair",
    "/management-api/venue-details/time-zone-repair?timeZone=Atlantic%2FCanary",
    "/management-api/venue-details/time-zone-repair",
  ]);
  const requests = fetchImpl.mock.calls as unknown as [string, RequestInit][];
  expect(requests.map(([, init]) => init.method)).toEqual(["GET", "GET", "POST"]);
  for (const [, init] of requests.slice(0, 2))
    expect(new Headers(init.headers).get("x-waitron-live")).toBe("1");
  expect(new Headers(requests[2]![1].headers).get("x-waitron-live")).toBeNull();
  expect(JSON.parse(requests[2]![1].body as string)).toEqual({
    timeZone: "Atlantic/Canary",
    expectedClockRevision: 4,
    confirmed: true,
  });
});
