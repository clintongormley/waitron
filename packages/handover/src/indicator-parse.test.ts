import { generateNodeKeyPair } from "@waitron/membership";
import { AppError } from "@waitron/shared";
import { describe, expect, it } from "vitest";
import { signIndicator } from "./indicator.js";
import type { FinalStateIndicator } from "./indicator.js";
import { parseIndicator } from "./indicator-parse.js";

const revisionBinding = {
  module: "fiscal-verifactu",
  action: "promote",
  eventId: "e1",
  sourceId: "s1",
  targetNodeId: "node-m1",
};

function valid(): FinalStateIndicator {
  return {
    binding: {
      operationId: "3f1c2a4e-8b7d-4c6a-9e2f-0a1b2c3d4e5f",
      scenario: "controlled",
      venue: { country: "ES", taxId: "B12345678", environment: "production" },
      sourceNodeId: "node-m1",
      destinationNodeId: "node-m2",
      membership: { term: 3, digest: "a".repeat(64) },
    },
    snapshot: {
      sha256: "b".repeat(64),
      bytes: 409_600,
      schema: [{ set: "core", version: 41, journalSha256: "c".repeat(64) }],
      modules: [{ name: "payments", version: "1.2.0" }],
    },
    nodeLocal: [
      { item: "node_mode", where: "node.db", class: "destination-owned", treatment: "own" },
      { item: "backup.env", where: "state", class: "transferred", treatment: "x", sha256: null },
      {
        item: "modules.json",
        where: "state",
        class: "transferred",
        treatment: "x",
        sha256: "d".repeat(64),
      },
      {
        item: "secrets.env",
        where: "state",
        class: "transferred",
        treatment: "x",
        ringVersions: [2, 3],
      },
      {
        item: "module-preparation-state.json",
        where: "state",
        class: "transferred",
        treatment: "x",
        revisions: [{ binding: revisionBinding, value: { selected: "AAAAA" } }],
      },
    ],
    modulesSummary: { payments: { open: [] } },
    capturedAtMs: 1_793_000_000_000,
  };
}

type Mutable = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function altered(change: (body: Mutable) => void): unknown {
  const body = structuredClone(valid()) as unknown as Mutable;
  change(body);
  return body;
}

function rowNamed(body: Mutable, item: string): Mutable {
  return (body.nodeLocal as Mutable[]).find((row) => row.item === item)!;
}

function refusal(raw: unknown): { code: string; params: unknown } | null {
  try {
    parseIndicator(raw);
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    const { code, params } = error as AppError;
    return { code, params };
  }
}

function refusedAt(field: string) {
  return { code: "handover.indicator_mismatch", params: { field } };
}

const FIRST_REVISION = "nodeLocal.module-preparation-state.json.revisions.0";

