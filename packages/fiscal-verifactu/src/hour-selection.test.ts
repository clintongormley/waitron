import { expect, it } from "vitest";
import { withOperationAuthority, type OperationBinding } from "@waitron/module";
import { compareHourClocks, type HourClockObservation } from "./hour-clock.js";
import { decodeMinuteIdentity } from "./hour-identity.js";
import {
  createHourSelection,
  type HourSelectionFacts,
  type HourSelectionStore,
} from "./hour-selection.js";

const binding: OperationBinding = {
  module: "fiscal-verifactu",
  action: "promote",
  eventId: "event1",
  sourceId: "attempt1",
  targetNodeId: "node1",
};
const setup: OperationBinding = { ...binding, action: "setup" };
const restore: OperationBinding = { ...binding, action: "restore" };
const scope = { taxpayerNif: "89890001K", environment: "preproduction" as const };
const bases = [
  { code: "A", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
const instant = Date.parse("2026-10-16T11:40:00.000Z");
function clock(at = instant, monotonic = 0, browserAt = at) {
  return compareHourClocks(
    ["box", "browser"].map(
      (source) =>
        ({
          source,
          result: "usable",
          instantMs: source === "box" ? at : browserAt,
          uncertaintyMs: 0,
          wallStartedMs: at,
          wallFinishedMs: at,
          monotonicStartedMs: monotonic,
          monotonicFinishedMs: monotonic,
        }) as HourClockObservation,
    ),
    Date.parse("2026-10-15T00:00:00Z"),
  );
}
function fixture() {
  let value: unknown = null;
  let tail = Promise.resolve();
  let mono = 0;
  let facts: HourSelectionFacts = {
    scope,
    bases,
    contextKey: "country/zone/module-version/owner-generation-1",
    clock: clock(),
    history: [{ reference: "venue", complete: true, records: [] }],
  };
  const writes: unknown[] = [];
  const store: HourSelectionStore = async (_binding, run) => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await run({
        value: structuredClone(value),
        history: structuredClone(writes),
        async replace(next) {
          value = structuredClone(next);
          writes.push(structuredClone(value));
        },
      });
    } finally {
      release();
    }
  };
  const create = (withState = store) =>
    createHourSelection({ withState, read: async () => facts, monotonicNow: () => mono });
  let engine = create();
  return {
    writes,
    store,
    create,
    get value() {
      return value;
    },
    set value(next: unknown) {
      value = next;
    },
    get facts() {
      return facts;
    },
    set facts(next: HourSelectionFacts) {
      facts = next;
    },
    at(at: number, elapsed: number, browserAt = at) {
      mono = elapsed;
      facts = { ...facts, clock: clock(at, mono, browserAt) };
    },
    restart() {
      mono = 0;
      engine = create();
    },
    run(selected = binding) {
      return withOperationAuthority(selected, "administrator", (authority) =>
        engine.select({ binding: selected, authority, comparisonId: "comparison" }),
      );
    },
    preview(selected = binding) {
      return withOperationAuthority(selected, "administrator", (authority) =>
        engine.preview({ binding: selected, authority }),
      );
    },
  };
}

it("exposes an hour only after its complete bound intent is persisted", async () => {
  const f = fixture();
  const result = await f.run();
  expect(result).toMatchObject({
    status: "selected",
    identity: "0CNNW",
    issuedAt: "2026-10-16T11:40:00.000Z",
    binding,
    scope,
    bases,
  });
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0]).toMatchObject({
    version: 1,
    entries: [
      expect.objectContaining({ kind: "intent", identity: "0CNNW", binding, scope, bases }),
    ],
  });
});

const refusal = (reason: string) => ({ code: "sif.allocation_invalid", params: { reason } });
const historyRow = (identity = "0CNPG", change: Record<string, unknown> = {}) => ({
  ...scope,
  reference: "retired-other-node",
  kind: "retirement",
  identity,
  softwareId: "OTHER",
  nodeId: "node2",
  recordedAtMs: null,
  ...change,
});
it("waits for the next minute when the current one is known", async () => {
  const f = fixture();
  f.facts = {
    ...f.facts,
    history: [{ reference: "retired", complete: true, records: [historyRow("0CNNW")] }],
  };
  expect(await f.run()).toEqual({
    status: "waiting",
    targetMs: Date.parse("2026-10-16T11:41:00Z"),
    remainingMs: 60_000,
  });
});
const LATER = [
  "a later name",
  "a later record time on an earlier name",
  "a source time floor",
  "another event's later pick",
] as const;
it.each([binding, restore, setup].flatMap((base) => LATER.map((later) => ({ ...base, later }))))(
  "$action selects as with an empty history beside $later",
  async ({ later, ...base }) => {
    const f = fixture();
    const ahead = instant + 10 * 60_000;
    if (later === "another event's later pick") {
      f.at(instant + 20 * 60_000, 0);
      expect(await f.run(event(binding, "other"))).toMatchObject({ identity: "0CNPG" });
      f.at(instant, 0);
    } else
      f.facts = {
        ...f.facts,
        history: [
          later === "a source time floor"
            ? { reference: "venue", complete: true, records: [], timeFloorMs: ahead }
            : {
                reference: "venue",
                complete: true,
                records: [
                  later === "a later name"
                    ? historyRow("0CNPG")
                    : historyRow("0CNNA", { recordedAtMs: ahead }),
                ],
              },
        ],
      };
    if (base.action === "promote")
      expect(await f.run(base)).toMatchObject({ status: "selected", identity: "0CNNW" });
    else
      expect(await f.run(base)).toEqual({
        status: "waiting",
        targetMs: Date.parse("2026-10-16T11:42:00Z"),
        remainingMs: 120_000,
      });
  },
);
it.each(["a later name", "a later record time"])(
  "a pick stands when %s appears after it",
  async (later) => {
    const f = fixture();
    expect(await f.run()).toMatchObject({ status: "selected", identity: "0CNNW" });
    f.facts = {
      ...f.facts,
      history: [
        {
          reference: "venue",
          complete: true,
          records: [
            later === "a later name"
              ? historyRow("0CNPG")
              : historyRow("0CNNA", { recordedAtMs: instant + 200_000 }),
          ],
        },
      ],
    };
    expect(await f.run()).toMatchObject({ status: "selected", identity: "0CNNW" });
  },
);
it("a pick is refused when a record naming its own minute appears after it", async () => {
  const f = fixture();
  expect(await f.run()).toMatchObject({ status: "selected", identity: "0CNNW" });
  f.facts = {
    ...f.facts,
    history: [{ reference: "venue", complete: true, records: [historyRow("0CNNW")] }],
  };
  await expect(f.run()).rejects.toMatchObject(refusal("minute_in_use"));
  const refused = await f.run().catch((error: unknown) => error);
  expect((refused as { params: unknown }).params).toEqual({ reason: "minute_in_use" });
});
const used = (...identities: string[]) =>
  identities.map((identity) => historyRow(identity, { reference: `used/${identity}` }));
