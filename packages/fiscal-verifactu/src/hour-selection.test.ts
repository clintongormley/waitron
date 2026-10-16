import { expect, it } from "vitest";
import { withOperationAuthority, type OperationBinding } from "@waitron/module";
import { compareHourClocks, confirmHourClock, type HourClockObservation } from "./hour-clock.js";
import {
  createHourSelection,
  type HourSelectionFacts,
  type HourSelectionStore,
} from "./hour-selection.js";

const binding: OperationBinding = {
  module: "fiscal-verifactu",
  action: "setup",
  eventId: "event1",
  sourceId: "attempt1",
  targetNodeId: "node1",
};
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
    run(answer: "no" | "yes" | "unknown" = "no", selected = binding, confirmation?: object) {
      return withOperationAuthority(selected, "administrator", (authority) =>
        engine.select({ binding: selected, authority, answer, confirmation }),
      );
    },
    preview() {
      return withOperationAuthority(binding, "administrator", (authority) =>
        engine.preview({ binding, authority }),
      );
    },
  };
}

it("exposes an hour only after its complete bound intent is persisted", async () => {
  const f = fixture();
  const result = await f.run();
  expect(result).toMatchObject({
    status: "selected",
    identity: "06RB",
    issuedAt: "2026-10-16T11:40:00.000Z",
    binding,
    scope,
    bases,
  });
  expect(f.writes).toHaveLength(1);
  expect(f.writes[0]).toMatchObject({
    version: 1,
    entries: [expect.objectContaining({ kind: "intent", identity: "06RB", binding, scope, bases })],
  });
});

