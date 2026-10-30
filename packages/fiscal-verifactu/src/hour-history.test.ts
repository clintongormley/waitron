import { expect, it } from "vitest";
import { projectHourHistory } from "./hour-history.js";
import { decodeMinuteIdentity } from "./hour-identity.js";

const scope = { taxpayerNif: "89890001K", environment: "preproduction" as const };

it("projects a positively complete empty history without inventing a floor", () => {
  expect(
    projectHourHistory({ scope, sources: [{ reference: "venue", complete: true, records: [] }] }),
  ).toEqual({
    scope,
    greatestSpentMinute: null,
    recordedTimeFloorMs: null,
    references: ["venue"],
    contradictions: [],
  });
});

const row = (change: Record<string, unknown> = {}) => ({
  ...scope,
  reference: "row/current",
  kind: "intent",
  softwareId: "W1",
  nodeId: "node-1",
  identity: "0CNNW",
  recordedAtMs: 1792150800000,
  ...change,
});
const project = (records: readonly unknown[], extra: Record<string, unknown> = {}) =>
  projectHourHistory({
    scope,
    sources: [{ reference: "venue", complete: true, records, ...extra }],
  });

it.each(["series", "activation", "reservation", "intent", "retirement", "backup", "workspace"])(
  "retains a higher %s minute across bases, nodes and software IDs",
  (kind) => {
    const history = project([
      row(),
      row({
        reference: "row/retired-other",
        kind,
        softwareId: "OTHER",
        nodeId: "node-2",
        identity: "0CNPG",
        recordedAtMs: 1792152000000,
      }),
    ]);
    expect(history.greatestSpentMinute).toBe(415440);
    expect(history.recordedTimeFloorMs).toBe(1792152000000);
    expect(history.references).toEqual(["venue", "row/current", "row/retired-other"]);
    expect(history.contradictions).toEqual([]);
  },
);
it("merges backup evidence without lowering a surviving host floor", () => {
  const result = projectHourHistory({
    scope,
    sources: [
      { reference: "host", complete: true, records: [row({ identity: "0CNPG" })] },
      {
        reference: "old-backup",
        complete: true,
        records: [row({ reference: "row/backup", identity: "00000", recordedAtMs: 1767225600000 })],
      },
    ],
  });
  expect(result.greatestSpentMinute).toBe(415440);
  expect(result.recordedTimeFloorMs).toBe(1792150800000);
});
it.each([{ taxpayerNif: "89890002M" }, { environment: "production" }])(
  "keeps unrelated scope independent: %j",
  (change) => {
    expect(
      project([
        row(),
        row({ reference: "foreign", identity: "ZZZZZ", recordedAtMs: 5540000000000, ...change }),
      ]).greatestSpentMinute,
    ).toBe(415420);
    expect(
      project([
        row(),
        row({ reference: "foreign", identity: "ZZZZZ", recordedAtMs: 5540000000000, ...change }),
      ]).recordedTimeFloorMs,
    ).toBe(1792150800000);
  },
);
it("retains epoch minute zero as a spent minute", () => {
  expect(project([row({ identity: "00000", recordedAtMs: null })]).greatestSpentMinute).toBe(0);
});
it.each(["0cnnw", "OCNNW", "06XV", "S000001", "", null, 415420])(
  "reports corrupt required identity %j instead of empty history",
  (identity) => {
    expect(project([row({ identity })]).contradictions).toContain("row/current:invalid_record");
  },
);
it.each([NaN, Infinity, -1, 1.2, "2026-10-16", undefined])(
  "reports corrupt recorded time %j",
  (recordedAtMs) => {
    expect(project([row({ recordedAtMs })]).contradictions).toContain("row/current:invalid_record");
  },
);
it.each(["reference", "kind", "softwareId", "nodeId", "taxpayerNif", "environment"])(
  "reports missing/corrupt required %s",
  (key) => {
    expect(project([row({ [key]: "" })]).contradictions.length).toBeGreaterThan(0);
  },
);
it.each([null, [], true, {}, "bad"])("refuses malformed required record %j", (bad) => {
  expect(project([bad]).contradictions.length).toBeGreaterThan(0);
});
it("incomplete evidence cannot become an empty inventory", () => {
  expect(project([], { complete: false }).contradictions).toContain("venue:incomplete");
  expect(projectHourHistory({ scope, sources: [] }).contradictions).toContain("missing_sources");
});
it("reports conflicting duplicate references but accepts identical repeated evidence", () => {
  expect(project([row(), row()]).contradictions).toEqual([]);
  expect(project([row(), row({ identity: "0CNPG" })]).contradictions).toContain(
    "row/current:conflict",
  );
});
it("detaches the resulting scope and references from mutable inputs", () => {
  const input = {
    scope: { ...scope },
    sources: [{ reference: "venue", complete: true, records: [row()] }],
  };
  const result = projectHourHistory(input);
  input.scope.taxpayerNif = "changed";
  input.sources[0]!.reference = "changed";
  expect(result.scope).toEqual(scope);
  expect(result.references).toEqual(["venue", "row/current"]);
});