it("a promotion whose current minute and the next two are in use is refused from the first free one", async () => {
  const f = fixture();
  f.facts = {
    ...f.facts,
    history: [{ reference: "venue", complete: true, records: used("0CNNW", "0CNNX", "0CNNY") }],
  };
  await expect(f.run()).rejects.toMatchObject({
    params: { reason: "minute_in_use", allowedFromMs: Date.parse("2026-10-16T11:43:00Z") },
  });
  expect(f.writes).toEqual([]);
});
it("a setup whose settle-target minute is in use is refused from the minute after", async () => {
  const f = fixture();
  f.facts = {
    ...f.facts,
    history: [{ reference: "venue", complete: true, records: used("0CNNY") }],
  };
  await expect(f.run(setup)).rejects.toMatchObject({
    params: { reason: "minute_in_use", allowedFromMs: Date.parse("2026-10-16T11:43:00Z") },
  });
  expect(f.writes).toEqual([]);
});
it.each([
  {
    base: restore,
    t0: "11:40:00",
    taken: ["0CNNY"],
    free: "11:43",
    remaining: 180_000,
    recheck: 30_000,
    name: "0CNNZ",
  },
  {
    base: restore,
    t0: "11:40:45",
    taken: ["0CNNZ"],
    free: "11:44",
    remaining: 195_000,
    recheck: 45_000,
    name: "0CNP0",
  },
  {
    base: setup,
    t0: "11:40:00",
    taken: ["0CNNY", "0CNNZ"],
    free: "11:44",
    remaining: 240_000,
    recheck: 90_000,
    name: "0CNP0",
  },
  {
    base: binding,
    t0: "11:40:00",
    taken: ["0CNNW", "0CNNX", "0CNNY"],
    free: "11:43",
    remaining: 180_000,
    recheck: 30_000,
    name: "0CNNZ",
  },
])(
  "a $base.action refused for a minute in use says when the name will be taken and when to check again",
  async ({ base, t0, taken, free, remaining, recheck, name }) => {
    const f = fixture();
    const start = Date.parse(`2026-10-16T${t0}Z`);
    const allowedFromMs = Date.parse(`2026-10-16T${free}:00Z`);
    f.facts = {
      ...f.facts,
      history: [{ reference: "venue", complete: true, records: used(...taken) }],
    };
    f.at(start, 0);
    const refused = await f.run(base).catch((error: unknown) => error);
    expect((refused as { params?: unknown }).params).toEqual({
      reason: "minute_in_use",
      allowedFromMs,
      remainingMs: remaining,
      recheckInMs: recheck,
    });
    f.at(start + recheck - 1, recheck - 1);
    await expect(f.run(base)).rejects.toMatchObject(refusal("minute_in_use"));
    expect(f.writes).toEqual([]);
    f.at(start + recheck, recheck);
    expect(await f.run(base)).toEqual({
      status: "waiting",
      targetMs: allowedFromMs,
      remainingMs: remaining - recheck,
    });
    f.at(allowedFromMs, remaining);
    expect(await f.run(base)).toMatchObject({ status: "selected", identity: name });
  },
);
it.each([
  ["0CNNY", "2026-10-16T11:41:50Z", 110_000, "2026-10-16T11:43:00Z", 70_000],
  ["0CNNZ", "2026-10-16T11:43:00Z", 180_000, "2026-10-16T11:44:00Z", 60_000],
])(
  "a restore's recorded wait meeting %s, in use, at %s waits for the next free minute",
  async (identity, now, elapsed, target, remainingMs) => {
    const f = fixture();
    expect(await f.run(restore)).toMatchObject({
      status: "waiting",
      targetMs: Date.parse("2026-10-16T11:42:00Z"),
    });
    f.facts = {
      ...f.facts,
      history: [{ reference: "venue", complete: true, records: used(identity) }],
    };
    f.at(Date.parse(now), elapsed);
    expect(await f.run(restore)).toEqual({
      status: "waiting",
      targetMs: Date.parse(target),
      remainingMs,
    });
  },
);
it("allows the current minute beside a name at epoch minute zero", async () => {
  const f = fixture();
  f.facts = {
    ...f.facts,
    history: [{ reference: "old", complete: true, records: [historyRow("00000")] }],
  };
  expect(await f.run()).toMatchObject({ status: "selected", identity: "0CNNW" });
});
it("refuses incomplete history instead of treating it as empty", async () => {
  const f = fixture();
  f.facts = { ...f.facts, history: [{ reference: "unreadable", complete: false, records: [] }] };
  await expect(f.run()).rejects.toMatchObject(refusal("history_invalid"));
});
it("retains exact intent across a boundary and lost reply, without another durable selection", async () => {
  const f = fixture();
  const first = await f.run();
  f.at(Date.parse("2026-10-16T12:40:00Z"), 3_600_000);
  expect(await f.run()).toEqual(first);
  expect(f.writes).toHaveLength(1);
});
it("recalculates a preview across a boundary before persistence", async () => {
  const f = fixture();
  expect(await f.preview()).toMatchObject({ status: "preview", identity: "0CNNW" });
  expect(f.writes).toEqual([]);
  f.at(Date.parse("2026-10-16T12:00:00Z"), 1_200_000);
  expect(await f.run()).toMatchObject({ status: "selected", identity: "0CNPG" });
});
it("serializes concurrent exact requests into one intent", async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.run(), f.run()]);
  expect(a).toEqual(b);
  expect(f.writes).toHaveLength(1);
});
it("retains abandoned or uncertain intent and skips its minute for the replacement", async () => {
  const f = fixture();
  await f.run();
  const next = { ...binding, eventId: "replacement", sourceId: "replacement-attempt" };
  expect(await f.run(next)).toMatchObject({
    status: "waiting",
    targetMs: Date.parse("2026-10-16T11:41:00Z"),
  });
  f.at(Date.parse("2026-10-16T12:00:00Z"), 1_200_000);
  expect(await f.run(next)).toMatchObject({ status: "selected", identity: "0CNPG" });
  expect((f.value as { entries: unknown[] }).entries).toEqual([
    expect.objectContaining({ identity: "0CNNW" }),
    expect.objectContaining({ kind: "wait", targetMs: Date.parse("2026-10-16T11:41:00Z") }),
    expect.objectContaining({ identity: "0CNPG" }),
  ]);
});
it.each(["contextKey", "scope", "bases"])(
  "refuses a changed frozen %s on exact event",
  async (field) => {
    const f = fixture();
    await f.run();
    f.facts = {
      ...f.facts,
      [field]:
        field === "scope"
          ? { ...scope, environment: "production" }
          : field === "bases"
            ? [{ code: "changed", purpose: "standard" }]
            : "owner-generation-2",
    };
    await expect(f.run()).rejects.toMatchObject(refusal("event_mismatch"));
    expect(f.writes).toHaveLength(1);
  },
);
it.each(["sourceId", "targetNodeId", "action"])(
  "cannot reuse event under another %s",
  async (field) => {
    const f = fixture();
    await f.run();
    await expect(
      f.run({ ...binding, [field]: field === "action" ? "restore" : "changed" }),
    ).rejects.toMatchObject(refusal("event_mismatch"));
  },
);
it("compares a changed clock again before returning an existing intent", async () => {
  const f = fixture();
  await f.run();
  f.at(instant, 1, instant + 300_000);
  await expect(f.run()).rejects.toMatchObject(refusal("clock_disagreement"));
});
it("refuses disagreeing clocks with no way to confirm them", async () => {
  const f = fixture();
  f.at(instant, 0, instant + 300_000);
  await expect(f.run()).rejects.toMatchObject(refusal("clock_disagreement"));
  expect(f.writes).toEqual([]);
});
it("a forward wall-clock jump cannot finish an in-process wait early", async () => {
  const f = fixture();
  f.at(Date.parse("2026-10-24T09:00:00Z"), 0);
  await f.run(setup);
  f.at(Date.parse("2026-10-24T09:02:30Z"), 1000);
  expect(await f.run(setup)).toMatchObject({ status: "waiting", remainingMs: 119_000 });
  expect(f.writes).toHaveLength(1);
});
it("restart obtains fresh comparisons without trusting old monotonic readings or downtime", async () => {
  const f = fixture();
  f.at(Date.parse("2026-10-24T09:00:00Z"), 0);
  await f.run(setup);
  f.restart();
  f.at(Date.parse("2026-10-24T09:01:00Z"), 10);
  expect(await f.run(setup)).toMatchObject({ status: "waiting", remainingMs: 60_000 });
  f.at(Date.parse("2026-10-24T09:02:00Z"), 60_010);
  expect(await f.run(setup)).toMatchObject({ status: "selected", identity: "0D0RY" });
});
it("restart after a verified target has passed needs no invented extra wait", async () => {
  const f = fixture();
  f.at(Date.parse("2026-10-24T09:00:00Z"), 0);
  await f.run(setup);
  f.restart();
  f.at(Date.parse("2026-10-24T09:02:30Z"), 0);
  expect(await f.run(setup)).toMatchObject({ status: "selected", identity: "0D0RY" });
});
it("an unresolved restart comparison refuses and retains the wait instead of completing it", async () => {
  const f = fixture();
  f.at(Date.parse("2026-10-24T09:00:00Z"), 0);
  await f.run(setup);
  f.restart();
  f.at(Date.parse("2026-10-24T09:02:10Z"), 0, Date.parse("2026-10-24T08:02:10Z"));
  await expect(f.run(setup)).rejects.toMatchObject(refusal("clock_disagreement"));
  expect(f.writes).toHaveLength(1);
});
it("a backward clock refuses existing material and retains its spent hour", async () => {
  const f = fixture();
  await f.run();
  f.at(instant - 1, 1);
  await expect(f.run()).rejects.toMatchObject(refusal("minute_not_later"));
  expect(f.writes).toHaveLength(1);
});
it.each([{}, [], { version: 2, entries: [] }, { version: 1, entries: [{}] }])(
  "corrupt persisted state %j cannot become a fresh empty history",
  async (value) => {
    const f = fixture();
    f.value = value;
    await expect(f.run()).rejects.toMatchObject(refusal("history_invalid"));
    expect(f.writes).toEqual([]);
  },
);
it("never returns usable material after persistence fails, before or after actual commit", async () => {
  const f = fixture();
  const before = f.create(async () => {
    throw new Error("disk refused");
  });
  await withOperationAuthority(binding, "administrator", async (authority) => {
    await expect(before.select({ binding, authority, comparisonId: "comparison" })).rejects.toThrow(
      "disk refused",
    );
    const after = f.create((selected, run) =>
      f.store(selected, (state) =>
        run({
          ...state,
          async replace(value) {
            await state.replace(value);
            throw new Error("lost durable reply");
          },
        }),
      ),
    );
    await expect(after.select({ binding, authority, comparisonId: "comparison" })).rejects.toThrow(
      "lost durable reply",
    );
  });
  expect(await f.run()).toMatchObject({ status: "selected", identity: "0CNNW" });
  expect(f.writes).toHaveLength(1);
});
it("expired authority cannot select and expiry during persistence cannot expose material", async () => {
  const f = fixture();
  const authority = await withOperationAuthority(
    binding,
    "administrator",
    async (authority) => authority,
  );
  await expect(
    f.create().select({ binding, authority, comparisonId: "comparison" }),
  ).rejects.toMatchObject(refusal("reauthentication_required"));
  expect(f.writes).toEqual([]);
  let pending!: Promise<unknown>;
  await withOperationAuthority(binding, "administrator", async (active) => {
    pending = f
      .create(async (_selected, run) => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        return f.store(binding, run);
      })
      .select({ binding, authority: active, comparisonId: "comparison" });
  });
  await expect(pending).rejects.toMatchObject(refusal("reauthentication_required"));
  expect(f.writes).toEqual([]);
});