const refusal = (reason: string) => ({ code: "sif.allocation_invalid", params: { reason } });
const historyRow = (identity = "06RC", change: Record<string, unknown> = {}) => ({
  ...scope,
  reference: "retired-other-node",
  kind: "retirement",
  identity,
  softwareId: "OTHER",
  nodeId: "node2",
  recordedAtMs: null,
  ...change,
});
it.each(["06RB", "06RC", "ZZZZ"])(
  "refuses current/lower hour against known %s instead of inventing maximum plus one",
  async (identity) => {
    const f = fixture();
    f.facts = {
      ...f.facts,
      history: [{ reference: "retired", complete: true, records: [historyRow(identity)] }],
    };
    await expect(f.run()).rejects.toMatchObject(refusal("hour_not_later"));
    expect(f.writes).toEqual([]);
  },
);
it("allows the current hour strictly later than retained epoch hour zero", async () => {
  const f = fixture();
  f.facts = {
    ...f.facts,
    history: [{ reference: "old", complete: true, records: [historyRow("0000")] }],
  };
  expect(await f.run()).toMatchObject({ status: "selected", identity: "06RB" });
});
it("refuses before the recorded time floor even when the identity floor is lower", async () => {
  const f = fixture();
  f.facts = {
    ...f.facts,
    history: [
      {
        reference: "old",
        complete: true,
        records: [historyRow("0000", { recordedAtMs: instant + 1 })],
      },
    ],
  };
  await expect(f.run()).rejects.toMatchObject(refusal("hour_not_later"));
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
  expect(await f.preview()).toMatchObject({ status: "preview", identity: "06RB" });
  expect(f.writes).toEqual([]);
  f.at(Date.parse("2026-10-16T12:00:00Z"), 1_200_000);
  expect(await f.run()).toMatchObject({ status: "selected", identity: "06RC" });
});
it("serializes concurrent exact requests into one intent", async () => {
  const f = fixture();
  const [a, b] = await Promise.all([f.run(), f.run()]);
  expect(a).toEqual(b);
  expect(f.writes).toHaveLength(1);
});
it("retains abandoned or uncertain intent and demands a later current hour for its replacement", async () => {
  const f = fixture();
  await f.run();
  const next = { ...binding, eventId: "replacement", sourceId: "replacement-attempt" };
  await expect(f.run("no", next)).rejects.toMatchObject(refusal("hour_not_later"));
  f.at(Date.parse("2026-10-16T12:00:00Z"), 1_200_000);
  expect(await f.run("no", next)).toMatchObject({ status: "selected", identity: "06RC" });
  expect(f.value).toMatchObject({
    entries: [
      expect.objectContaining({ identity: "06RB" }),
      expect.objectContaining({ identity: "06RC" }),
    ],
  });
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
      f.run("no", { ...binding, [field]: field === "action" ? "restore" : "changed" }),
    ).rejects.toMatchObject(refusal("event_mismatch"));
  },
);
it("compares a changed clock again before returning an existing intent", async () => {
  const f = fixture();
  await f.run();
  f.at(instant, 1, instant + 300_000);
  await expect(f.run()).rejects.toMatchObject(refusal("clock_unconfirmed"));
});
it("requires authentic fresh clock decisions and bound confirmations", async () => {
  const f = fixture();
  f.at(instant, 0, instant + 300_000);
  await expect(f.run()).rejects.toMatchObject(refusal("clock_unconfirmed"));
  await expect(f.run("no", binding, {})).rejects.toMatchObject(refusal("clock_unconfirmed"));
  const confirmation = confirmHourClock(f.facts.clock);
  expect(await f.run("no", binding, confirmation)).toMatchObject({
    status: "selected",
    identity: "06RB",
  });
});
it.each(["yes", "unknown"] as const)(
  "persists %s's original UTC wait target and reconnects to it",
  async (answer) => {
    const f = fixture();
    expect(await f.run(answer)).toMatchObject({
      status: "waiting",
      targetMs: Date.parse("2026-10-16T12:00:00Z"),
      remainingMs: 1_200_000,
    });
    f.at(Date.parse("2026-10-16T11:50:00Z"), 600_000);
    expect(await f.run(answer)).toMatchObject({
      status: "waiting",
      targetMs: Date.parse("2026-10-16T12:00:00Z"),
      remainingMs: 600_000,
    });
    expect(f.writes).toHaveLength(1);
    f.at(Date.parse("2026-10-16T12:00:00Z"), 1_200_000);
    expect(await f.run(answer)).toMatchObject({ status: "selected", identity: "06RC" });
  },
);
it("cannot skip a recorded wait by changing the taxpayer-wide answer", async () => {
  const f = fixture();
  await f.run("yes");
  await expect(f.run("no")).rejects.toMatchObject(refusal("event_mismatch"));
});
it("a forward wall-clock jump cannot finish an in-process wait early", async () => {
  const f = fixture();
  await f.run("yes");
  f.at(Date.parse("2026-10-16T13:00:00Z"), 1000);
  expect(await f.run("yes")).toMatchObject({ status: "waiting", remainingMs: 1_199_000 });
  expect(f.writes).toHaveLength(1);
});
it("restart obtains fresh comparisons without trusting old monotonic readings or downtime", async () => {
  const f = fixture();
  await f.run("yes");
  f.restart();
  f.at(Date.parse("2026-10-16T11:50:00Z"), 10);
  expect(await f.run("yes")).toMatchObject({ status: "waiting", remainingMs: 600_000 });
  f.at(Date.parse("2026-10-16T12:00:00Z"), 600_010);
  expect(await f.run("yes")).toMatchObject({ status: "selected", identity: "06RC" });
});
it("restart after a verified target has passed needs no invented extra hour", async () => {
  const f = fixture();
  await f.run("yes");
  f.restart();
  f.at(Date.parse("2026-10-16T12:10:00Z"), 0);
  expect(await f.run("yes")).toMatchObject({ status: "selected", identity: "06RC" });
});
it("an unresolved restart comparison retains the wait instead of completing it", async () => {
  const f = fixture();
  await f.run("yes");
  f.restart();
  f.at(Date.parse("2026-10-16T12:10:00Z"), 0, Date.parse("2026-10-16T11:10:00Z"));
  expect(await f.run("yes")).toMatchObject({ status: "waiting", requiresClockConfirmation: true });
  expect(f.writes).toHaveLength(1);
  expect(await f.run("yes", binding, confirmHourClock(f.facts.clock))).toMatchObject({
    status: "selected",
    identity: "06RC",
  });
});
it("a backward clock refuses existing material and retains its spent hour", async () => {
  const f = fixture();
  await f.run();
  f.at(instant - 1, 1);
  await expect(f.run()).rejects.toMatchObject(refusal("hour_not_later"));
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
    await expect(before.select({ binding, authority, answer: "no" })).rejects.toThrow(
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
    await expect(after.select({ binding, authority, answer: "no" })).rejects.toThrow(
      "lost durable reply",
    );
  });
  expect(await f.run()).toMatchObject({ status: "selected", identity: "06RB" });
  expect(f.writes).toHaveLength(1);
});
it("expired authority cannot select and expiry during persistence cannot expose material", async () => {
  const f = fixture();
  const authority = await withOperationAuthority(
    binding,
    "administrator",
    async (authority) => authority,
  );
  await expect(f.create().select({ binding, authority, answer: "no" })).rejects.toMatchObject(
    refusal("reauthentication_required"),
  );
  expect(f.writes).toEqual([]);
  let pending!: Promise<unknown>;
  await withOperationAuthority(binding, "administrator", async (active) => {
    pending = f
      .create(async (_selected, run) => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        return f.store(binding, run);
      })
      .select({ binding, authority: active, answer: "no" });
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
    pending = engine.select({ binding, authority, answer: "no" });
    await reached;
  });
  release();
  await expect(pending).rejects.toMatchObject(refusal("reauthentication_required"));
  expect(f.writes).toHaveLength(1);
  expect(await f.run()).toMatchObject({ identity: "06RB" });
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
it("refuses a taxpayer declaration outside the three offered answers", async () => {
  const f = fixture();
  await withOperationAuthority(binding, "administrator", async (authority) => {
    await expect(
      f.create().select({ binding, authority, answer: "maybe" as never }),
    ).rejects.toMatchObject(refusal("event_mismatch"));
  });
  expect(f.writes).toEqual([]);
});
it.each([{ targetMs: 1 }, { answer: "no" }, { kind: "unknown" }])(
  "a malformed persisted wait %j cannot release an hour",
  async (change) => {
    const f = fixture();
    await f.run("yes");
    const value = structuredClone(f.value) as { entries: Record<string, unknown>[] };
    Object.assign(value.entries[0]!, change);
    f.value = value;
    await expect(f.run("yes")).rejects.toMatchObject(refusal("history_invalid"));
    expect(f.writes).toHaveLength(1);
  },
);
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
    await f.run("yes");
    const engine = createHourSelection({
      withState: f.store,
      read: async () => f.facts,
      monotonicNow: () => mono,
    });
    await withOperationAuthority(binding, "administrator", async (authority) => {
      await expect(engine.select({ binding, authority, answer: "yes" })).rejects.toMatchObject(
        refusal("clock_unconfirmed"),
      );
    });
  },
);
it("a process-local monotonic rollback cannot finish a wait", async () => {
  const f = fixture();
  f.at(instant, 100);
  await f.run("yes");
  f.at(instant + 1000, 50);
  await expect(f.run("yes")).rejects.toMatchObject(refusal("clock_unconfirmed"));
});

