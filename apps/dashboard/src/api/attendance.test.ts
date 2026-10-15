import { afterEach, describe, expect, it } from "vitest";
import { createRequest, LiveData, type FetchLike } from "@waitron/dashboard-kit";
import { deviceOrigin } from "@waitron/shared";
import type {
  AttendanceCommand,
  AttendanceDayView,
  AttendanceLookups,
  AttendanceManagerQueue,
  CorrectionItem,
} from "@waitron/dashboard-modules";
const modules = import.meta.glob<typeof import("./attendance.js")>("./attendance.ts");
const worker = "10000000-0000-4000-8000-000000000001";
const manager = "10000000-0000-4000-8000-000000000002";
const locationId = "10000000-0000-4000-8000-000000000003";
const itemId = "10000000-0000-4000-8000-000000000004";
const nodeId = "10000000-0000-4000-8000-000000000005";
const command: AttendanceCommand = {
  action: "approve",
  commandId: "10000000-0000-4000-8000-000000000009",
  expectedRevision: "subject-revision",
  itemId,
};
const saved = {
  commandId: command.commandId,
  entryIds: ["10000000-0000-4000-8000-000000000010"],
  replayed: false,
};
const lookups: AttendanceLookups = {
  viewer: { personId: manager, canSelfApprove: false },
  locations: [{ id: locationId, name: "The deli", timeZone: "Europe/Madrid" }],
  people: [
    { personId: worker, displayName: "Ana" },
    { personId: manager, displayName: "Marta" },
  ],
};
const day: AttendanceDayView = {
  personId: worker,
  locationId,
  date: "2026-10-13",
  timeZone: "Europe/Madrid",
  revision: "subject-revision",
  record: { sessions: [], entries: [], closures: [], closedPeriodImpacts: [] },
  items: [],
};
const pending: CorrectionItem = {
  id: itemId,
  requestEntryIds: [itemId],
  personId: worker,
  locationId,
  direction: "worker_request",
  status: "waiting-manager",
  readyToApply: true,
  responseEntryIds: [],
  changes: [{ target: { missingKind: "out" }, at: "2026-10-13T15:00:00.000Z", offsetMinutes: 120 }],
  reason: "Forgot to clock out",
  requestedByPersonId: worker,
  selfApproved: false,
  history: [
    {
      entryId: itemId,
      personId: worker,
      locationId,
      nodeId,
      entryKind: "correction",
      eventAt: "2026-10-13T15:00:00.000Z",
      recordedAt: "2026-10-14T06:00:00.000Z",
      offsetMinutes: 120,
      sequenceNo: 3,
      correctsEntryId: null,
      correctionStatus: "requested",
      correctionReason: "Forgot to clock out",
      correctionActorId: worker,
      recordedByPersonId: worker,
      origin: deviceOrigin("10000000-0000-4000-8000-000000000006"),
      extension: {
        authorKind: "worker",
        direction: "worker_request",
        missingEntryKind: "out",
        respondsToEntryId: null,
        payPeriodClosureId: null,
      },
    },
  ],
};
const caches: LiveData[] = [];
afterEach(() => {
  for (const cache of caches.splice(0)) cache.clear();
});
async function client(
  respond: (path: string, init: RequestInit) => unknown = () => saved,
  liveData?: LiveData,
) {
  const load = modules["./attendance.ts"];
  expect(load, "dashboard attendance client").toBeTypeOf("function");
  const { AttendanceApi } = await load!();
  const requests: { path: string; init: RequestInit }[] = [];
  const activity: string[] = [];
  const transport: FetchLike = async (path, init) => {
    requests.push({ path, init });
    const result = respond(path, init);
    return result instanceof Response
      ? result
      : new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
  };
  return {
    api: new AttendanceApi(
      createRequest({
        baseUrl: "/box",
        fetchImpl: transport,
        onSuccess: (path) => activity.push(path),
      }),
      liveData,
    ),
    requests,
    activity,
  };
}