it.each([
  { environment: ["preproduction"] },
  { kind: ["intent"] },
  { environment: null },
  { kind: null },
])("refuses coerced vocabulary %j", (change) => {
  expect(project([row(change)]).contradictions).toContain("row/current:invalid_record");
});
it.each(["", null, 1])("refuses an unidentifiable required evidence source %j", (reference) => {
  expect(project([], { reference }).contradictions.length).toBeGreaterThan(0);
});
it.each([null, {}, "bad"])(
  "reports malformed source records %j as incomplete evidence",
  (records) => {
    expect(project([], { records }).contradictions).toContain("venue:invalid_source");
  },
);
it.each(["", undefined, ["preproduction"]])(
  "rejects an invalid requested environment %j with a domain refusal",
  (environment) => {
    expect(() =>
      projectHourHistory({ scope: { ...scope, environment } as typeof scope, sources: [] }),
    ).toThrow(
      expect.objectContaining({
        code: "sif.allocation_invalid",
        params: { reason: "history_invalid" },
      }),
    );
  },
);

it.each([null, [], {}, { scope }, { scope, sources: null }])(
  "refuses malformed inventory envelopes %j with a domain refusal",
  (evidence) => {
    expect(() => projectHourHistory(evidence as never)).toThrow(
      expect.objectContaining({
        code: "sif.allocation_invalid",
        params: { reason: "history_invalid" },
      }),
    );
  },
);
it("reports a missing source object instead of assuming completeness", () => {
  expect(
    projectHourHistory({ scope, sources: [null] as never }).contradictions.length,
  ).toBeGreaterThan(0);
});

it("projects an hour retirement floor into the existing generic assignment guard across software IDs", async () => {
  const { FISCAL_INITIAL_SETUP } = await import("./index.js");
  expect(
    FISCAL_INITIAL_SETUP.retainedAssignments!({
      format: "waitron-hour-history",
      scope,
      sources: [
        {
          reference: "retired",
          complete: true,
          records: [row({ identity: "0CNPG", softwareId: "OTHER" })],
        },
      ],
    }),
  ).toEqual({
    keys: [],
    positions: [{ namespace: '["89890001K","preproduction","hour"]', position: 415440 }],
  });
});
it("a damaged hour retirement projection refuses instead of removing the floor", async () => {
  const { FISCAL_INITIAL_SETUP } = await import("./index.js");
  expect(() =>
    FISCAL_INITIAL_SETUP.retainedAssignments!({
      format: "waitron-hour-history",
      scope,
      sources: [{ reference: "retired", complete: false, records: [] }],
    }),
  ).toThrow(
    expect.objectContaining({
      code: "sif.allocation_invalid",
      params: { reason: "history_invalid" },
    }),
  );
});

it("projects the greatest spent minute from five-symbol codes", () => {
  const history = project([
    row({ reference: "row/a", identity: "0CNNW" }),
    row({ reference: "row/b", identity: "0CZZW" }),
  ]);
  expect(history.greatestSpentMinute).toBe(decodeMinuteIdentity("0CZZW"));
  expect(history.contradictions).toEqual([]);
});
it("refuses a four-symbol code as an invalid record", () => {
  expect(project([row({ identity: "06XV" })]).contradictions).toContain(
    "row/current:invalid_record",
  );
});
it("folds a source's own time floor into the recorded floor, the highest winning", () => {
  const result = projectHourHistory({
    scope,
    sources: [
      { reference: "venue", complete: true, records: [row()], timeFloorMs: 1792700100000 },
      { reference: "backup-created", complete: true, records: [], timeFloorMs: 1792310400000 },
    ],
  });
  expect(result.recordedTimeFloorMs).toBe(1792700100000);
  expect(result.greatestSpentMinute).toBe(415420);
  expect(result.contradictions).toEqual([]);
  expect(project([], { timeFloorMs: 1792310400000 }).recordedTimeFloorMs).toBe(1792310400000);
});
it.each([NaN, Infinity, 1.5, "2026-10-23T08:00:00Z", null])(
  "reports a source time floor %j as an invalid source",
  (timeFloorMs) => {
    expect(project([row()], { timeFloorMs }).contradictions).toEqual(["venue:invalid_source"]);
  },
);