it("does not let an empty required inventory be covered up by the local intent ledger", async () => {
  const f = fixture();
  f.facts = { ...f.facts, history: [] };
  await expect(f.run()).rejects.toMatchObject(refusal("history_invalid"));
  expect(f.writes).toEqual([]);
});
it("refuses an out-of-range persisted intent with the domain error", async () => {
  const f = fixture();
  await f.run();
  const value = structuredClone(f.value) as { entries: { issuedAt: string }[] };
  value.entries[0]!.issuedAt = "2025-12-31T23:59:59.999Z";
  f.value = value;
  await expect(f.run()).rejects.toMatchObject(refusal("history_invalid"));
});
it("refuses a persisted intent at the first instant no minute code names", async () => {
  const f = fixture();
  await f.run();
  const value = structuredClone(f.value) as { entries: { issuedAt: string; identity: string }[] };
  value.entries[0]!.issuedAt = "2089-10-18T16:32:00.000Z";
  value.entries[0]!.identity = "ZZZZZ";
  f.value = value;
  f.writes.splice(0, f.writes.length, structuredClone(value));
  await expect(f.run()).rejects.toMatchObject(refusal("history_invalid"));
});
it("reads a persisted intent in the last nameable minute as valid history", async () => {
  const f = fixture();
  await f.run();
  const value = structuredClone(f.value) as { entries: { issuedAt: string; identity: string }[] };
  value.entries[0]!.issuedAt = "2089-10-18T16:31:00.000Z";
  value.entries[0]!.identity = "ZZZZZ";
  f.value = value;
  f.writes.splice(0, f.writes.length, structuredClone(value));
  await expect(f.run()).rejects.toMatchObject(refusal("minute_not_later"));
});
it("expiry while awaiting durable persistence leaves a spent hour but returns no usable material", async () => {
  const f = fixture();
  let entered!: () => void, release!: () => void;
  const reached = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const resumed = new Promise<void>((resolve) => {
    release = resolve;
  });
  let pending!: Promise<unknown>;
  await withOperationAuthority(binding, "administrator", async (authority) => {
    const engine = f.create((selected, run) =>
      f.store(selected, (state) =>
        run({
          ...state,
          async replace(value) {
            await state.replace(value);
            entered();
            await resumed;
          },
        }),
      ),
    );
    pending = engine.select({ binding, authority, comparisonId: "comparison" });
    await reached;
  });
  release();
  await expect(pending).rejects.toMatchObject(refusal("reauthentication_required"));
  expect(f.writes).toHaveLength(1);
  expect(await f.run()).toMatchObject({ identity: "0CNNW" });
  expect(f.writes).toHaveLength(1);
});

