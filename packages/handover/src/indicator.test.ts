import { canonicalize, generateNodeKeyPair } from "@waitron/membership";
import type { CanonicalValue } from "@waitron/membership";
import { AppError } from "@waitron/shared";
import { describe, expect, it } from "vitest";
import type { HandoverBinding } from "./binding.js";
import { envelopeDigest, verifyEnvelope } from "./envelope.js";
import { assembleIndicator, signIndicator } from "./indicator.js";
import type { FinalStateFacts, FinalStateIndicator } from "./indicator.js";

const m1 = { nodeId: "node-m1", ...generateNodeKeyPair() };
const m2 = { nodeId: "node-m2", ...generateNodeKeyPair() };

const binding: HandoverBinding = {
  operationId: "3f1c2a4e-8b7d-4c6a-9e2f-0a1b2c3d4e5f",
  scenario: "controlled",
  venue: { country: "ES", taxId: "B12345678", environment: "production" },
  sourceNodeId: "node-m1",
  destinationNodeId: "node-m2",
  membership: { term: 3, digest: "a".repeat(64) },
};

function facts(): FinalStateFacts {
  return {
    binding,
    snapshot: {
      sha256: "b".repeat(64),
      bytes: 409_600,
      schema: [
        { set: "core", version: 41, journalSha256: "c".repeat(64) },
        { set: "bookings", version: 7, journalSha256: "d".repeat(64) },
        { set: "fiscal-verifactu", version: 12, journalSha256: "e".repeat(64) },
      ],
      modules: [
        { name: "payments", version: "1.2.0" },
        { name: "fiscal-verifactu", version: "3.0.1" },
      ],
    },
    nodeLocal: [
      {
        item: "venue-keys.json",
        where: "state",
        class: "transferred",
        treatment: "kept",
        sha256: "f".repeat(64),
        ringVersions: [10, 2, 9],
      },
      { item: "node_mode", where: "node.db", class: "destination-owned", treatment: "own" },
      {
        item: "node_signing_key",
        where: "node.db",
        class: "source-only",
        treatment: "never",
        sha256: null,
      },
    ],
    modulesSummary: {
      payments: { open: [{ provider: "sumup", reference: "r-1" }] },
      "fiscal-verifactu": { chains: [{ sifId: "s-1", count: 4 }] },
    },
    capturedAtMs: 1_793_000_000_000,
  };
}

function reversed(input: FinalStateFacts): FinalStateFacts {
  const summary: Record<string, CanonicalValue> = {};
  for (const key of Object.keys(input.modulesSummary).reverse()) {
    summary[key] = input.modulesSummary[key];
  }
  return {
    ...input,
    snapshot: {
      ...input.snapshot,
      schema: [...input.snapshot.schema].reverse(),
      modules: [...input.snapshot.modules].reverse(),
    },
    nodeLocal: [...input.nodeLocal]
      .reverse()
      .map((row) => (row.ringVersions === undefined ? row : { ...row, ringVersions: [9, 10, 2] })),
    modulesSummary: summary,
  };
}

function bytesOf(indicator: FinalStateIndicator): string {
  return JSON.stringify(indicator);
}

function faultFrom(run: () => unknown): Error {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(Error);
  expect(thrown).not.toBeInstanceOf(AppError);
  return thrown as Error;
}

