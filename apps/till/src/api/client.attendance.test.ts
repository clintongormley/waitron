import { describe, expect, it, vi } from "vitest";
import { TillApi, type AttendanceInbox } from "./client.js";

describe("attendance client", () => {
  it("retains the automatic time and linked proposal history across midnight with their stored offsets", async () => {
    const original = {
      entryId: "automatic",
      personId: "ana",
      locationId: "venue",
      nodeId: "node",
      entryKind: "out" as const,
      eventAt: "2026-10-15T00:15:00Z",
      recordedAt: "2026-10-15T02:00:00Z",
      offsetMinutes: 120,
      sequenceNo: 2,
      recordedByPersonId: null,
      extension: {
        authorKind: "automatic" as const,
        direction: null,
        missingEntryKind: null,
        respondsToEntryId: null,
        payPeriodClosureId: null,
      },
    };
    const proposed = {
      ...original,
      entryId: "proposal",
      entryKind: "correction" as const,
      eventAt: "2026-10-15T00:45:00Z",
      recordedAt: "2026-10-16T08:00:00Z",
      sequenceNo: 3,
      correctsEntryId: "automatic",
      correctionStatus: "requested" as const,
      recordedByPersonId: "manager",
      correctionActorId: "manager",
      correctionReason: "Later finish",
      extension: {
        ...original.extension,
        authorKind: "manager" as const,
        direction: "manager_proposal" as const,
      },
    };
    const body: AttendanceInbox = {
      personId: "ana",
      revision: "r1",
      locations: [{ id: "venue", name: "Local", timeZone: "Europe/Madrid" }],
      prompts: [
        {
          id: "prompt",
          questionId: "question",
          itemId: "proposal",
          personId: "ana",
          locationId: "venue",
          locationName: "Local",
          businessDay: "2026-10-14",
          day: {
            locationId: "venue",
            businessDay: "2026-10-14",
            startAt: "2026-10-14T02:00:00Z",
            endAt: "2026-10-15T02:00:00Z",
          },
          kind: "proposal",
          automaticEntryId: "automatic",
          missingKinds: [],
          timeZone: "Europe/Madrid",
          history: [original, proposed],
        },
      ],
      items: [
        {
          id: "proposal",
          requestEntryIds: ["proposal"],
          personId: "ana",
          locationId: "venue",
          direction: "manager_proposal",
          status: "waiting-worker",
          readyToApply: true,
          responseEntryIds: [],
          changes: [
            { target: { entryId: "automatic" }, at: "2026-10-15T00:45:00Z", offsetMinutes: 120 },
          ],
          reason: "Later finish",
          requestedByPersonId: "manager",
          selfApproved: false,
          history: [original, proposed],
        },
      ],
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body)));
    const answer = await new TillApi("", fetcher).getAttendanceInbox();
    expect(answer.prompts[0]).toMatchObject({
      businessDay: "2026-10-14",
      timeZone: "Europe/Madrid",
      history: [
        {
          eventAt: "2026-10-15T00:15:00Z",
          offsetMinutes: 120,
          extension: { authorKind: "automatic" },
        },
        {
          eventAt: "2026-10-15T00:45:00Z",
          correctsEntryId: "automatic",
          correctionStatus: "requested",
        },
      ],
    });
    expect(answer.items[0]).toMatchObject({
      status: "waiting-worker",
      changes: [{ at: "2026-10-15T00:45:00Z", offsetMinutes: 120 }],
      history: [original, proposed],
    });
  });
  it.each([
    [
      "getAttendanceInbox",
      [],
      "/api/attendance/inbox",
      { personId: "ana", revision: "r1", prompts: [], items: [], locations: [] },
    ],
    [
      "getAttendanceDay",
      ["2026-10-25", "old/location"],
      "/api/attendance/day?date=2026-10-25&locationId=old%2Flocation",
      {
        personId: "ana",
        locationId: "old/location",
        date: "2026-10-25",
        timeZone: "Europe/Madrid",
        revision: "r2",
        record: { sessions: [], entries: [], closures: [], closedPeriodImpacts: [] },
        items: [],
      },
    ],
    ["getAttendanceCommand", ["command/id"], "/api/attendance/commands/command%2Fid", null],
    [
      "listAttendanceApprovers",
      ["item/id", "decline"],
      "/api/attendance/items/item%2Fid/approvers?action=decline",
      [{ personId: "manager", displayName: "Marta" }],
    ],
  ] as const)(
    "%s preserves scope, cancellation and credentials",
    async (method, args, path, body) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body)));
      const api = new TillApi("https://box.test", fetcher);
      expect(api[method]).toBeTypeOf("function");
      const signal = new AbortController().signal;
      const call = api[method] as (...args: unknown[]) => Promise<unknown>;
      expect(await call.call(api, ...args, { signal })).toEqual(body);
      expect(fetcher.mock.calls).toEqual([
        [`https://box.test${path}`, { method: "GET", credentials: "include", signal }],
      ]);
    },
  );

  it.each([undefined, { personId: "selected-manager", pin: "1234" }])(
    "posts the command once with only the selected PIN envelope when present: %j",
    async (override) => {
      const answer = { commandId: "command", entryIds: ["saved"], replayed: false };
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(answer)));
      const api = new TillApi("", fetcher);
      expect(api.sendAttendanceCommand).toBeTypeOf("function");
      const signal = new AbortController().signal;
      const command = {
        action: "approve" as const,
        commandId: "command",
        itemId: "request",
        expectedRevision: "revision",
      };
      expect(await api.sendAttendanceCommand(command, override, { signal })).toEqual(answer);
      expect(fetcher.mock.calls).toEqual([
        [
          "/api/attendance/commands",
          {
            method: "POST",
            credentials: "include",
            signal,
            headers: { "content-type": "application/json" },
            body: JSON.stringify(override ? { ...command, override } : command),
          },
        ],
      ]);
    },
  );

  it("does not replay a lost answer or turn a refusal into a network failure", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("lost"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: "attendance.state_changed", params: {} } }), {
          status: 409,
        }),
      );
    const api = new TillApi("", fetcher);
    expect(api.sendAttendanceCommand).toBeTypeOf("function");
    const command = {
      action: "confirm" as const,
      commandId: "command",
      questionId: "question",
      expectedRevision: "r1",
    };
    await expect(api.sendAttendanceCommand(command)).rejects.toBeInstanceOf(TypeError);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(api.sendAttendanceCommand(command)).rejects.toEqual({
      code: "attendance.state_changed",
      status: 409,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