it.each(["scope", "bases", "contextKey"])(
  "refuses malformed fresh %s before any intent",
  async (field) => {
    const f = fixture();
    f.facts = {
      ...f.facts,
      [field]:
        field === "scope"
          ? { ...scope, environment: "wrong" }
          : field === "bases"
            ? [{ code: "", purpose: "standard" }]
            : "",
    };
    await expect(f.run()).rejects.toMatchObject(refusal("event_mismatch"));
    expect(f.writes).toEqual([]);
  },
);
it("refuses a select that names no clock comparison", async () => {
  const f = fixture();
  await withOperationAuthority(binding, "administrator", async (authority) => {
    await expect(
      f
        .create()
        .select({ binding, authority } as Parameters<
          ReturnType<typeof createHourSelection>["select"]
        >[0]),
    ).rejects.toMatchObject(refusal("event_mismatch"));
  });
  expect(f.writes).toEqual([]);
});
it.each([
  { targetMs: 1 },
  { targetMs: Date.parse("2026-10-24T09:02:00Z") + 1 },
  { kind: "unknown" },
])("a malformed persisted wait %j cannot release a minute", async (change) => {
  const f = fixture();
  f.at(Date.parse("2026-10-24T09:00:00Z"), 0);
  await f.run(setup);
  const value = structuredClone(f.value) as { entries: Record<string, unknown>[] };
  Object.assign(value.entries[0]!, change);
  f.value = value;
  await expect(f.run(setup)).rejects.toMatchObject(refusal("history_invalid"));
  expect(f.writes).toHaveLength(1);
});
it("two saved waits with the same target refuse", async () => {
  const f = fixture();
  f.at(Date.parse("2026-10-24T09:00:00Z"), 0);
  await f.run(setup);
  const value = structuredClone(f.value) as { entries: unknown[] };
  value.entries.push(structuredClone(value.entries[0]));
  f.value = value;
  await expect(f.run(setup)).rejects.toMatchObject(refusal("history_invalid"));
});
it("duplicate retained events refuse instead of selecting either copy", async () => {
  const f = fixture();
  await f.run();
  const value = structuredClone(f.value) as { entries: unknown[] };
  value.entries.push(structuredClone(value.entries[0]));
  f.value = value;
  await expect(f.run()).rejects.toMatchObject(refusal("history_invalid"));
});
it.each([-1, NaN, Infinity])(
  "an invalid monotonic reading %j cannot finish a wait",
  async (mono) => {
    const f = fixture();
    f.at(Date.parse("2026-10-24T09:00:00Z"), 0);
    await f.run(setup);
    const engine = createHourSelection({
      withState: f.store,
      read: async () => f.facts,
      monotonicNow: () => mono,
    });
    await withOperationAuthority(setup, "administrator", async (authority) => {
      await expect(
        engine.select({ binding: setup, authority, comparisonId: "comparison" }),
      ).rejects.toMatchObject(refusal("clock_unconfirmed"));
    });
  },
);
it("a process-local monotonic rollback cannot finish a wait", async () => {
  const f = fixture();
  f.at(instant, 100);
  await f.run(setup);
  f.at(instant + 1000, 50);
  await expect(f.run(setup)).rejects.toMatchObject(refusal("clock_unconfirmed"));
});