it("concurrent different events cannot both select the same current hour", async () => {
  const f = fixture();
  const results = await Promise.allSettled([
    f.run(),
    f.run("no", { ...binding, eventId: "other-event", sourceId: "other-attempt" }),
  ]);
  expect(results[0]).toMatchObject({ status: "fulfilled", value: { identity: "06RB" } });
  expect(results[1]).toMatchObject({ status: "rejected", reason: refusal("hour_not_later") });
  expect(f.writes).toHaveLength(1);
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
  await f.run("no", { ...binding, eventId: "second", sourceId: "second-attempt" });
  f.value = old;
  await expect(
    f.run("no", { ...binding, eventId: "after-restore", sourceId: "after-restore-attempt" }),
  ).rejects.toMatchObject(refusal("hour_not_later"));
  expect(f.writes).toHaveLength(2);
});

it("conflicting retained revisions for one exact event refuse instead of choosing the latest", async () => {
  const f = fixture();
  await f.run();
  const conflict = structuredClone(f.value) as {
    entries: { identity: string; issuedAt: string }[];
  };
  conflict.entries[0]!.identity = "06RC";
  conflict.entries[0]!.issuedAt = "2026-10-16T12:00:00.000Z";
  f.writes.push(conflict);
  await expect(f.run()).rejects.toMatchObject(refusal("history_invalid"));
});
it("retains the predecessor evidence references with the durable selected intent", async () => {
  const f = fixture();
  f.facts = {
    ...f.facts,
    history: [
      { reference: "predecessor-workspace", complete: true, records: [historyRow("0000")] },
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
    await expect(engine.select({ binding, authority, answer: "no" })).rejects.toMatchObject(
      refusal("history_invalid"),
    );
  });
  expect(f.writes).toEqual([]);
});

it("accepts only a matching clock confirmation from the trusted facts reader", async () => {
  const f = fixture();
  f.at(instant, 0, instant + 300_000);
  f.facts = Object.assign({}, f.facts, { confirmation: confirmHourClock(f.facts.clock) });
  expect(await f.run()).toMatchObject({ status: "selected", identity: "06RB" });
  const before = f.writes.length;
  f.at(instant, 1, instant + 400_000);
  await expect(f.run()).rejects.toMatchObject(refusal("clock_unconfirmed"));
  expect(f.writes).toHaveLength(before);
});