// Each case changes one thing a whole indicator holds; the control below shows the rest passes.
const CASES: readonly [string, string, (body: Mutable) => void][] = [
  ["a missing binding", "binding", (b) => delete b.binding],
  ["a binding of the wrong shape", "binding", (b) => (b.binding.scenario = "other")],
  ["a missing snapshot", "snapshot", (b) => delete b.snapshot],
  ["a snapshot that is a list", "snapshot", (b) => (b.snapshot = [])],
  ["a null snapshot", "snapshot", (b) => (b.snapshot = null)],
  ["a missing node-local list", "nodeLocal", (b) => delete b.nodeLocal],
  ["a node-local list that is no list", "nodeLocal", (b) => (b.nodeLocal = {})],
  ["missing summaries", "modulesSummary", (b) => delete b.modulesSummary],
  ["summaries that are a list", "modulesSummary", (b) => (b.modulesSummary = [])],
  ["null summaries", "modulesSummary", (b) => (b.modulesSummary = null)],
  ["a missing capture time", "capturedAtMs", (b) => delete b.capturedAtMs],
  ["a capture time that is text", "capturedAtMs", (b) => (b.capturedAtMs = "1")],
  ["a fractional capture time", "capturedAtMs", (b) => (b.capturedAtMs = 1.5)],
  ["a capture time beyond exact integers", "capturedAtMs", (b) => (b.capturedAtMs = 2 ** 53)],
  ["an unknown top field", "extra", (b) => (b.extra = 1)],

  ["a missing copy digest", "snapshot.sha256", (b) => delete b.snapshot.sha256],
  ["a short copy digest", "snapshot.sha256", (b) => (b.snapshot.sha256 = "b".repeat(63))],
  [
    "a copy digest with a prefix",
    "snapshot.sha256",
    (b) => (b.snapshot.sha256 = `x${"b".repeat(64)}`),
  ],
  [
    "a copy digest with a suffix",
    "snapshot.sha256",
    (b) => (b.snapshot.sha256 = `${"b".repeat(64)}x`),
  ],
  ["an upper-case copy digest", "snapshot.sha256", (b) => (b.snapshot.sha256 = "B".repeat(64))],
  ["a copy digest that is no text", "snapshot.sha256", (b) => (b.snapshot.sha256 = 7)],
  ["a missing size", "snapshot.bytes", (b) => delete b.snapshot.bytes],
  ["a negative size", "snapshot.bytes", (b) => (b.snapshot.bytes = -1)],
  ["a fractional size", "snapshot.bytes", (b) => (b.snapshot.bytes = 1.5)],
  ["a size that is text", "snapshot.bytes", (b) => (b.snapshot.bytes = "1")],
  ["a missing schema", "snapshot.schema", (b) => delete b.snapshot.schema],
  ["a schema that is no list", "snapshot.schema", (b) => (b.snapshot.schema = {})],
  ["missing modules", "snapshot.modules", (b) => delete b.snapshot.modules],
  ["modules that are no list", "snapshot.modules", (b) => (b.snapshot.modules = "x")],
  ["an unknown snapshot field", "snapshot.extra", (b) => (b.snapshot.extra = 1)],

  ["a schema entry that is no object", "snapshot.schema.0", (b) => (b.snapshot.schema[0] = 1)],
  ["a schema entry with no set", "snapshot.schema.0.set", (b) => delete b.snapshot.schema[0].set],
  ["an empty set name", "snapshot.schema.0.set", (b) => (b.snapshot.schema[0].set = "")],
  ["a set name that is no text", "snapshot.schema.0.set", (b) => (b.snapshot.schema[0].set = 1)],
  ["a negative version", "snapshot.schema.0.version", (b) => (b.snapshot.schema[0].version = -1)],
  [
    "a fractional version",
    "snapshot.schema.0.version",
    (b) => (b.snapshot.schema[0].version = 0.5),
  ],
  [
    "a bad journal digest",
    "snapshot.schema.0.journalSha256",
    (b) => (b.snapshot.schema[0].journalSha256 = "c"),
  ],
  ["an unknown schema field", "snapshot.schema.0.extra", (b) => (b.snapshot.schema[0].extra = 1)],
  [
    "a set named twice",
    "snapshot.schema.1.set",
    (b) => b.snapshot.schema.push({ ...b.snapshot.schema[0] }),
  ],

  ["a module that is no object", "snapshot.modules.0", (b) => (b.snapshot.modules[0] = null)],
  ["a module with no name", "snapshot.modules.0.name", (b) => delete b.snapshot.modules[0].name],
  [
    "a module with an empty name",
    "snapshot.modules.0.name",
    (b) => (b.snapshot.modules[0].name = ""),
  ],
  [
    "a module with no version",
    "snapshot.modules.0.version",
    (b) => delete b.snapshot.modules[0].version,
  ],
  [
    "a module with an empty version",
    "snapshot.modules.0.version",
    (b) => (b.snapshot.modules[0].version = ""),
  ],
  [
    "a module named twice",
    "snapshot.modules.1.name",
    (b) => b.snapshot.modules.push({ ...b.snapshot.modules[0], version: "2" }),
  ],

  ["a row that is no object", "nodeLocal.0", (b) => (b.nodeLocal[0] = "x")],
  ["a row with no item", "nodeLocal.0.item", (b) => delete b.nodeLocal[0].item],
  ["a row with an empty item", "nodeLocal.0.item", (b) => (b.nodeLocal[0].item = "")],
  ["a row with no place", "nodeLocal.0.where", (b) => delete b.nodeLocal[0].where],
  ["a row with an unknown place", "nodeLocal.0.where", (b) => (b.nodeLocal[0].where = "disk")],
  ["a row with no class", "nodeLocal.0.class", (b) => delete b.nodeLocal[0].class],
  ["a row with an unknown class", "nodeLocal.0.class", (b) => (b.nodeLocal[0].class = "other")],
  ["a row with no treatment", "nodeLocal.0.treatment", (b) => delete b.nodeLocal[0].treatment],
  [
    "a row with an empty treatment",
    "nodeLocal.0.treatment",
    (b) => (b.nodeLocal[0].treatment = ""),
  ],
  ["a row with an unknown field", "nodeLocal.0.extra", (b) => (b.nodeLocal[0].extra = 1)],
  ["a row named twice", "nodeLocal.5.item", (b) => b.nodeLocal.push({ ...b.nodeLocal[0] })],
  [
    "a settings digest that is no digest",
    "nodeLocal.backup.env.sha256",
    (b) => (rowNamed(b, "backup.env").sha256 = "abc"),
  ],
  [
    "a settings digest that is a number",
    "nodeLocal.modules.json.sha256",
    (b) => (rowNamed(b, "modules.json").sha256 = 1),
  ],
  [
    "a ring listing that is no list",
    "nodeLocal.secrets.env.ringVersions",
    (b) => (rowNamed(b, "secrets.env").ringVersions = 3),
  ],
  [
    "a ring version of zero",
    "nodeLocal.secrets.env.ringVersions.0",
    (b) => (rowNamed(b, "secrets.env").ringVersions = [0]),
  ],
  [
    "a ring version that is text",
    "nodeLocal.secrets.env.ringVersions.1",
    (b) => (rowNamed(b, "secrets.env").ringVersions = [1, "2"]),
  ],

  [
    "no row for backup.env",
    "nodeLocal.backup.env",
    (b) => (b.nodeLocal = b.nodeLocal.filter((r: Mutable) => r.item !== "backup.env")),
  ],
  [
    "no digest key for backup.env",
    "nodeLocal.backup.env.sha256",
    (b) => delete rowNamed(b, "backup.env").sha256,
  ],
  [
    "no digest key for modules.json",
    "nodeLocal.modules.json.sha256",
    (b) => delete rowNamed(b, "modules.json").sha256,
  ],
  [
    "no ring listing",
    "nodeLocal.secrets.env.ringVersions",
    (b) => delete rowNamed(b, "secrets.env").ringVersions,
  ],
  [
    "no retained selections",
    "nodeLocal.module-preparation-state.json.revisions",
    (b) => delete rowNamed(b, "module-preparation-state.json").revisions,
  ],
  [
    "retained selections that are no list",
    "nodeLocal.module-preparation-state.json.revisions",
    (b) => (rowNamed(b, "module-preparation-state.json").revisions = {}),
  ],
  [
    "a retained selection that is no object",
    FIRST_REVISION,
    (b) => (rowNamed(b, "module-preparation-state.json").revisions[0] = 1),
  ],
  [
    "a retained selection with no value key",
    `${FIRST_REVISION}.value`,
    (b) => delete rowNamed(b, "module-preparation-state.json").revisions[0].value,
  ],
  [
    "a retained selection with an unknown field",
    `${FIRST_REVISION}.extra`,
    (b) => (rowNamed(b, "module-preparation-state.json").revisions[0].extra = 1),
  ],
  [
    "a retained selection with no binding",
    `${FIRST_REVISION}.binding`,
    (b) => delete rowNamed(b, "module-preparation-state.json").revisions[0].binding,
  ],
  ...(["module", "action", "eventId", "sourceId", "targetNodeId"] as const).flatMap(
    (key): [string, string, (body: Mutable) => void][] => [
      [
        `a retained selection's binding with no ${key}`,
        `${FIRST_REVISION}.binding.${key}`,
        (b) => delete rowNamed(b, "module-preparation-state.json").revisions[0].binding[key],
      ],
      [
        `a retained selection's binding with a blank ${key}`,
        `${FIRST_REVISION}.binding.${key}`,
        (b) => (rowNamed(b, "module-preparation-state.json").revisions[0].binding[key] = "  "),
      ],
    ],
  ),
  [
    "a retained selection's binding with an unknown field",
    `${FIRST_REVISION}.binding.extra`,
    (b) => (rowNamed(b, "module-preparation-state.json").revisions[0].binding.extra = "x"),
  ],
];