it("concurrent different events cannot both select the same current minute", async () => {
  const f = fixture();
  const results = await Promise.allSettled([
    f.run(),
    f.run({ ...binding, eventId: "other-event", sourceId: "other-attempt" }),
  ]);
  expect(results[0]).toMatchObject({ status: "fulfilled", value: { identity: "0CNNW" } });
  expect(results[1]).toMatchObject({
    status: "fulfilled",
    value: { status: "waiting", targetMs: Date.parse("2026-10-16T11:41:00Z") },
  });
  expect(f.writes).toHaveLength(2);
});

it("retains the issuing software ID as metadata in every spent intent", async () => {
  const f = fixture();
  await f.run();
  expect(f.value).toMatchObject({ entries: [expect.objectContaining({ softwareId: "W1" })] });
});

it("restoring an older module value cannot free an hour retained in a newer host revision", async () => {
  const f = fixture();
  await f.run();
  const old = structuredClone(f.value);
  f.at(Date.parse("2026-10-16T12:00:00Z"), 1_200_000);
  await f.run({ ...binding, eventId: "second", sourceId: "second-attempt" });
  f.value = old;
  expect(
    await f.run({ ...binding, eventId: "after-restore", sourceId: "after-restore-attempt" }),
  ).toMatchObject({ status: "waiting", targetMs: Date.parse("2026-10-16T12:01:00Z") });
  expect(f.writes).toHaveLength(3);
});

it("conflicting retained revisions for one exact event refuse instead of choosing the latest", async () => {
  const f = fixture();
  await f.run();
  const conflict = structuredClone(f.value) as {
    entries: { identity: string; issuedAt: string }[];
  };
  conflict.entries[0]!.identity = "0CNPG";
  conflict.entries[0]!.issuedAt = "2026-10-16T12:00:00.000Z";
  f.writes.push(conflict);
  await expect(f.run()).rejects.toMatchObject(refusal("history_invalid"));
});
it("retains the predecessor evidence references with the durable selected intent", async () => {
  const f = fixture();
  f.facts = {
    ...f.facts,
    history: [
      { reference: "predecessor-workspace", complete: true, records: [historyRow("00000")] },
    ],
  };
  await f.run();
  expect(f.value).toMatchObject({
    entries: [
      expect.objectContaining({
        references: ["predecessor-workspace", "retired-other-node", "retained-intents"],
      }),
    ],
  });
});

