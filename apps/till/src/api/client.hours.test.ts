import { expect, it, vi } from "vitest";
import { TillApi } from "./client.js";
import type { HoursSelection, PersonHours } from "@waitron/workforce/attendance-contract";
const selection: HoursSelection = { kind: "month", date: "2026-10-25" };
const body: PersonHours = {
  personId: "ana",
  locationId: "old/location",
  selection,
  period: { start: "2026-10-01", end: "2026-11-01" },
  businessDay: "2026-10-31",
  clock: { timeZone: "Europe/Madrid", dayCutover: "05:00", cutoverChanges: [] },
  asOf: "2026-10-31T23:30:00Z",
  days: [],
  workedMinutes: 0,
  record: { sessions: [], entries: [], closures: [], closedPeriodImpacts: [] },
  openShifts: [],
  pending: { prompts: [], items: [], automaticEntryIds: [] },
  closures: [],
};
it.each([selection, { kind: "week" as const }])(
  "reads the exact hours scope with cancellation and credentials: %j",
  async (selected) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ ...body, selection: selected })));
    const api = new TillApi("https://box.test", fetcher);
    expect(api).toHaveProperty("getHours", expect.any(Function));
    const signal = new AbortController().signal;
    expect(await api.getHours("old/location", selected, { signal })).toEqual({
      ...body,
      selection: selected,
    });
    expect(fetcher.mock.calls).toEqual([
      [
        `https://box.test/api/attendance/hours?locationId=old%2Flocation&kind=${selected.kind}${selected.date === undefined ? "" : "&date=2026-10-25"}`,
        { method: "GET", credentials: "include", signal },
      ],
    ]);
  },
);
it("keeps a read refusal structured and never invents a write or a retry", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        error: { code: "attendance.not_permitted", params: { personId: "ana" } },
      }),
      { status: 403 },
    ),
  );
  const api = new TillApi("", fetcher);
  expect(api).toHaveProperty("getHours", expect.any(Function));
  await expect(api.getHours("venue", { kind: "week" })).rejects.toEqual({
    code: "attendance.not_permitted",
    status: 403,
    personId: "ana",
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]![1]!.method).toBe("GET");
});
