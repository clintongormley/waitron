import { afterEach, expect, it } from "vitest";
import { createRequest, LiveData, type FetchLike } from "@waitron/dashboard-kit";
import type { OwnAttendanceCommand, AttendanceDayView } from "@waitron/dashboard-modules";
const modules = import.meta.glob<typeof import("./own-attendance.js")>("./own-attendance.ts");
const caches: LiveData[] = [];
afterEach(() => {
  for (const cache of caches.splice(0)) cache.clear();
});
const command: OwnAttendanceCommand = {
  action: "accept",
  commandId: "chosen-uuid",
  expectedRevision: "current-revision",
  itemId: "proposal-uuid",
};
const saved = { commandId: command.commandId, entryIds: ["answer"], replayed: false };
const day: AttendanceDayView = {
  personId: "worker",
  locationId: "place",
  date: "2026-01-05",
  timeZone: "Europe/Madrid",
  revision: "current-revision",
  record: { sessions: [], entries: [], closures: [], closedPeriodImpacts: [] },
  items: [],
};
async function client(
  respond: (path: string, init: RequestInit) => unknown = () => saved,
  cache?: LiveData,
) {
  const load = modules["./own-attendance.ts"];
  expect(load, "own attendance client").toBeTypeOf("function");
  const { OwnAttendanceApi } = await load!();
  const calls: { path: string; init: RequestInit }[] = [],
    activity: string[] = [];
  const fetchImpl: FetchLike = async (path, init) => {
    calls.push({ path, init });
    const result = respond(path, init);
    return result instanceof Response ? result : new Response(JSON.stringify(result));
  };
  return {
    api: new OwnAttendanceApi(
      createRequest({ baseUrl: "/box", fetchImpl, onSuccess: (path) => activity.push(path) }),
      cache,
    ),
    calls,
    activity,
  };
}
it("own day and requester receipt GETs are passive while the exact command POST is active", async () => {
  const { api, calls, activity } = await client((path) => (path.includes("/day?") ? day : saved));
  expect(await api.day("place", day.date)).toEqual(day);
  expect(await api.command("uuid/encode")).toEqual(saved);
  expect(await api.send(command)).toEqual(saved);
  expect(calls.map((c) => c.path)).toEqual([
    "/box/management-api/me/attendance/day?locationId=place&date=2026-01-05",
    "/box/management-api/me/attendance/commands/uuid%2Fencode",
    "/box/management-api/me/attendance/commands",
  ]);
  for (const { init } of calls.slice(0, 2)) {
    expect(new Headers(init.headers).get("x-waitron-live")).toBe("1");
    expect(init.credentials).toBe("include");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  }
  expect(calls[2]!.init).toEqual({
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(command),
  });
  expect(activity).toEqual(["/management-api/me/attendance/commands"]);
});
it("a day query distinguishes location and date without adding a person to the wire", async () => {
  const { api, calls } = await client(() => day);
  const query = api.dayQuery("place", day.date);
  expect(query.key).not.toBe(api.dayQuery("another", day.date).key);
  expect(query.key).not.toBe(api.dayQuery("place", "2026-01-06").key);
  expect(query.dependencies).toContainEqual({ type: "attendance_response_commands" });
  expect(query.dependencies).toContainEqual({ type: "pay_period_settings" });
  expect(await query.read()).toEqual(day);
  expect(calls[0]!.path).not.toContain("personId");
});
it.each(["send", "receipt"] as const)(
  "successful %s invalidates a mounted own day with a silent change feed",
  async (kind) => {
    const cache = new LiveData();
    caches.push(cache);
    let revision = "before";
    const { api } = await client(
      (path, init) =>
        path.includes("/commands")
          ? ((revision = "after"), { ...saved, replayed: init.method === "GET" })
          : { ...day, revision },
      cache,
    );
    const watch = cache.observe(api.dayQuery("place", day.date), () => {});
    try {
      await expect.poll(() => watch.snapshot.value?.revision).toBe("before");
      if (kind === "send") await api.send(command);
      else await api.command(command.commandId);
      await expect.poll(() => watch.snapshot.value?.revision).toBe("after");
    } finally {
      watch.unsubscribe();
    }
  },
);
it("a missing receipt is null and a refusal does not refresh as if saved", async () => {
  const cache = new LiveData();
  caches.push(cache);
  const { api, calls } = await client(
    (path, init) =>
      init.method === "POST"
        ? new Response(
            JSON.stringify({
              error: { code: "attendance.state_changed", params: { reason: "revision" } },
            }),
            { status: 409 },
          )
        : path.includes("/commands/")
          ? null
          : day,
    cache,
  );
  const watch = cache.observe(api.dayQuery("place", day.date), () => {});
  try {
    await expect.poll(() => watch.snapshot.status).toBe("ready");
    await expect(api.send(command)).rejects.toEqual({
      code: "attendance.state_changed",
      params: { reason: "revision" },
      status: 409,
    });
    expect(calls).toHaveLength(2);
    expect(await api.command(command.commandId)).toBeNull();
  } finally {
    watch.unsubscribe();
  }
});
