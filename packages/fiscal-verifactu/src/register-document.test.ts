import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseRegisterDocument, registerDocumentBytes } from "./register-document.js";

const scope = { taxpayerNif: "B12345674", softwareId: "W1", environment: "production" };
const time = "2026-10-15T08:00:00.000Z";
function valid() {
  return {
    version: 2,
    kind: "waitron-register-document",
    route: "paper",
    paper: {
      format: "waitron-paper-register",
      version: 2,
      integrity: "owner-declared",
      registerId: "register-1",
      scope: { ...scope },
      mode: "complete",
      originals: [],
      revisions: [
        {
          version: 2,
          registerId: "register-1",
          scope: { ...scope },
          revision: "1",
          previousDigest: "0".repeat(64),
          createdAt: time,
          sHighWater: 0,
          pHighWater: 0,
          events: [],
        },
      ],
    },
    cloudOriginals: [],
    nodeKeys: [{ nodeId: "node-1", name: "Office", secret: "original exact text" }],
  };
}
const invalid = async (value: unknown) =>
  expect(parseRegisterDocument(value)).rejects.toThrow("Register PDF refused");
describe("register document carrier boundaries", () => {
  it("retains differently named keys for the same node", async () => {
    const document = valid();
    document.nodeKeys.push({ ...document.nodeKeys[0]!, name: "Previous office key" });
    expect((await parseRegisterDocument(document)).nodeKeys.map((k) => k.name)).toEqual([
      "Office",
      "Previous office key",
    ]);
  });
  it("keeps exact string bytes and sorts keys without changing arrays", () => {
    expect(
      new TextDecoder().decode(registerDocumentBytes({ z: [2, 1], a: "\ufeff Peña Λάδι 😀 " })),
    ).toBe('{"a":"﻿ Peña Λάδι 😀 ","z":[2,1]}');
  });
  it.each([
    undefined,
    NaN,
    Infinity,
    () => {},
    new Date(),
    new Map(),
    new Array(1),
    Object.assign([], { extra: 1 }),
    { [Symbol("hidden")]: 1 },
  ])("refuses values JSON cannot carry exactly %#", (v) =>
    expect(() => registerDocumentBytes(v)).toThrow("Register PDF refused"),
  );
  it("bounds size, nesting and the total visited values", () => {
    let deep: unknown = 0;
    for (let i = 0; i < 34; i++) deep = { child: deep };
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    for (const v of [deep, cycle, Array(1000001).fill(0), "x".repeat(8 * 1024 * 1024)])
      expect(() => registerDocumentBytes(v)).toThrow("Register PDF refused");
    expect(registerDocumentBytes("x".repeat(8 * 1024 * 1024 - 2)).length).toBe(8 * 1024 * 1024);
  });
  it.each([
    null,
    [],
    {},
    "text",
    { ...valid(), route: "other" },
    { ...valid(), version: 1 },
    { ...valid(), kind: "other" },
    { ...valid(), cloudOriginals: null },
    { ...valid(), nodeKeys: null },
    { ...valid(), cloudOriginals: [{ kind: "signed-paper" }] },
    { ...valid(), route: "cloud", paper: null },
  ])("refuses a malformed top-level carrier %#", invalid);
  it.each([
    null,
    {},
    { kind: "cloud-receipt", bytesBase64url: "?", digest: "0".repeat(64) },
    { kind: "cloud-receipt", bytesBase64url: "e31", digest: "0".repeat(64) },
    { kind: "cloud-receipt", bytesBase64url: "e30", digest: "X".repeat(64) },
    { kind: "cloud-receipt", bytesBase64url: "e30", digest: "0".repeat(64) },
  ])("refuses malformed original framing and altered bytes %#", async (original) =>
    invalid({ ...valid(), cloudOriginals: [original] }),
  );
  it.each([
    null,
    {},
    { taxpayerNif: "bad", softwareId: "W1", environment: "production" },
    { ...scope, softwareId: "bad" },
    { ...scope, environment: "test" },
    { ...scope, extra: 1 },
  ])("refuses a malformed paper scope %#", async (s) => {
    const d = valid();
    return invalid({ ...d, paper: { ...d.paper, scope: s } });
  });
  it.each([
    { format: "wrong" },
    { version: 1 },
    { integrity: "signed" },
    { registerId: "" },
    { mode: "other" },
    { revisions: null },
    { originals: null },
    { revisions: [] },
    { unexpected: "secret" },
  ])("refuses malformed history headers %#", async (delta) => {
    const d = valid();
    return invalid({ ...d, paper: { ...d.paper, ...delta } });
  });
  it.each([
    null,
    {},
    { kind: "unknown" },
    { kind: "reserve" },
    { kind: "consume" },
    { kind: "uncertain" },
    { kind: "reserve", allocation: {}, recipientVenueId: "v", binding: {}, reservedAt: time },
  ])("refuses incomplete public events %#", async (event) => {
    const d = valid();
    return invalid({
      ...d,
      paper: { ...d.paper, revisions: [{ ...d.paper.revisions[0], events: [event] }] },
    });
  });
  it.each([
    {},
    {
      kind: "retire",
      allocationId: "a",
      eventId: "e",
      reason: "r",
      createdAt: time,
      secret: "hidden",
    },
  ])("refuses extra or missing revision fields %#", async (revision) => {
    const d = valid();
    return invalid({ ...d, paper: { ...d.paper, revisions: [revision] } });
  });
  it.each([
    null,
    {},
    { nodeId: "", name: "n", secret: "s" },
    { nodeId: "n", name: "", secret: "s" },
    { nodeId: "n", name: "n", secret: "" },
    { nodeId: "n", name: "n", secret: "s", seed: "hidden" },
  ])("refuses malformed named keys %#", async (key) => invalid({ ...valid(), nodeKeys: [key] }));
  it("keeps terminal evidence and text keys without inventing a signer", async () => {
    const d = valid();
    const doc = {
      ...d,
      paper: {
        ...d.paper,
        revisions: [
          {
            ...d.paper.revisions[0],
            events: [
              {
                kind: "retire",
                allocationId: "a",
                eventId: "e",
                reason: "finished",
                createdAt: time,
              },
              {
                kind: "abandon",
                allocationId: "b",
                eventId: "f",
                reason: "stopped",
                createdAt: time,
              },
              {
                kind: "uncertain",
                allocationId: "c",
                eventId: "g",
                reason: "reply lost",
                createdAt: time,
              },
            ],
          },
        ],
      },
    };
    expect(await parseRegisterDocument(doc)).toEqual(doc);
  });
  it("requires the declared checkpoint flags", async () => {
    const d = valid();
    const checkpoint = {
      version: 2,
      kind: "declared-burn-checkpoint",
      checkpointId: "c",
      scope,
      sHighWater: 42,
      pHighWater: 7,
      current: {
        currentRegisterConfirmed: true,
        noParallelPaperAllocation: true,
        confirmedAt: time,
      },
      completeHistoryUnavailable: true,
      burnAllPrior: true,
      createdAt: time,
    };
    const doc = { ...d, paper: { ...d.paper, mode: "checkpoint", revisions: [], checkpoint } };
    expect(await parseRegisterDocument(doc)).toEqual(doc);
    for (const change of [
      { burnAllPrior: false },
      { completeHistoryUnavailable: false },
      { extra: 1 },
    ])
      await invalid({ ...doc, paper: { ...doc.paper, checkpoint: { ...checkpoint, ...change } } });
  });
  it("refuses Cloud originals without the allocation scope, even when their digest matches", async () => {
    for (const value of [
      {},
      { payload: {} },
      { payload: { allocation: {} } },
      { payload: { allocation: { ...scope, environment: "test" } } },
    ]) {
      const data = Buffer.from(JSON.stringify(value));
      const original = {
        kind: "cloud-receipt",
        bytesBase64url: data.toString("base64url"),
        digest: createHash("sha256").update(data).digest("hex"),
      };
      await invalid({ ...valid(), route: "cloud", paper: null, cloudOriginals: [original] });
    }
  });
});