describe("dashboard attendance wire and live reads", () => {
  it("reads minimal names/current viewer, an exact worker day and location queue with session cookies", async () => {
    const queue: AttendanceManagerQueue = { locationId, items: [pending] };
    const { api, requests } = await client((path) =>
      path.endsWith("/lookups") ? lookups : path.includes("/day?") ? day : queue,
    );
    expect(await api.lookups()).toEqual(lookups);
    expect(await api.day(worker, locationId, "2026-10-13")).toEqual(day);
    expect(await api.queue(locationId)).toEqual(queue);
    expect(requests).toEqual([
      {
        path: "/box/management-api/attendance/lookups",
        init: { method: "GET", credentials: "include", signal: expect.any(AbortSignal) },
      },
      {
        path: `/box/management-api/attendance/day?personId=${worker}&locationId=${locationId}&date=2026-10-13`,
        init: { method: "GET", credentials: "include", signal: expect.any(AbortSignal) },
      },
      {
        path: `/box/management-api/attendance/queue?locationId=${locationId}`,
        init: { method: "GET", credentials: "include", signal: expect.any(AbortSignal) },
      },
    ]);
  });

  it("background GETs are passive while their POST is active and adds no client authorship", async () => {
    const { api, requests, activity } = await client((path) =>
      path.endsWith("/lookups")
        ? lookups
        : path.includes("/day?")
          ? day
          : path.includes("/queue?")
            ? { locationId, items: [] }
            : saved,
    );
    await api.background.lookups();
    await api.background.queue(locationId);
    await api.background.day(worker, locationId, "2026-10-13");
    await api.background.command(command.commandId);
    expect(activity).toEqual([]);
    for (const request of requests)
      expect(new Headers(request.init.headers).get("x-waitron-live")).toBe("1");
    expect(await api.background.send(command)).toEqual(saved);
    const post = requests[4]!;
    expect(post.path).toBe("/box/management-api/attendance/commands");
    expect(post.init).toEqual({
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command),
    });
    expect(activity).toEqual(["/management-api/attendance/commands"]);
    expect(api.background.background).toBe(api.background);
  });

  it("a missing receipt is null and a found receipt keeps its original identity and replay flag", async () => {
    let found = false;
    const { api, requests } = await client(() => (found ? { ...saved, replayed: true } : null));
    expect(await api.command(command.commandId)).toBeNull();
    found = true;
    expect(await api.command(command.commandId)).toEqual({ ...saved, replayed: true });
    expect(requests.map((request) => request.path)).toEqual([
      `/box/management-api/attendance/commands/${command.commandId}`,
      `/box/management-api/attendance/commands/${command.commandId}`,
    ]);
  });

  it("query identities distinguish scope and declare every record/revision source; their reads stay passive", async () => {
    const { api, requests, activity } = await client((path) =>
      path.endsWith("/lookups")
        ? lookups
        : path.includes("/day?")
          ? day
          : { locationId, items: [] },
    );
    const lookup = api.lookupsQuery(),
      queue = api.queueQuery(locationId),
      selectedDay = api.dayQuery(worker, locationId, "2026-10-13");
    const expected = [
      "time_entries",
      "pay_period_closures",
      "attendance_questions",
      "attendance_response_commands",
      "persons",
      "locations",
      "location_day_cutover_changes",
      "location_business_day_settings",
    ].map((type) => ({ type }));
    expect(lookup.dependencies).toEqual([{ type: "persons" }, { type: "locations" }]);
    expect(queue.dependencies).toEqual(expected);
    expect(selectedDay.dependencies).toEqual(expected);
    expect(queue.key).not.toBe(api.queueQuery(manager).key);
    expect(selectedDay.key).not.toBe(api.dayQuery(manager, locationId, "2026-10-13").key);
    expect(selectedDay.key).not.toBe(api.dayQuery(worker, manager, "2026-10-13").key);
    expect(selectedDay.key).not.toBe(api.dayQuery(worker, locationId, "2026-10-14").key);
    await lookup.read();
    await queue.read();
    await selectedDay.read();
    expect(
      requests.every((request) => new Headers(request.init.headers).get("x-waitron-live") === "1"),
    ).toBe(true);
    expect(activity).toEqual([]);
  });

  it("successful commands update a mounted shared query even with a silent change feed", async () => {
    const cache = new LiveData();
    caches.push(cache);
    let queue: AttendanceManagerQueue = { locationId, items: [pending] };
    const { api } = await client((_path, init) => {
      if (init.method === "POST") {
        queue = { locationId, items: [] };
        return saved;
      }
      return queue;
    }, cache);
    expect(api.background.liveData).toBe(cache);
    const watched = cache.observe(api.queueQuery(locationId), () => {});
    await expect.poll(() => watched.snapshot.value?.items.length).toBe(1);
    await api.send(command);
    await expect.poll(() => watched.snapshot.value?.items.length).toBe(0);
    watched.unsubscribe();
  });

  it("a refusal preserves its structured error and does not refresh a queue as if saved", async () => {
    const cache = new LiveData();
    caches.push(cache);
    const { api, requests } = await client(
      (_path, init) =>
        init.method === "POST"
          ? new Response(
              JSON.stringify({
                error: { code: "attendance.state_changed", params: { reason: "revision" } },
              }),
              { status: 409 },
            )
          : { locationId, items: [pending] },
      cache,
    );
    const watched = cache.observe(api.queueQuery(locationId), () => {});
    await expect.poll(() => watched.snapshot.value?.items.length).toBe(1);
    await expect(api.send(command)).rejects.toEqual({
      code: "attendance.state_changed",
      params: { reason: "revision" },
      status: 409,
    });
    expect(watched.snapshot.value?.items).toEqual([pending]);
    expect(requests).toHaveLength(2);
    watched.unsubscribe();
  });
});

