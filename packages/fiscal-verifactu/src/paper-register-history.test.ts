import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { OperationBinding } from "@waitron/module";
import { validatePaperCandidates } from "./initial-paper-candidates.js";
import { encodePosition, decodePosition } from "./paper-register-compact.js";

const load = () => import("./paper-register-history.js");
const scope = { taxpayerNif: "B12345674", softwareId: "W1", environment: "production" as const };
const time = "2026-10-15T08:00:00.000Z";
const invalid = expect.objectContaining({ code: "sif.allocation_invalid" });
const bases = [
  { code: "A", purpose: "standard" },
  { code: "B", purpose: "standard" },
  { code: "FF", purpose: "full" },
  { code: "R", purpose: "rectificative" },
];
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v !== null && typeof v === "object")
    return `{${Object.entries(v)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`)
      .join(",")}}`;
  return JSON.stringify(v);
}
const digest = (v: unknown) => createHash("sha256").update(canonical(v)).digest("hex");
const binding = (n = 1): OperationBinding => ({
  module: "fiscal-verifactu",
  action: "initial-setup",
  eventId: `event-${n}`,
  sourceId: `attempt-${n}`,
  targetNodeId: `node-${n}`,
});
function reserve(n = 1, prefix = "S", venue = `venue-${n}`) {
  const identity = `${prefix}${String(n).padStart(6, "0")}`;
  return {
    kind: "reserve" as const,
    allocation: {
      version: 1 as const,
      allocationId: `${prefix}-${n}`,
      ...scope,
      installationIdentity: identity,
      series: bases.map((b) => ({ ...b, code: `${b.code}-${identity}` })),
      source: prefix === "S" ? ("initial-paper" as const) : ("paper" as const),
      issuedAt: time,
    },
    recipientVenueId: venue,
    binding: binding(n),
    reservedAt: time,
  };
}
function consume(r = reserve()) {
  return {
    kind: "consume" as const,
    allocationId: r.allocation.allocationId,
    reservationDigest: digest(r),
    eventId: r.binding.eventId,
    operatorId: "manager",
    sourceId: r.binding.sourceId,
    targetNodeId: r.binding.targetNodeId,
    incidentEvidence: "first Live setup",
    consumedAt: time,
  };
}
function revision(
  events: readonly unknown[],
  s = 1,
  p = 0,
  previous = "0".repeat(64),
  n = "1",
  registerId = "register-1",
) {
  return {
    version: 2,
    registerId,
    scope,
    revision: n,
    previousDigest: previous,
    createdAt: time,
    sHighWater: s,
    pHighWater: p,
    events,
  };
}
function complete(revisions = [revision([reserve(), consume()])]) {
  return {
    format: "waitron-paper-register",
    version: 2,
    integrity: "owner-declared",
    scope,
    registerId: "register-1",
    mode: "complete",
    revisions,
    originals: [],
  };
}
function checkpoint(s = 42, p = 7) {
  return {
    ...complete([]),
    registerId: "continuation",
    mode: "checkpoint",
    checkpoint: {
      version: 2,
      kind: "declared-burn-checkpoint",
      checkpointId: "checkpoint-1",
      scope,
      sHighWater: s,
      pHighWater: p,
      current: {
        currentRegisterConfirmed: true,
        noParallelPaperAllocation: true,
        confirmedAt: time,
      },
      completeHistoryUnavailable: true,
      burnAllPrior: true,
      createdAt: time,
    },
  };
}
const known = {
  scope,
  sHighWater: 0,
  pHighWater: 0,
  sBurnFloor: 0,
  pBurnFloor: 0,
  currentHead: null,
  retainedHeads: [],
  originals: [],
  retiredBindings: [],
};
const original = (history: unknown) => ({
  kind: "declared-paper-history",
  bytesBase64url: Buffer.from(canonical(history)).toString("base64url"),
  digest: digest(history),
});

describe("owner-declared paper register", () => {
  it("keeps complete four-base allocations, recipients and exact bindings across two venues", async () => {
    const api = await load(),
      first = revision([reserve(), consume()]),
      second = revision([reserve(2), consume(reserve(2))], 2, 0, digest(first), "2");
    const input = complete([first, second]),
      result = api.projectDeclaredHistory(api.parseDeclaredHistory(input), known);
    expect(result).toMatchObject({
      sHighWater: 2,
      pHighWater: 0,
      sBurnFloor: 0,
      pBurnFloor: 0,
      nextS: 3,
      nextP: 1,
      completeHistory: true,
      currentnessRequired: true,
      head: { registerId: "register-1", revision: "2", digest: digest(second) },
    });
    expect(
      result.occupied.map((x) => [x.allocation.installationIdentity, x.recipientVenueId, x.state]),
    ).toEqual([
      ["S000001", "venue-1", "consumed"],
      ["S000002", "venue-2", "consumed"],
    ]);
    expect(result.occupied[0]?.allocation.series).toEqual([
      { code: "A-S000001", purpose: "standard" },
      { code: "B-S000001", purpose: "standard" },
      { code: "FF-S000001", purpose: "full" },
      { code: "R-S000001", purpose: "rectificative" },
    ]);
    expect(result.history).toEqual(input);
    expect(result.history.revisions[0]?.events).toEqual([reserve(), consume()]);
    expect(Object.isFrozen(result.history.revisions)).toBe(true);
    expect(result.history).not.toBe(input);
  });
  it("exposes the Node history reader through its explicit package subpath", async () => {
    const api = await import("@waitron/fiscal-verifactu/paper-register-history");
    expect(api.projectDeclaredHistory(api.parseDeclaredHistory(checkpoint()), known).nextS).toBe(
      43,
    );
  });
  it("pins public canonical bytes without Unicode normalization", async () => {
    const api = await load();
    expect(new TextDecoder().decode(api.declaredHistoryBytes({ z: ["e\u0301", 2], a: "é" }))).toBe(
      '{"a":"é","z":["é",2]}',
    );
    expect(() => api.declaredHistoryBytes({ x: NaN })).toThrowError(invalid);
    expect(() => api.declaredHistoryBytes({ x: undefined })).toThrowError(invalid);
  });
  it.each([
    "gap",
    "predecessor",
    "scope",
    "duplicate-id",
    "duplicate-name",
    "decreasing",
    "terminal-reserve",
    "terminal-consume",
    "binding",
    "operator",
    "digest",
    "outside-floor",
    "zero",
  ])("refuses %s without changing known evidence", async (kind) => {
    const api = await load(),
      r1 = revision([reserve(), consume()]);
    let r2 = revision([reserve(2)], 2, 0, digest(r1), "2");
    if (kind === "gap") r2 = { ...r2, revision: "3" };
    if (kind === "predecessor") r2 = { ...r2, previousDigest: "f".repeat(64) };
    if (kind === "scope") r2 = { ...r2, scope: { ...scope, taxpayerNif: "B99999999" } };
    if (kind === "duplicate-id")
      r2 = {
        ...r2,
        events: [{ ...reserve(2), allocation: { ...reserve(2).allocation, allocationId: "S-1" } }],
      };
    if (kind === "duplicate-name")
      r2 = {
        ...r2,
        events: [{ ...reserve(), allocation: { ...reserve().allocation, allocationId: "other" } }],
      };
    if (kind === "decreasing") r2 = { ...r2, sHighWater: 0, events: [] };
    if (kind === "terminal-reserve") r2 = { ...r2, events: [reserve()] };
    if (kind === "terminal-consume") r2 = { ...r2, events: [consume()] };
    if (kind === "binding")
      r2 = { ...r2, events: [reserve(2), { ...consume(reserve(2)), targetNodeId: "other" }] };
    if (kind === "operator")
      r2 = {
        ...r2,
        events: [
          reserve(2),
          {
            ...consume(reserve(2)),
            operatorId: { kind: "recovery-key", eventId: "other", nodeId: "node-2" },
          },
        ],
      };
    if (kind === "digest")
      r2 = {
        ...r2,
        events: [reserve(2), { ...consume(reserve(2)), reservationDigest: "f".repeat(64) }],
      };
    if (kind === "outside-floor") r2 = { ...r2, events: [reserve(3)] };
    if (kind === "zero") r2 = { ...r2, events: [reserve(0)] };
    expect(() =>
      api.projectDeclaredHistory(api.parseDeclaredHistory(complete([r1, r2])), known),
    ).toThrowError(invalid);
    expect(known.sHighWater).toBe(0);
  });
  it.each(["retire", "abandon", "uncertain"])(
    "keeps %s terminal and prevents reusing its event ID",
    async (kind) => {
      const api = await load(),
        r = revision([
          reserve(),
          { kind, allocationId: "S-1", eventId: "terminal-1", reason: "replaced", createdAt: time },
        ]);
      const result = api.projectDeclaredHistory(api.parseDeclaredHistory(complete([r])), known);
      expect(result.occupied[0]?.state).toBe(
        kind === "retire" ? "retired" : kind === "abandon" ? "abandoned" : "uncertain",
      );
      expect(result.nextS).toBe(2);
      const later = revision(
        [
          reserve(2),
          { kind, allocationId: "S-2", eventId: "terminal-1", reason: "replaced", createdAt: time },
        ],
        2,
        0,
        digest(r),
        "2",
      );
      expect(() =>
        api.projectDeclaredHistory(api.parseDeclaredHistory(complete([r, later])), known),
      ).toThrowError(invalid);
    },
  );
  it("typed 42/7 burns unused P6, permits fresh S43/P8 and retains missing-history uncertainty", async () => {
    const api = await load(),
      position = await decodePosition(
        (await encodePosition(scope, { sHighWater: 42, pHighWater: 7 })).fields,
        scope,
      );
    const result = api.projectDeclaredHistory(
      api.parseDeclaredHistory(checkpoint(position.sHighWater, position.pHighWater)),
      known,
    );
    expect(result).toMatchObject({
      sHighWater: 42,
      pHighWater: 7,
      sBurnFloor: 42,
      pBurnFloor: 7,
      nextS: 43,
      nextP: 8,
      occupied: [],
      originals: [],
      completeHistory: false,
      currentnessRequired: true,
      head: { revision: "0", digest: digest(checkpoint().checkpoint) },
    });
    expect(() =>
      api.assertPaperFloorAllows(result, reserve(6, "P").allocation, "recovery"),
    ).toThrowError(invalid);
    expect(() =>
      api.assertPaperFloorAllows(result, reserve(43).allocation, "initial-setup"),
    ).not.toThrow();
    expect(() =>
      api.assertPaperFloorAllows(result, reserve(8, "P").allocation, "recovery"),
    ).not.toThrow();
    expect(() =>
      api.assertPaperFloorAllows(result, reserve(43).allocation, "recovery"),
    ).toThrowError(invalid);
    expect(() =>
      api.assertPaperFloorAllows(
        result,
        { ...reserve(43).allocation, taxpayerNif: "B99999999" },
        "initial-setup",
      ),
    ).toThrowError(invalid);
  });
  it("keeps a reserved P6 usable before burning it, then refuses it despite its unused state", async () => {
    const api = await load(),
      r = revision([reserve(6, "P")], 0, 6),
      h = api.parseDeclaredHistory(complete([r]));
    const before = api.projectDeclaredHistory(h, known);
    expect(() =>
      api.assertPaperFloorAllows(before, reserve(6, "P").allocation, "recovery"),
    ).not.toThrow();
    expect(() =>
      api.assertPaperFloorAllows(
        before,
        { ...reserve(6, "P").allocation, allocationId: "replacement" },
        "recovery",
      ),
    ).toThrowError(invalid);
    const after = api.projectDeclaredHistory(api.parseDeclaredHistory(checkpoint(42, 7)), {
      ...known,
      history: h,
      currentHead: before.head,
      pHighWater: 6,
    });
    expect(after.pBurnFloor).toBe(7);
    expect(() =>
      api.assertPaperFloorAllows(after, reserve(6, "P").allocation, "recovery"),
    ).toThrowError(invalid);
  });
  it("refuses lower known positions and floors but admits equal-floor declarations without claiming head recognition", async () => {
    const api = await load(),
      h = api.parseDeclaredHistory(checkpoint());
    for (const extra of [
      { sHighWater: 43 },
      { pHighWater: 8 },
      { sBurnFloor: 43 },
      { pBurnFloor: 8 },
    ])
      expect(() => api.projectDeclaredHistory(h, { ...known, ...extra })).toThrowError(invalid);
    const result = api.projectDeclaredHistory(h, {
      ...known,
      sHighWater: 42,
      pHighWater: 7,
      currentHead: { registerId: "unseen", revision: "9", digest: "b".repeat(64) },
    });
    expect(result.currentnessRequired).toBe(true);
    expect(result.head.registerId).toBe("continuation");
    expect(result.head.digest).not.toBe("b".repeat(64));
  });
  it("refuses known older and forked files and admits the actual successor", async () => {
    const api = await load(),
      r = revision([reserve(), consume()]),
      r2 = revision([], 1, 0, digest(r), "2"),
      head = { registerId: "register-1", revision: "2", digest: digest(r2) };
    expect(() =>
      api.projectDeclaredHistory(api.parseDeclaredHistory(complete([r])), {
        ...known,
        currentHead: head,
      }),
    ).toThrowError(invalid);
    expect(() =>
      api.projectDeclaredHistory(
        api.parseDeclaredHistory(complete([r, { ...r2, createdAt: "2026-10-15T09:00:00.000Z" }])),
        { ...known, retainedHeads: [head] },
      ),
    ).toThrowError(invalid);
    expect(
      api.projectDeclaredHistory(api.parseDeclaredHistory(complete([r, r2])), {
        ...known,
        currentHead: head,
      }).nextS,
    ).toBe(2);
  });
  it("retains displaced unsigned revisions as exact public originals, outside checkpoint ancestry", async () => {
    const api = await load(),
      old = complete(),
      oldOriginal = original(complete([revision([], 0)]));
    const full = api.parseDeclaredHistory({ ...old, originals: [oldOriginal] }),
      cp = api.parseDeclaredHistory(checkpoint());
    const result = api.projectDeclaredHistory(cp, { ...known, history: full, sHighWater: 1 });
    const carrier = original(full);
    expect(result.originals).toEqual([oldOriginal, carrier]);
    expect(Buffer.from(result.originals[1]!.bytesBase64url, "base64url").toString()).toBe(
      canonical(full),
    );
    expect(result.history.revisions).toEqual([]);
    expect(result.completeHistory).toBe(false);
    expect(result.head.digest).toBe(digest(checkpoint().checkpoint));
    const added = reserve(43),
      r = revision(
        [added, consume(added)],
        43,
        7,
        digest(checkpoint().checkpoint),
        "1",
        "continuation",
      );
    const successor = api.projectDeclaredHistory(
      api.parseDeclaredHistory({ ...result.history, revisions: [r] }),
      {
        ...known,
        sBurnFloor: 42,
        pBurnFloor: 7,
        originals: result.originals,
        currentHead: result.head,
      },
    );
    expect(successor.originals).toEqual([oldOriginal, carrier]);
    expect(successor.completeHistory).toBe(false);
    expect(successor.nextS).toBe(44);
    expect(() =>
      api.assertPaperFloorAllows(successor, reserve(43).allocation, "initial-setup"),
    ).toThrowError(invalid);
    expect(canonical(successor.originals)).not.toContain("nodeKeys");
    expect(canonical(successor.originals)).not.toContain("secret");
  });
  it("archives the exact supplied lineage bytes even when repeated originals project to one entry", async () => {
    const api = await load(),
      entry = original(complete([revision([], 0)]));
    const supplied = api.parseDeclaredHistory({ ...complete(), originals: [entry, entry] });
    const result = api.projectDeclaredHistory(api.parseDeclaredHistory(checkpoint()), {
      ...known,
      history: supplied,
    });
    const carrier = result.originals.find(
      (x) => x.kind === "declared-paper-history" && x.digest === digest(supplied),
    );
    expect(carrier).toEqual(original(supplied));
    expect(Buffer.from(carrier!.bytesBase64url, "base64url").toString()).toBe(canonical(supplied));
  });
  it("adds later old-file originals without lowering floors or dropping newer facts", async () => {
    const api = await load(),
      cp = checkpoint(),
      r = revision([reserve(43)], 43, 7, digest(checkpoint().checkpoint), "1", "continuation");
    const newer = api.parseDeclaredHistory({ ...cp, revisions: [r] }),
      newOriginal = original(complete());
    const result = api.projectDeclaredHistory(
      api.parseDeclaredHistory({ ...newer, originals: [newOriginal] }),
      { ...known, history: newer, sHighWater: 43, pHighWater: 7, sBurnFloor: 42, pBurnFloor: 7 },
    );
    expect(result).toMatchObject({
      sHighWater: 43,
      sBurnFloor: 42,
      nextS: 44,
      completeHistory: false,
    });
    expect(result.originals).toEqual([newOriginal]);
    expect(result.occupied[0]?.allocation.installationIdentity).toBe("S000043");
    expect(() =>
      api.projectDeclaredHistory(api.parseDeclaredHistory(complete()), {
        ...known,
        sBurnFloor: 42,
        pBurnFloor: 7,
      }),
    ).toThrowError(invalid);
  });
  it("keeps externally retired bindings unavailable", async () => {
    const api = await load(),
      result = api.projectDeclaredHistory(
        api.parseDeclaredHistory(complete([revision([reserve()])])),
        { ...known, retiredBindings: [binding()] },
      );
    expect(() =>
      api.assertPaperFloorAllows(result, reserve().allocation, "initial-setup"),
    ).toThrowError(invalid);
  });
  it("does not relabel checkpoint history complete when known burn floors are supplied", async () => {
    const api = await load(),
      h = api.parseDeclaredHistory(complete([revision([], 43, 7)]));
    expect(() =>
      api.projectDeclaredHistory(h, { ...known, sBurnFloor: 42, pBurnFloor: 7 }),
    ).toThrowError(invalid);
  });
  it("refuses an older full checkpoint file of the same lineage", async () => {
    const api = await load(),
      cp = checkpoint(),
      r = revision([reserve(43)], 43, 7, digest(cp.checkpoint), "1", "continuation");
    const current = api.projectDeclaredHistory(
      api.parseDeclaredHistory({ ...cp, revisions: [r] }),
      known,
    );
    expect(() =>
      api.projectDeclaredHistory(api.parseDeclaredHistory(cp), {
        ...known,
        currentHead: current.head,
      }),
    ).toThrowError(invalid);
  });
  it("keeps retained signed paper bytes and refuses their out-of-scope or higher occupied name", async () => {
    const api = await load(),
      fixture = await import("./testing/register-fixture.js");
    const signed = fixture.reservation(1),
      bytes = Buffer.from(JSON.stringify(signed));
    const carrier = {
      kind: "signed-paper",
      bytesBase64url: bytes.toString("base64url"),
      digest: createHash("sha256").update(bytes).digest("hex"),
    };
    const result = api.projectDeclaredHistory(
      api.parseDeclaredHistory({ ...checkpoint(), originals: [carrier] }),
      known,
    );
    expect(result.originals).toEqual([carrier]);
    const higher = fixture.reservation(43),
      higherBytes = Buffer.from(JSON.stringify(higher));
    const higherCarrier = {
      ...carrier,
      bytesBase64url: higherBytes.toString("base64url"),
      digest: createHash("sha256").update(higherBytes).digest("hex"),
    };
    expect(() =>
      api.projectDeclaredHistory(
        api.parseDeclaredHistory({ ...checkpoint(), originals: [higherCarrier] }),
        known,
      ),
    ).toThrowError(invalid);
    const other = {
      ...signed,
      payload: {
        ...signed.payload,
        allocations: signed.payload.allocations.map((a) => ({ ...a, taxpayerNif: "B99999999" })),
      },
    };
    const otherBytes = Buffer.from(JSON.stringify(other));
    expect(() =>
      api.projectDeclaredHistory(
        api.parseDeclaredHistory({
          ...checkpoint(),
          originals: [
            {
              ...carrier,
              bytesBase64url: otherBytes.toString("base64url"),
              digest: createHash("sha256").update(otherBytes).digest("hex"),
            },
          ],
        }),
        known,
      ),
    ).toThrowError(invalid);
  });
  it("retains real-validator four-base candidates and exhaustion without wrap", async () => {
    const api = await load(),
      result = api.projectDeclaredHistory(
        api.parseDeclaredHistory(checkpoint(999999, 999999)),
        known,
      );
    expect([result.nextS, result.nextP]).toEqual([null, null]);
    const candidates = validatePaperCandidates(
      {
        attemptId: "attempt-1",
        binding: binding(),
        administratorId: "manager",
        recipientVenueId: "venue-1",
        country: "ES",
        taxId: scope.taxpayerNif,
        environment: "production",
        bases,
      },
      "P",
      [8],
    );
    expect(candidates.candidates[0]?.series.map((s) => s.code)).toEqual([
      "A-P000008",
      "B-P000008",
      "FF-P000008",
      "R-P000008",
    ]);
    const cp = api.projectDeclaredHistory(api.parseDeclaredHistory(checkpoint()), known);
    expect(() =>
      api.assertPaperFloorAllows(cp, candidates.candidates[0]!, "recovery"),
    ).not.toThrow();
  });
  it("preserves opaque Cloud originals byte-for-byte without admitting them as paper allocations", async () => {
    const api = await load(),
      fixture = JSON.parse(
        readFileSync(new URL("../test/cloud-allocation-receipt.json", import.meta.url), "utf8"),
      ) as { receipt: unknown };
    const bytes = Buffer.from(JSON.stringify(fixture.receipt)),
      carrier = {
        kind: "cloud-receipt",
        bytesBase64url: bytes.toString("base64url"),
        digest: createHash("sha256").update(bytes).digest("hex"),
      };
    const result = api.projectDeclaredHistory(
      api.parseDeclaredHistory({ ...checkpoint(), originals: [carrier] }),
      known,
    );
    expect(result.originals).toEqual([carrier]);
    expect(result.occupied).toEqual([]);
    expect(result.currentnessRequired).toBe(true);
  });
  it("preserves signed consumption originals without fabricating a reservation", async () => {
    const api = await load(),
      fixture = await import("./testing/register-fixture.js"),
      bytes = Buffer.from(JSON.stringify(fixture.consumption()));
    const carrier = {
      kind: "signed-paper",
      bytesBase64url: bytes.toString("base64url"),
      digest: createHash("sha256").update(bytes).digest("hex"),
    };
    const result = api.projectDeclaredHistory(
      api.parseDeclaredHistory({ ...checkpoint(), originals: [carrier] }),
      known,
    );
    expect(result.originals).toEqual([carrier]);
    expect(result.occupied).toEqual([]);
  });
  it.each([
    { scope: { ...scope, environment: "elsewhere" } },
    { sHighWater: -1 },
    { pHighWater: 1000000 },
    { currentHead: { registerId: "r", revision: "01", digest: "b".repeat(64) } },
    { retainedHeads: [{ registerId: "r", revision: "1", digest: "b" }] },
    { retiredBindings: [{ ...binding(), extra: true }] },
    { originals: [{ ...original(complete()), digest: "0".repeat(64) }] },
  ])("refuses malformed independently retained evidence %#", async (extra) => {
    const api = await load();
    expect(() =>
      api.projectDeclaredHistory(api.parseDeclaredHistory(checkpoint()), {
        ...known,
        ...extra,
      } as never),
    ).toThrowError(invalid);
  });
  it.each(["id", "name"])("refuses a duplicate %s in one revision", async (kind) => {
    const api = await load(),
      a = reserve(),
      b = reserve(2);
    const duplicate =
      kind === "id"
        ? { ...b, allocation: { ...b.allocation, allocationId: a.allocation.allocationId } }
        : { ...a, allocation: { ...a.allocation, allocationId: "other" } };
    expect(() =>
      api.projectDeclaredHistory(
        api.parseDeclaredHistory(complete([revision([a, duplicate], 2)])),
        known,
      ),
    ).toThrowError(invalid);
  });
  it("refuses lower replacement floors, higher retained lineages and hidden non-JSON values", async () => {
    const api = await load(),
      higher = api.parseDeclaredHistory(checkpoint(43, 8));
    expect(() =>
      api.projectDeclaredHistory(api.parseDeclaredHistory(checkpoint()), {
        ...known,
        history: higher,
      }),
    ).toThrowError(invalid);
    expect(() =>
      api.projectDeclaredHistory(
        api.parseDeclaredHistory({
          ...checkpoint(),
          originals: [original(complete([revision([reserve(43)], 43)]))],
        }),
        known,
      ),
    ).toThrowError(invalid);
    const sparse: unknown[] = [];
    sparse.length = 1;
    for (const value of [sparse, Symbol("x"), new Date(), { x: () => 0 }, { [Symbol("x")]: 1 }])
      expect(() => api.declaredHistoryBytes(value)).toThrowError(invalid);
    let deep: unknown = {};
    for (let n = 0; n < 34; n++) deep = { next: deep };
    expect(() => api.declaredHistoryBytes(deep)).toThrowError(invalid);
    expect(() => api.declaredHistoryBytes("x".repeat(8 * 1024 * 1024))).toThrowError(invalid);
  });
  it.each(
    [
      [null],
      [{ kind: "consume" }],
      [
        {
          kind: "reserve",
          allocation: reserve().allocation,
          recipientVenueId: "venue",
          binding: binding(),
          reservedAt: "bad",
        },
      ],
      [{ kind: "release", allocationId: "S-1", eventId: "release", reason: "x", createdAt: time }],
      [{ ...consume(), operatorId: null }],
      [{ ...reserve(), binding: { ...binding(), targetNodeId: "" } }],
    ].map((events) => ({ events })),
  )("refuses malformed event arrays %#", async ({ events }) => {
    const api = await load();
    expect(() => api.parseDeclaredHistory(complete([revision(events)]))).toThrowError(invalid);
  });
  it("refuses noncanonical or corrupt public original bytes", async () => {
    const api = await load(),
      good = original(complete());
    const invalids = [
      { ...good, bytesBase64url: good.bytesBase64url + "=" },
      { ...good, bytesBase64url: "!!!" },
      { ...good, kind: "unknown" },
      {
        ...good,
        bytesBase64url: Buffer.from("{}").toString("base64url"),
        digest: createHash("sha256").update("{}").digest("hex"),
      },
      {
        ...good,
        bytesBase64url: Buffer.from(JSON.stringify(complete())).toString("base64url"),
        digest: createHash("sha256").update(JSON.stringify(complete())).digest("hex"),
      },
    ];
    for (const bad of invalids)
      expect(() => api.parseDeclaredHistory({ ...checkpoint(), originals: [bad] })).toThrowError(
        invalid,
      );
  });
  it("does not revive a previously occupied but omitted serial", async () => {
    const api = await load(),
      result = api.projectDeclaredHistory(
        api.parseDeclaredHistory(complete([revision([], 42, 7)])),
        known,
      );
    expect(() =>
      api.assertPaperFloorAllows(result, reserve().allocation, "initial-setup"),
    ).toThrowError(invalid);
    expect(() =>
      api.assertPaperFloorAllows(result, reserve(6, "P").allocation, "recovery"),
    ).toThrowError(invalid);
    expect(() =>
      api.assertPaperFloorAllows(result, reserve(43).allocation, "initial-setup"),
    ).not.toThrow();
  });
  it.each([
    null,
    {},
    { ...complete(), signature: "hidden" },
    { ...complete(), nodeKeys: [{ secret: "hidden" }] },
    { ...complete(), revisions: [] },
    {
      ...checkpoint(),
      checkpoint: {
        ...checkpoint().checkpoint,
        current: {
          currentRegisterConfirmed: false,
          noParallelPaperAllocation: true,
          confirmedAt: time,
        },
      },
    },
    { ...checkpoint(-1) },
    { ...checkpoint(1000000) },
    { ...complete(), originals: [{ ...original(complete()), digest: "f".repeat(64) }] },
    { ...complete(), originals: [original({ ...complete(), nodeKeys: [{ secret: "hidden" }] })] },
  ])("refuses malformed or secret-bearing history %#", async (value) => {
    const api = await load();
    expect(() => api.parseDeclaredHistory(value)).toThrowError(invalid);
  });
});
