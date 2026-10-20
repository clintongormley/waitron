import { expect, it } from "vitest";
import { withOperationAuthority, type OperationBinding } from "@waitron/module";
import { compareHourClocks } from "./hour-clock.js";
import { createHourPreparation } from "./hour-preparation.js";
import type { HourSelectionFacts } from "./hour-selection.js";

const binding: OperationBinding = {
  module: "fiscal-verifactu",
  action: "setup",
  eventId: "event",
  sourceId: "attempt",
  targetNodeId: "node",
};
const at = Date.parse("2026-10-16T11:40:00Z");
function clock(instant = at) {
  return compareHourClocks(
    ["box", "browser"].map((source) => ({
      source: source as "box" | "browser",
      result: "usable" as const,
      instantMs: instant,
      uncertaintyMs: 0,
      wallStartedMs: instant,
      wallFinishedMs: instant,
      monotonicStartedMs: 0,
      monotonicFinishedMs: 0,
    })),
    Date.parse("2026-10-15T00:00:00Z"),
  );
}
function fixture() {
  let value: unknown = null;
  const history: unknown[] = [];
  let facts: HourSelectionFacts = {
    scope: { taxpayerNif: "89890001K", environment: "preproduction" },
    bases: [
      { code: "A", purpose: "standard" },
      { code: "FF", purpose: "full" },
      { code: "R", purpose: "rectificative" },
    ],
    contextKey: "owner-1",
    waitKey: "identical-frozen-context",
    clock: clock(),
    history: [{ reference: "venue", complete: true, records: [] }],
  };
  const preparation = createHourPreparation({
    monotonicNow: () => 0,
    read: async () => facts,
    withState: async (_, body) =>
      body({
        get value() {
          return structuredClone(value);
        },
        get history() {
          return structuredClone(history);
        },
        async replace(next) {
          value = structuredClone(next);
          history.push(value);
        },
      }),
  });
  return {
    preparation,
    history,
    get facts() {
      return facts;
    },
    set facts(next: HourSelectionFacts) {
      facts = next;
    },
    select: () =>
      withOperationAuthority(binding, "admin", (authority) =>
        preparation.select({ binding, authority, answer: "no" }),
      ),
    resume: (input: unknown, digest = "a".repeat(64)) =>
      withOperationAuthority(binding, "admin", (authority) =>
        preparation.resume({ binding, authority, input }, digest),
      ),
    prepare: (input: unknown) =>
      withOperationAuthority(binding, "admin", (authority) =>
        preparation.prepare({ binding, authority, input }, async () => "admitted"),
      ),
  };
}
const refused = (reason: string) => ({ code: "sif.allocation_invalid", params: { reason } });

it("explicit resumption keeps the hour and input while ordinary changed-context admission still refuses", async () => {
  const f = fixture();
  const selected = await f.select();
  if (selected.status !== "selected") throw new Error("expected selection");
  f.facts = { ...f.facts, contextKey: "owner-2", clock: clock(at + 3_600_000) };
  await expect(f.prepare(selected.input)).rejects.toMatchObject(refused("event_mismatch"));
  await f.resume(selected.input);
  await expect(f.prepare(selected.input)).resolves.toBe("admitted");
  expect(f.history).toHaveLength(2);
  expect(f.history[1]).toMatchObject({
    entries: [
      { kind: "intent", identity: "06RB", contextKey: "owner-1" },
      {
        kind: "resume",
        identity: "06RB",
        fromContextKey: "owner-1",
        contextKey: "owner-2",
        documentBinding: "a".repeat(64),
      },
    ],
  });
  f.facts = { ...f.facts, contextKey: "owner-1" };
  await expect(f.prepare(selected.input)).rejects.toMatchObject(refused("event_mismatch"));
});

it("a later authenticated resumption appends a continuous owner trail", async () => {
  const f = fixture();
  const selected = await f.select();
  if (selected.status !== "selected") throw new Error("expected selection");
  for (const contextKey of ["owner-2", "owner-3"]) {
    f.facts = { ...f.facts, contextKey };
    await f.resume(selected.input);
  }
  await expect(f.prepare(selected.input)).resolves.toBe("admitted");
  expect(f.history).toHaveLength(3);
});