it("a resolved receipt refreshes mounted records without a POST when the feed is silent", async () => {
  const cache = new LiveData();
  caches.push(cache);
  let queue: AttendanceManagerQueue = { locationId, items: [pending] };
  const { api, requests } = await client(
    (path) => (path.includes("/commands/") ? { ...saved, replayed: true } : queue),
    cache,
  );
  const watched = cache.observe(api.queueQuery(locationId), () => {});
  await expect.poll(() => watched.snapshot.value?.items.length).toBe(1);
  queue = { locationId, items: [] };
  expect(await api.background.command(command.commandId)).toEqual({ ...saved, replayed: true });
  await expect.poll(() => watched.snapshot.value?.items.length).toBe(0);
  expect(requests.every((request) => request.init.method === "GET")).toBe(true);
  watched.unsubscribe();
});

it.each([
  "time_entries",
  "pay_period_closures",
  "attendance_questions",
  "attendance_response_commands",
  "persons",
  "locations",
  "location_day_cutover_changes",
  "location_business_day_settings",
])("a %s event refreshes mounted record reads passively", async (type) => {
  const cache = new LiveData();
  caches.push(cache);
  let revision = "before";
  const { api, requests, activity } = await client(
    (path) => (path.includes("/day?") ? { ...day, revision } : { locationId, items: [] }),
    cache,
  );
  const queue = cache.observe(api.queueQuery(locationId), () => {});
  const selectedDay = cache.observe(api.dayQuery(worker, locationId, day.date), () => {});
  await expect.poll(() => selectedDay.snapshot.value?.revision).toBe("before");
  await expect.poll(() => queue.snapshot.status).toBe("ready");
  revision = "after";
  cache.invalidate([{ type }]);
  await expect.poll(() => selectedDay.snapshot.value?.revision).toBe("after");
  expect(requests.filter((request) => request.path.includes("/queue?")).length).toBe(2);
  expect(
    requests.every((request) => new Headers(request.init.headers).get("x-waitron-live") === "1"),
  ).toBe(true);
  expect(activity).toEqual([]);
  queue.unsubscribe();
  selectedDay.unsubscribe();
});

it.each(["persons", "locations"] as const)(
  "a %s event refreshes mounted lookups for eligibility or edit zones",
  async (type) => {
    const cache = new LiveData();
    caches.push(cache);
    let changed = false;
    const { api } = await client(
      () =>
        changed
          ? {
              ...lookups,
              viewer: { ...lookups.viewer, canSelfApprove: type === "persons" },
              people:
                type === "persons"
                  ? [{ personId: worker, displayName: "Alicia" }, lookups.people[1]!]
                  : lookups.people,
              locations:
                type === "locations"
                  ? [{ ...lookups.locations[0]!, timeZone: "Atlantic/Canary" }]
                  : lookups.locations,
            }
          : lookups,
      cache,
    );
    const watched = cache.observe(api.lookupsQuery(), () => {});
    await expect.poll(() => watched.snapshot.status).toBe("ready");
    expect(watched.snapshot.value).toEqual(lookups);
    changed = true;
    cache.invalidate([{ type }]);
    if (type === "persons") {
      await expect.poll(() => watched.snapshot.value?.viewer.canSelfApprove).toBe(true);
      expect(watched.snapshot.value?.people[0]!.displayName).toBe("Alicia");
    } else
      await expect
        .poll(() => watched.snapshot.value?.locations[0]!.timeZone)
        .toBe("Atlantic/Canary");
    watched.unsubscribe();
  },
);
