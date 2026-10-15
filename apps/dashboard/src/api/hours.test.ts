import { afterEach, expect, it } from "vitest";
import { createRequest, LiveData, type FetchLike } from "@waitron/dashboard-kit";
import type { PersonHours, HoursSelection } from "@waitron/dashboard-modules";
const modules = import.meta.glob<typeof import("./hours.js")>("./hours.ts");
const caches: LiveData[] = [];
afterEach(() => {
  for (const cache of caches.splice(0)) cache.clear();
});
const selection: HoursSelection = { kind: "week", date: "2026-01-05" };
const hours: PersonHours = {
  personId: "worker",
  locationId: "place",
  selection,
  period: { start: "2026-01-05", end: "2026-01-12" },
  businessDay: "2026-01-06",
  clock: { timeZone: "Europe/Madrid", dayCutover: "05:00", cutoverChanges: [] },
  asOf: "2026-01-06T09:00:00Z",
  days: [],
  workedMinutes: 480,
  record: { sessions: [], entries: [], closures: [], closedPeriodImpacts: [] },
  openShifts: [],
  pending: { prompts: [], items: [], automaticEntryIds: [] },
  closures: [],
};
async function client(respond: (path: string) => unknown = () => hours, cache?: LiveData) {
  const load = modules["./hours.ts"];
  expect(load, "hours client").toBeTypeOf("function");
  const { HoursApi } = await load!();
  const calls: { path: string; init: RequestInit }[] = [],
    activity: string[] = [];
  const fetchImpl: FetchLike = async (path, init) => {
    calls.push({ path, init });
    const result = respond(path);
    return result instanceof Response ? result : new Response(JSON.stringify(result));
  };
  return {
    api: new HoursApi(
      createRequest({ baseUrl: "/box", fetchImpl, onSuccess: (path) => activity.push(path) }),
      cache,
    ),
    calls,
    activity,
  };
}
it("own, inbox and manager GETs are passive and carry cookies, an abort signal and no person selector", async () => {
  const { api, calls, activity } = await client();
  expect(await api.own("place", selection)).toEqual(hours);
  await api.ownInbox();
  await api.manager("place", { kind: "pay-period" });
  expect(calls.map((c) => c.path)).toEqual([
    "/box/management-api/me/attendance/hours?locationId=place&kind=week&date=2026-01-05",
    "/box/management-api/me/attendance/inbox",
    "/box/management-api/attendance/hours?locationId=place&kind=pay-period",
  ]);
  for (const { init } of calls) {
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("include");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(init.headers).get("x-waitron-live")).toBe("1");
    expect(init.body).toBeUndefined();
  }
  expect(activity).toEqual([]);
});
it("encodes query values and omits an absent date", async () => {
  const { api, calls } = await client();
  await api.own("a & b", { kind: "month" });
  expect(calls[0]!.path).toBe(
    "/box/management-api/me/attendance/hours?locationId=a+%26+b&kind=month",
  );
});
const dependencies = [
  "time_entries",
  "pay_period_closures",
  "pay_period_settings",
  "attendance_questions",
  "attendance_response_commands",
  "persons",
  "locations",
  "location_day_cutover_changes",
  "location_business_day_settings",
];
it("query keys distinguish each selected scope and every hours source is declared", async () => {
  const { api, calls, activity } = await client();
  const own = api.ownQuery("place", selection),
    inbox = api.ownInboxQuery(),
    manager = api.managerQuery("place", { kind: "pay-period" });
  for (const query of [own, inbox, manager]) {
    expect(query.dependencies.map((d) => d.type).sort()).toEqual([...dependencies].sort());
    await query.read();
  }
  const keys = [
    own.key,
    inbox.key,
    manager.key,
    api.ownQuery("elsewhere", selection).key,
    api.ownQuery("place", { kind: "month" }).key,
    api.ownQuery("place", { kind: "week", date: "2026-01-12" }).key,
  ];
  expect(new Set(keys).size).toBe(keys.length);
  expect(calls).toHaveLength(3);
  expect(activity).toEqual([]);
});
it.each(dependencies)(
  "a %s event refreshes a mounted own hours read without activity",
  async (type) => {
    const cache = new LiveData();
    caches.push(cache);
    let total = 480;
    const { api, activity } = await client(() => ({ ...hours, workedMinutes: total }), cache);
    const watch = cache.observe(api.ownQuery("place", selection), () => {});
    try {
      await expect.poll(() => watch.snapshot.value?.workedMinutes).toBe(480);
      total = 540;
      cache.invalidate([{ type }]);
      await expect.poll(() => watch.snapshot.value?.workedMinutes).toBe(540);
      expect(activity).toEqual([]);
    } finally {
      watch.unsubscribe();
    }
  },
);
it("explicit invalidation refreshes a mounted summary when the change feed is silent", async () => {
  const cache = new LiveData();
  caches.push(cache);
  let total = 480;
  const { api } = await client(() => ({ ...hours, workedMinutes: total }), cache);
  const watch = cache.observe(api.ownQuery("place", selection), () => {});
  try {
    await expect.poll(() => watch.snapshot.value?.workedMinutes).toBe(480);
    total = 540;
    api.invalidate();
    await expect.poll(() => watch.snapshot.value?.workedMinutes).toBe(540);
  } finally {
    watch.unsubscribe();
  }
});
it("preserves structured refusal details", async () => {
  const { api } = await client(
    () =>
      new Response(
        JSON.stringify({
          error: { code: "attendance.not_permitted", params: { personId: "worker" } },
        }),
        { status: 403 },
      ),
  );
  await expect(api.own("place", selection)).rejects.toEqual({
    code: "attendance.not_permitted",
    params: { personId: "worker" },
    status: 403,
  });
});
it("a cached query retains the selection represented by its key", async () => {
  const { api, calls } = await client();
  const selected = { ...selection };
  const query = api.ownQuery("place", selected);
  selected.date = "2026-02-01";
  await query.read();
  expect(calls[0]!.path).toBe(
    "/box/management-api/me/attendance/hours?locationId=place&kind=week&date=2026-01-05",
  );
});