it("a host that omits retained revisions cannot authorise a fresh hour", async () => {
  const f = fixture();
  const engine = f.create((selected, run) =>
    f.store(selected, (state) => run({ value: state.value, replace: state.replace } as never)),
  );
  await withOperationAuthority(binding, "administrator", async (authority) => {
    await expect(
      engine.select({ binding, authority, comparisonId: "comparison" }),
    ).rejects.toMatchObject(refusal("history_invalid"));
  });
  expect(f.writes).toEqual([]);
});

it("keeps an unspent wait's target and monotonic progress when ownership changes", async () => {
  const f = fixture();
  f.facts = { ...f.facts, waitKey: "frozen-event" };
  f.at(Date.parse("2026-10-24T09:00:00Z"), 0);
  expect(await f.run(setup)).toMatchObject({
    status: "waiting",
    targetMs: Date.parse("2026-10-24T09:02:00Z"),
    remainingMs: 120_000,
  });
  f.at(Date.parse("2026-10-24T09:01:00Z"), 60_000);
  f.facts = { ...f.facts, contextKey: "owner-generation-2" };
  expect(await f.preview(setup)).toMatchObject({
    status: "waiting",
    targetMs: Date.parse("2026-10-24T09:02:00Z"),
    remainingMs: 60_000,
  });
  expect(f.writes).toHaveLength(1);
  f.at(Date.parse("2026-10-24T09:02:00Z"), 120_000);
  expect(await f.run(setup)).toMatchObject({
    status: "selected",
    identity: "0D0RY",
    contextKey: "owner-generation-2",
  });
  f.facts = { ...f.facts, contextKey: "owner-generation-3" };
  await expect(f.run(setup)).rejects.toMatchObject(refusal("event_mismatch"));
  expect(f.writes).toHaveLength(2);
});

it("a stable wait key does not permit changing the configured bases", async () => {
  const f = fixture();
  f.facts = { ...f.facts, waitKey: "frozen-event" };
  await f.run(setup);
  f.facts = {
    ...f.facts,
    contextKey: "owner-2",
    bases: [{ code: "changed", purpose: "standard" }, ...bases.slice(1)],
  };
  await expect(f.preview(setup)).rejects.toMatchObject(refusal("event_mismatch"));
  expect(f.writes).toHaveLength(1);
});

it("a different frozen event cannot reconnect to another event's wait", async () => {
  const f = fixture();
  f.facts = { ...f.facts, waitKey: "frozen-event" };
  await f.run(setup);
  f.facts = { ...f.facts, waitKey: "changed-event" };
  await expect(f.preview(setup)).rejects.toMatchObject(refusal("event_mismatch"));
  expect(f.writes).toHaveLength(1);
});

it("refuses an empty continuation key before recording a wait", async () => {
  const f = fixture();
  f.facts = { ...f.facts, waitKey: "" };
  await expect(f.run(setup)).rejects.toMatchObject(refusal("event_mismatch"));
  expect(f.writes).toEqual([]);
});

const at = (iso: string) => Date.parse(iso);
const activationRow = (identity: string, recordedAtMs: number | null) => ({
  reference: `registro_sif/${identity}`,
  kind: "activation",
  ...scope,
  softwareId: "W1",
  nodeId: "node0",
  identity,
  recordedAtMs,
});
function withHistory(f: ReturnType<typeof fixture>, records: unknown[]) {
  f.facts = { ...f.facts, history: [{ reference: "venue", complete: true, records }] };
}
const event = (base: OperationBinding, id: string) => ({ ...base, eventId: id, sourceId: id });