describe("assembleIndicator", () => {
  it("lists the schema by set, the modules by name and the node-local items by place and name", () => {
    const indicator = assembleIndicator(facts());
    expect(indicator.snapshot.schema.map((entry) => entry.set)).toEqual([
      "bookings",
      "core",
      "fiscal-verifactu",
    ]);
    expect(indicator.snapshot.modules.map((entry) => entry.name)).toEqual([
      "fiscal-verifactu",
      "payments",
    ]);
    expect(indicator.nodeLocal.map((row) => `${row.where}/${row.item}`)).toEqual([
      "node.db/node_mode",
      "node.db/node_signing_key",
      "state/venue-keys.json",
    ]);
    expect(indicator.nodeLocal[2].ringVersions).toEqual([2, 9, 10]);
  });

  it("gives byte-identical bodies for the same facts given in a different order", () => {
    const first = assembleIndicator(facts());
    const second = assembleIndicator(reversed(facts()));
    expect(bytesOf(second)).toBe(bytesOf(first));
    expect(canonicalize(second as unknown as CanonicalValue)).toBe(
      canonicalize(first as unknown as CanonicalValue),
    );
  });

  it("carries every fact it was given, field for field", () => {
    const input = facts();
    const indicator = assembleIndicator(input);
    expect(indicator).toEqual({
      binding,
      snapshot: {
        sha256: "b".repeat(64),
        bytes: 409_600,
        schema: [
          { set: "bookings", version: 7, journalSha256: "d".repeat(64) },
          { set: "core", version: 41, journalSha256: "c".repeat(64) },
          { set: "fiscal-verifactu", version: 12, journalSha256: "e".repeat(64) },
        ],
        modules: [
          { name: "fiscal-verifactu", version: "3.0.1" },
          { name: "payments", version: "1.2.0" },
        ],
      },
      nodeLocal: [
        { item: "node_mode", where: "node.db", class: "destination-owned", treatment: "own" },
        {
          item: "node_signing_key",
          where: "node.db",
          class: "source-only",
          treatment: "never",
          sha256: null,
        },
        {
          item: "venue-keys.json",
          where: "state",
          class: "transferred",
          treatment: "kept",
          sha256: "f".repeat(64),
          ringVersions: [2, 9, 10],
        },
      ],
      modulesSummary: input.modulesSummary,
      capturedAtMs: 1_793_000_000_000,
    });
  });

  it("leaves out an optional node-local field that is unset, so the body survives JSON", () => {
    const input = facts();
    const withUnset: FinalStateFacts = {
      ...input,
      nodeLocal: [
        {
          item: "node_mode",
          where: "node.db",
          class: "destination-owned",
          treatment: "own",
          sha256: undefined,
          ringVersions: undefined,
        },
      ],
    };
    const indicator = assembleIndicator(withUnset);
    expect(Object.keys(indicator.nodeLocal[0]).sort()).toEqual([
      "class",
      "item",
      "treatment",
      "where",
    ]);
    const envelope = signIndicator(indicator, m1);
    const sent = JSON.parse(JSON.stringify(envelope)) as unknown;
    expect(verifyEnvelope(sent, "final-state", () => m1.publicKey).valid).toBe(true);
  });

  it("does not change the facts it was given", () => {
    const input = facts();
    const before = JSON.stringify(input);
    assembleIndicator(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("throws a fault for a module summary no JSON can carry", () => {
    const cases: [CanonicalValue | unknown, string][] = [
      [{ count: 4n }, "modulesSummary.payments.count"],
      [{ list: [1, undefined] }, "modulesSummary.payments.list.1"],
      // eslint-disable-next-line no-sparse-arrays
      [{ list: [1, , 3] }, "modulesSummary.payments.list.1"],
      [{ at: new Date(0) }, "modulesSummary.payments.at"],
      [{ n: Number.NaN }, "modulesSummary.payments.n"],
      [{ f: () => 1 }, "modulesSummary.payments.f"],
      [undefined, "modulesSummary.payments"],
    ];
    for (const [value, field] of cases) {
      const input = { ...facts(), modulesSummary: { payments: value as CanonicalValue } };
      const fault = faultFrom(() => assembleIndicator(input));
      expect(fault.message, field).toContain(field);
    }
  });

  it("accepts a summary of nulls, booleans, strings, numbers, lists and objects", () => {
    const summary = { a: null, b: true, c: "x", d: -1.5, e: [], f: { g: [{}] } };
    const indicator = assembleIndicator({ ...facts(), modulesSummary: { payments: summary } });
    expect(indicator.modulesSummary.payments).toEqual(summary);
  });

  it("throws a fault for two schema entries, modules or node-local items with one name", () => {
    const input = facts();
    const twiceSet = {
      ...input,
      snapshot: { ...input.snapshot, schema: [...input.snapshot.schema, input.snapshot.schema[0]] },
    };
    expect(faultFrom(() => assembleIndicator(twiceSet)).message).toBe(
      "the final-state indicator names core twice",
    );
    const twiceModule = {
      ...input,
      snapshot: {
        ...input.snapshot,
        modules: [...input.snapshot.modules, { name: "payments", version: "9" }],
      },
    };
    expect(faultFrom(() => assembleIndicator(twiceModule)).message).toContain("payments");
    const twiceItem = { ...input, nodeLocal: [...input.nodeLocal, input.nodeLocal[1]] };
    expect(faultFrom(() => assembleIndicator(twiceItem)).message).toContain("node.db/node_mode");
  });

  it("keeps one item name in two places as two items", () => {
    const input = facts();
    const row = { item: "same", class: "rebuildable", treatment: "t" } as const;
    const indicator = assembleIndicator({
      ...input,
      nodeLocal: [
        { ...row, where: "venue.db" },
        { ...row, where: "node.db" },
      ],
    });
    expect(indicator.nodeLocal.map((entry) => entry.where)).toEqual(["node.db", "venue.db"]);
  });
});

describe("signIndicator", () => {
  it("signs a final-state body that verifies with the signer's key and not with another", () => {
    const envelope = signIndicator(assembleIndicator(facts()), m1);
    expect(envelope.purpose).toBe("waitron.handover.final-state.v1");
    expect(envelope.signerNodeId).toBe("node-m1");
    const sent = JSON.parse(JSON.stringify(envelope)) as unknown;
    const good = verifyEnvelope<FinalStateIndicator>(sent, "final-state", () => m1.publicKey);
    expect(good).toEqual({
      valid: true,
      body: assembleIndicator(facts()),
      signerNodeId: "node-m1",
    });
    expect(verifyEnvelope(sent, "final-state", () => m2.publicKey)).toEqual({
      valid: false,
      reason: "bad_signature",
    });
  });

  it("signs the assembled body when handed facts that were never assembled", () => {
    const input = facts();
    const raw: FinalStateFacts = {
      ...input,
      snapshot: { ...input.snapshot, schema: [...input.snapshot.schema].reverse() },
      nodeLocal: [
        {
          item: "node_mode",
          where: "node.db",
          class: "destination-owned",
          treatment: "own",
          sha256: undefined,
        },
      ],
    };
    const envelope = signIndicator(raw, m1);
    expect(envelope.body).toEqual(assembleIndicator(raw));
    expect(Object.keys(envelope.body.nodeLocal[0])).not.toContain("sha256");
    const sent = JSON.parse(JSON.stringify(envelope)) as unknown;
    expect(verifyEnvelope(sent, "final-state", () => m1.publicKey).valid).toBe(true);
  });

  it("gives a different digest when any one fact changes", () => {
    const base = envelopeDigest(signIndicator(assembleIndicator(facts()), m1));
    const input = facts();
    const changes: FinalStateFacts[] = [
      { ...input, capturedAtMs: input.capturedAtMs + 1 },
      { ...input, snapshot: { ...input.snapshot, bytes: input.snapshot.bytes + 1 } },
      { ...input, snapshot: { ...input.snapshot, sha256: "0".repeat(64) } },
      {
        ...input,
        snapshot: {
          ...input.snapshot,
          schema: [{ ...input.snapshot.schema[0], journalSha256: "1".repeat(64) }],
        },
      },
      { ...input, modulesSummary: { ...input.modulesSummary, payments: { open: [] } } },
      { ...input, nodeLocal: input.nodeLocal.slice(1) },
      { ...input, binding: { ...binding, membership: { term: 4, digest: "a".repeat(64) } } },
    ];
    const digests = changes.map((changed) =>
      envelopeDigest(signIndicator(assembleIndicator(changed), m1)),
    );
    for (const digest of digests) expect(digest).not.toBe(base);
    expect(new Set(digests).size).toBe(changes.length);
  });
});