describe("parseIndicator", () => {
  it("control: answers a whole indicator as it was given", () => {
    const body = valid();
    expect(parseIndicator(structuredClone(body))).toEqual(body);
  });

  it("accepts what signing assembles, with each kind of empty value a box can send", () => {
    const m1 = { nodeId: "node-m1", ...generateNodeKeyPair() };
    const body = altered((b) => {
      b.snapshot.bytes = 0;
      b.snapshot.schema = [{ ...b.snapshot.schema[0], version: 0 }];
      b.snapshot.modules = [];
      b.modulesSummary = {};
      rowNamed(b, "modules.json").sha256 = null;
      rowNamed(b, "module-preparation-state.json").revisions = [];
    }) as FinalStateIndicator;
    const signed = JSON.parse(JSON.stringify(signIndicator(body, m1))) as { body: unknown };
    expect(refusal(signed.body)).toBeNull();
  });

  it("accepts a retained selection whose value is null, and a summary of any JSON value", () => {
    const body = altered((b) => {
      rowNamed(b, "module-preparation-state.json").revisions[0].value = null;
      b.modulesSummary = { a: null, b: [1], c: "x" };
    });
    expect(refusal(body)).toBeNull();
  });

  it("accepts the same row name in another place", () => {
    const body = altered((b) => {
      b.nodeLocal.push({ ...b.nodeLocal[0], where: "venue.db" });
    });
    expect(refusal(body)).toBeNull();
  });

  it.each([[null], [[]], ["x"], [7]])("refuses a body that is %j", (raw) => {
    expect(refusal(raw)).toEqual(refusedAt("indicator"));
  });

  it.each(CASES)("refuses %s, naming %s", (_name, field, change) => {
    expect(refusal(altered(change))).toEqual(refusedAt(field));
  });
});