it("promote waits for the minute after a spent one, twice in a row", async () => {
  const f = fixture();
  withHistory(f, [activationRow("0D00B", at("2026-10-23T19:55:10Z"))]);
  f.at(at("2026-10-23T19:55:50Z"), 0);
  expect(await f.run()).toEqual({
    status: "waiting",
    targetMs: at("2026-10-23T19:56:00Z"),
    remainingMs: 10_000,
  });
  f.at(at("2026-10-23T19:56:00Z"), 10_000);
  expect(await f.run()).toMatchObject({ status: "selected", identity: "0D00C" });
  f.at(at("2026-10-23T19:56:30Z"), 40_000);
  expect(await f.run(event(binding, "third"))).toEqual({
    status: "waiting",
    targetMs: at("2026-10-23T19:57:00Z"),
    remainingMs: 30_000,
  });
});
it("waits for a next minute exactly 150 000 ms ahead and refuses one 150 001 ms ahead", async () => {
  const used = ["0D00B", "0D00C", "0D00D"].map((identity) => activationRow(identity, null));
  const f = fixture();
  withHistory(f, used);
  f.at(at("2026-10-23T19:55:30Z"), 0);
  expect(await f.run()).toMatchObject({ status: "waiting", remainingMs: 150_000 });
  const g = fixture();
  withHistory(g, used);
  g.at(at("2026-10-23T19:55:30Z") - 1, 0);
  await expect(g.run()).rejects.toMatchObject({
    params: { reason: "minute_in_use", allowedFromMs: at("2026-10-23T19:58:00Z") },
  });
  expect(g.writes).toEqual([]);
});
it.each([binding])("$action with no later history selects at once", async (base) => {
  const f = fixture();
  withHistory(f, [activationRow("0CNNW", at("2026-10-16T11:40:00Z"))]);
  f.at(at("2026-10-24T09:00:10Z"), 0);
  expect(await f.run(base)).toMatchObject({ status: "selected", identity: "0D0RW" });
});
it("restore waits until a minute start 90 to 150 seconds after its check", async () => {
  const f = fixture();
  withHistory(f, [activationRow("0CNNW", at("2026-10-16T11:40:00Z"))]);
  f.at(at("2026-10-24T09:00:04Z"), 0);
  expect(await f.run(restore)).toEqual({
    status: "waiting",
    targetMs: at("2026-10-24T09:02:00Z"),
    remainingMs: 116_000,
  });
  f.at(at("2026-10-24T09:01:59.999Z"), 115_999);
  expect(await f.run(restore)).toEqual({
    status: "waiting",
    targetMs: at("2026-10-24T09:02:00Z"),
    remainingMs: 1,
  });
  f.at(at("2026-10-24T09:02:00Z"), 116_000);
  expect(await f.run(restore)).toMatchObject({ status: "selected", identity: "0D0RY" });
});
it.each([setup, restore])(
  "a $action that has forgotten an earlier attempt's name still names a later minute when each clock was within 30 seconds",
  async (base) => {
    const selectPastWait = async (
      f: ReturnType<typeof fixture>,
      trueMs: number,
      boxErrorMs: number,
    ) => {
      f.at(trueMs + boxErrorMs, 0, trueMs);
      const waited = (await f.run(base)) as {
        status: string;
        targetMs: number;
        remainingMs: number;
      };
      expect(waited.status).toBe("waiting");
      f.at(waited.targetMs, waited.remainingMs, waited.targetMs - boxErrorMs);
      const selected = (await f.run(base)) as {
        status: string;
        identity: string;
        issuedAt: string;
      };
      expect(selected.status).toBe("selected");
      return selected;
    };
    const first = await selectPastWait(fixture(), at("2026-10-24T09:00:04Z"), 30_000);
    const firstTrueMs = Date.parse(first.issuedAt) - 30_000;
    const second = await selectPastWait(fixture(), firstTrueMs + 1_000, -30_000);
    expect(decodeMinuteIdentity(second.identity)).toBeGreaterThan(
      decodeMinuteIdentity(first.identity),
    );
  },
);
it.each([
  ["2026-10-24T09:00:00.000Z", "2026-10-24T09:02:00Z", 120_000],
  ["2026-10-24T09:00:30.000Z", "2026-10-24T09:03:00Z", 150_000],
  ["2026-10-24T09:00:29.999Z", "2026-10-24T09:02:00Z", 90_001],
])("setup checked at %s waits until %s", async (box, target, remainingMs) => {
  const f = fixture();
  f.at(at(box), 0);
  expect(await f.run(setup)).toEqual({ status: "waiting", targetMs: at(target), remainingMs });
});
it("every setup wait over a minute of box readings lies in (90 000, 150 000]", async () => {
  for (let index = 0; index < 600; index++) {
    const f = fixture();
    const box = at("2026-10-24T09:00:00Z") + index * 100 + (index % 7);
    f.at(box, 0);
    const result = (await f.run(setup)) as { targetMs: number };
    expect(result.targetMs % 60_000).toBe(0);
    expect(result.targetMs - box).toBeGreaterThan(90_000);
    expect(result.targetMs - box).toBeLessThanOrEqual(150_000);
  }
});
it("a restart keeps the recorded target", async () => {
  const f = fixture();
  f.at(at("2026-10-24T09:00:04Z"), 0);
  await f.run(setup);
  f.restart();
  f.at(at("2026-10-24T09:01:00Z"), 5);
  expect(await f.run(setup)).toEqual({
    status: "waiting",
    targetMs: at("2026-10-24T09:02:00Z"),
    remainingMs: 60_000,
  });
  expect(f.writes).toHaveLength(1);
});
it("a select more than a minute after its wait's target starts a new wait", async () => {
  const f = fixture();
  f.at(at("2026-10-24T09:00:04Z"), 0);
  await f.run(setup);
  f.restart();
  f.at(at("2026-10-24T10:00:04Z"), 0);
  expect(await f.run(setup)).toEqual({
    status: "waiting",
    targetMs: at("2026-10-24T10:02:00Z"),
    remainingMs: 116_000,
  });
  expect(f.writes).toHaveLength(2);
  const g = fixture();
  g.at(at("2026-10-24T09:00:04Z"), 0);
  await g.run(setup);
  g.restart();
  g.at(at("2026-10-24T09:02:59Z"), 0);
  expect(await g.run(setup)).toMatchObject({ status: "selected", identity: "0D0RY" });
});
it("returns a name already recorded again with no new wait", async () => {
  const f = fixture();
  f.at(at("2026-10-24T09:00:04Z"), 0);
  await f.run(setup);
  f.at(at("2026-10-24T09:02:00Z"), 116_000);
  const selected = await f.run(setup);
  f.at(at("2026-10-24T11:00:00Z"), 7_316_000);
  expect(await f.run(setup)).toEqual(selected);
  expect(f.writes).toHaveLength(2);
});
it("a preview reports a recorded wait, and with none answers preview, writing nothing", async () => {
  const f = fixture();
  f.at(at("2026-10-24T09:00:04Z"), 0);
  expect(await f.preview(setup)).toMatchObject({ status: "preview", identity: "0D0RW" });
  expect(f.writes).toEqual([]);
  await f.run(setup);
  f.at(at("2026-10-24T09:01:04Z"), 60_000);
  expect(await f.preview(setup)).toEqual({
    status: "waiting",
    targetMs: at("2026-10-24T09:02:00Z"),
    remainingMs: 56_000,
  });
  expect(f.writes).toHaveLength(1);
});
it("records the intent durably before the select resolves selected", async () => {
  const f = fixture();
  const order: string[] = [];
  const engine = f.create((selected, run) =>
    f.store(selected, (state) =>
      run({
        ...state,
        async replace(value) {
          order.push(`replace ${JSON.stringify(value).includes('"kind":"intent"')}`);
          await state.replace(value);
        },
      }),
    ),
  );
  const result = await withOperationAuthority(binding, "administrator", (authority) =>
    engine.select({ binding, authority, comparisonId: "comparison" }),
  );
  order.push(`resolved ${result.status}`);
  expect(order).toEqual(["replace true", "resolved selected"]);
});
it.each([restore, setup, binding])(
  "a $action preview with no recorded wait never counts down a target it has not saved",
  async (base) => {
    const f = fixture();
    withHistory(f, [activationRow("0D0RW", at("2026-10-24T09:00:10Z"))]);
    f.at(at("2026-10-24T09:00:30Z"), 0);
    expect(await f.preview(base)).toMatchObject({ status: "preview" });
    expect(f.writes).toEqual([]);
  },
);
it("refuses a new wait whose target is not later than a recorded one", async () => {
  const f = fixture();
  withHistory(f, [activationRow("0D00B", at("2026-10-23T19:55:10Z"))]);
  f.at(at("2026-10-23T19:55:50Z"), 0);
  await f.run();
  const value = structuredClone(f.value) as { entries: { targetMs: number }[] };
  value.entries[0]!.targetMs = at("2026-10-23T19:57:00Z");
  f.value = value;
  f.writes.splice(0, f.writes.length, structuredClone(value));
  await expect(f.run()).rejects.toMatchObject(refusal("history_invalid"));
  expect(f.writes).toHaveLength(1);
});
it.each([
  ["2026-10-24T09:03:00.000Z", { status: "selected", identity: "0D0RZ" }, 1],
  ["2026-10-24T09:03:00.001Z", { status: "waiting", targetMs: at("2026-10-24T09:05:00Z") }, 2],
])(
  "a recorded wait is reused up to a minute past its target: select at %s",
  async (when, expected, waits) => {
    const f = fixture();
    f.at(at("2026-10-24T09:00:04Z"), 0);
    await f.run(setup);
    f.restart();
    f.at(at(when), 0);
    expect(await f.run(setup)).toMatchObject(expected);
    expect(
      (f.value as { entries: { kind: string }[] }).entries.filter((entry) => entry.kind === "wait"),
    ).toHaveLength(waits);
  },
);

