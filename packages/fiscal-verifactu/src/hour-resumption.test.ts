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
    // Two minutes before `at`, so the name taken after the setup's settle wait is `at`'s.
    clock: clock(at - 120_000),
    history: [{ reference: "venue", complete: true, records: [] }],
  };
  let monotonic = 0;
  const preparation = createHourPreparation({
    monotonicNow: () => monotonic,
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
    async select() {
      const run = () =>
        withOperationAuthority(binding, "admin", (authority) =>
          preparation.select({ binding, authority, comparisonId: "comparison" }),
        );
      const waiting = await run();
      if (waiting.status !== "waiting") throw new Error("setup did not wait");
      facts = { ...facts, clock: clock(waiting.targetMs) };
      monotonic += waiting.remainingMs;
      return run();
    },
    /** Appends a resumption entry as stored data, the shape an earlier setup left behind. */
    storeResumption(contextKey: string, documentBinding = "a".repeat(64)) {
      const entries = structuredClone((value as { entries: Record<string, unknown>[] }).entries);
      const intent = entries.find((entry) => entry.kind === "intent")!;
      const from = entries.filter((entry) => entry.kind === "resume").at(-1) ?? intent;
      entries.push({
        ...intent,
        kind: "resume",
        fromContextKey: from.contextKey,
        contextKey,
        documentBinding,
      });
      value = { version: 1, entries };
      history.push(value);
    },
    prepare: (input: unknown) =>
      withOperationAuthority(binding, "admin", (authority) =>
        preparation.prepare({ binding, authority, input }, async () => "admitted"),
      ),
  };
}
const refused = (reason: string) => ({ code: "sif.allocation_invalid", params: { reason } });

it("a stored resumption keeps the hour and input while changed-context admission without one still refuses", async () => {
  const f = fixture();
  const selected = await f.select();
  if (selected.status !== "selected") throw new Error("expected selection");
  f.facts = { ...f.facts, contextKey: "owner-2", clock: clock(at + 3_600_000) };
  await expect(f.prepare(selected.input)).rejects.toMatchObject(refused("event_mismatch"));
  f.storeResumption("owner-2");
  await expect(f.prepare(selected.input)).resolves.toBe("admitted");
  f.facts = { ...f.facts, contextKey: "owner-1" };
  await expect(f.prepare(selected.input)).rejects.toMatchObject(refused("event_mismatch"));
});

it("a stored continuous owner trail admits its latest owner", async () => {
  const f = fixture();
  const selected = await f.select();
  if (selected.status !== "selected") throw new Error("expected selection");
  for (const contextKey of ["owner-2", "owner-3"]) f.storeResumption(contextKey);
  f.facts = { ...f.facts, contextKey: "owner-3" };
  await expect(f.prepare(selected.input)).resolves.toBe("admitted");
});

it("stored resumptions under different document bindings refuse admission", async () => {
  const f = fixture();
  const selected = await f.select();
  if (selected.status !== "selected") throw new Error("expected selection");
  f.storeResumption("owner-2");
  f.storeResumption("owner-3", "b".repeat(64));
  f.facts = { ...f.facts, contextKey: "owner-3" };
  await expect(f.prepare(selected.input)).rejects.toMatchObject(refused("history_invalid"));
});

it.each(["broken-chain", "wrong-document", "changed-hour"])(
  "a %s in the retained resumption journal refuses admission",
  async (change) => {
    const f = fixture();
    const selected = await f.select();
    if (selected.status !== "selected") throw new Error("expected selection");
    f.facts = { ...f.facts, contextKey: "owner-2" };
    f.storeResumption("owner-2");
    const latest = f.history.at(-1) as { entries: Record<string, unknown>[] };
    const resumed = latest.entries.at(-1)!;
    if (change === "broken-chain") resumed.fromContextKey = "unrelated-owner";
    if (change === "wrong-document") resumed.documentBinding = "invalid";
    if (change === "changed-hour") resumed.identity = "0CNPG";
    await expect(f.prepare(selected.input)).rejects.toMatchObject(refused("history_invalid"));
  },
);

it("an orphan resumption for another event cannot disappear from known-history checks", async () => {
  const f = fixture();
  const selected = await f.select();
  if (selected.status !== "selected") throw new Error("expected selection");
  f.facts = { ...f.facts, contextKey: "owner-2" };
  f.storeResumption("owner-2");
  const latest = f.history.at(-1) as {
    entries: { binding: OperationBinding; [key: string]: unknown }[];
  };
  const orphan = structuredClone(latest.entries.at(-1)!);
  orphan.binding = { ...orphan.binding, eventId: "other-event" };
  latest.entries.push(orphan);
  await expect(f.prepare(selected.input)).rejects.toMatchObject(refused("history_invalid"));
});

it("a stored resume entry carries its minute to the new owner, so no other minute is taken", async () => {
  const f = fixture();
  const selected = await f.select();
  if (selected.status !== "selected") throw new Error("expected selection");
  f.facts = { ...f.facts, contextKey: "owner-2", clock: clock(at + 3_600_000) };
  f.storeResumption("owner-2");
  const stored = f.history.length;
  const again = await withOperationAuthority(binding, "admin", (authority) =>
    f.preparation.select({ binding, authority, comparisonId: "comparison" }),
  );
  expect(again).toMatchObject({ status: "selected", identity: "0CNNW" });
  expect(f.history).toHaveLength(stored);
});