it.each([
  "input",
  "taxpayer",
  "environment",
  "bases",
  "administrator",
  "frozen-context",
  "document",
])("resumption refuses changed %s before recording a new owner", async (change) => {
  const f = fixture();
  const selected = await f.select();
  if (selected.status !== "selected") throw new Error("expected selection");
  const input = structuredClone(selected.input);
  f.facts = { ...f.facts, contextKey: "owner-2" };
  if (change === "input") input.allocation.installationIdentity = "06RC";
  if (change === "administrator") input.approval.operatorId = "other";
  if (change === "taxpayer")
    f.facts = { ...f.facts, scope: { ...f.facts.scope, taxpayerNif: "89890002E" } };
  if (change === "environment")
    f.facts = { ...f.facts, scope: { ...f.facts.scope, environment: "production" } };
  if (change === "bases")
    f.facts = { ...f.facts, bases: [...f.facts.bases, { code: "B", purpose: "standard" }] };
  if (change === "frozen-context") f.facts = { ...f.facts, waitKey: "changed-location" };
  await expect(f.resume(input, change === "document" ? "" : "a".repeat(64))).rejects.toMatchObject({
    code: "sif.allocation_invalid",
  });
  expect(f.history).toHaveLength(1);
});

it("fresh clock confirmation is still required for resumption", async () => {
  const f = fixture();
  const selected = await f.select();
  if (selected.status !== "selected") throw new Error("expected selection");
  f.facts = {
    ...f.facts,
    contextKey: "owner-2",
    clock: compareHourClocks(
      [
        {
          source: "box",
          result: "usable",
          instantMs: at,
          uncertaintyMs: 0,
          wallStartedMs: at,
          wallFinishedMs: at,
          monotonicStartedMs: 0,
          monotonicFinishedMs: 0,
        },
      ],
      Date.parse("2026-10-15T00:00:00Z"),
    ),
  };
  await expect(f.resume(selected.input)).rejects.toMatchObject(refused("clock_unconfirmed"));
  expect(f.history).toHaveLength(1);
});

it("a further owner cannot resume with a different document binding", async () => {
  const f = fixture();
  const selected = await f.select();
  if (selected.status !== "selected") throw new Error("expected selection");
  f.facts = { ...f.facts, contextKey: "owner-2" };
  await f.resume(selected.input);
  f.facts = { ...f.facts, contextKey: "owner-3" };
  await expect(f.resume(selected.input, "b".repeat(64))).rejects.toMatchObject(
    refused("event_mismatch"),
  );
  expect(f.history).toHaveLength(2);
});

it.each(["known-later-hour", "clock-rollback"])(
  "resumption preserves the %s floor",
  async (change) => {
    const f = fixture();
    const selected = await f.select();
    if (selected.status !== "selected") throw new Error("expected selection");
    f.facts = { ...f.facts, contextKey: "owner-2" };
    if (change === "clock-rollback") f.facts = { ...f.facts, clock: clock(at - 1000) };
    else
      f.facts = {
        ...f.facts,
        history: [
          {
            reference: "venue",
            complete: true,
            records: [
              {
                taxpayerNif: "89890001K",
                environment: "preproduction",
                reference: "other-node",
                kind: "intent",
                softwareId: "OTHER",
                nodeId: "other",
                identity: "06RC",
                recordedAtMs: null,
              },
            ],
          },
        ],
      };
    await expect(f.resume(selected.input)).rejects.toMatchObject(refused("hour_not_later"));
    expect(f.history).toHaveLength(1);
  },
);

it.each(["broken-chain", "wrong-document", "changed-hour"])(
  "a %s in the retained resumption journal refuses admission",
  async (change) => {
    const f = fixture();
    const selected = await f.select();
    if (selected.status !== "selected") throw new Error("expected selection");
    f.facts = { ...f.facts, contextKey: "owner-2" };
    await f.resume(selected.input);
    const latest = f.history.at(-1) as { entries: Record<string, unknown>[] };
    const resumed = latest.entries.at(-1)!;
    if (change === "broken-chain") resumed.fromContextKey = "unrelated-owner";
    if (change === "wrong-document") resumed.documentBinding = "invalid";
    if (change === "changed-hour") resumed.identity = "06RC";
    await expect(f.prepare(selected.input)).rejects.toMatchObject(refused("history_invalid"));
  },
);

it("resumption cannot select an hour for an event without an intent", async () => {
  const f = fixture();
  await expect(f.resume({})).rejects.toMatchObject(refused("reservation_missing"));
  expect(f.history).toEqual([]);
});

it("an orphan resumption for another event cannot disappear from known-history checks", async () => {
  const f = fixture();
  const selected = await f.select();
  if (selected.status !== "selected") throw new Error("expected selection");
  f.facts = { ...f.facts, contextKey: "owner-2" };
  await f.resume(selected.input);
  const latest = f.history.at(-1) as {
    entries: { binding: OperationBinding; [key: string]: unknown }[];
  };
  const orphan = structuredClone(latest.entries.at(-1)!);
  orphan.binding = { ...orphan.binding, eventId: "other-event" };
  latest.entries.push(orphan);
  await expect(f.prepare(selected.input)).rejects.toMatchObject(refused("history_invalid"));
});