function spiedEngine(f: ReturnType<typeof fixture>) {
  const replaced: unknown[] = [];
  const engine = f.create((selected, run) =>
    f.store(selected, (state) =>
      run({
        ...state,
        async replace(value, ...rest) {
          replaced.push(structuredClone(value));
          await state.replace(value, ...rest);
        },
      }),
    ),
  );
  return { engine, replaced };
}
async function setupPickedAt0902() {
  const f = fixture();
  f.facts = { ...f.facts, waitKey: "frozen-event" };
  f.at(at("2026-10-24T09:00:00Z"), 0);
  await f.run(setup);
  f.at(at("2026-10-24T09:02:00Z"), 120_000);
  expect(await f.run(setup)).toMatchObject({ status: "selected", identity: "0D0RY" });
  expect(f.writes).toHaveLength(2);
  return f;
}
it("a resume under a clock behind its own pick refuses before writing anything", async () => {
  const f = await setupPickedAt0902();
  f.facts = { ...f.facts, contextKey: "owner-generation-2" };
  f.at(at("2026-10-24T08:52:00Z"), 0);
  const { engine, replaced } = spiedEngine(f);
  await withOperationAuthority(setup, "administrator", async (authority) => {
    await expect(
      engine.resume({ binding: setup, authority, documentBinding: "a".repeat(64), validate() {} }),
    ).rejects.toMatchObject(refusal("minute_not_later"));
  });
  expect(replaced).toEqual([]);
  expect(f.writes).toHaveLength(2);
});
it("control: a new pick a minute after a recorded pick writes one wait the spy sees", async () => {
  const f = await setupPickedAt0902();
  f.at(at("2026-10-24T09:03:00Z"), 180_000);
  const { engine, replaced } = spiedEngine(f);
  const other = event(setup, "other");
  await withOperationAuthority(other, "administrator", async (authority) => {
    expect(
      await engine.select({ binding: other, authority, comparisonId: "comparison" }),
    ).toMatchObject({ status: "waiting", targetMs: at("2026-10-24T09:05:00Z") });
  });
  expect(replaced).toHaveLength(1);
  expect((replaced[0] as { entries: { kind: string }[] }).entries.at(-1)).toMatchObject({
    kind: "wait",
    binding: other,
    targetMs: at("2026-10-24T09:05:00Z"),
  });
});
it("control: the same resume with the clock at its pick writes a resumption the spy sees", async () => {
  const f = await setupPickedAt0902();
  f.facts = { ...f.facts, contextKey: "owner-generation-2" };
  f.at(at("2026-10-24T09:02:00Z"), 0);
  const { engine, replaced } = spiedEngine(f);
  await withOperationAuthority(setup, "administrator", async (authority) => {
    expect(
      await engine.resume({
        binding: setup,
        authority,
        documentBinding: "a".repeat(64),
        validate() {},
      }),
    ).toMatchObject({ status: "selected", identity: "0D0RY" });
  });
  expect(replaced).toHaveLength(1);
  expect((replaced[0] as { entries: { kind: string }[] }).entries.at(-1)).toMatchObject({
    kind: "resume",
    contextKey: "owner-generation-2",
  });
});
