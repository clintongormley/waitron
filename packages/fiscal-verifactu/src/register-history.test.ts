import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  completeHistory,
  checkpointHistory,
  consumption,
  reservation,
  revision,
  fixtureSign,
  fixtureDigest,
  registerScope,
  registerTrust,
  canonicalFixture,
} from "./testing/register-fixture.js";
import { paperBlockBytes } from "./paper-protocol.js";
import { registerHeadTag } from "./register-protocol.js";

const load = () => import("./register-history.js");
const known = {
  sHighWater: 0,
  pHighWater: 0,
  currentHead: null,
  retainedHeads: [],
  retainedOriginals: [],
};
const invalid = expect.objectContaining({ code: "sif.allocation_invalid" });

describe("signed paper register history", () => {
  it("can bind an independently known custody version to an explicitly unknown checkpoint version", async () => {
    const api = await load(),
      input = api.parseRegisterHistory(checkpointHistory());
    const result = await api.verifyRegisterHistory(input, registerTrust, {
      ...known,
      custodyVersion: 1,
    });
    expect(result.custodyVersion).toBe(1);
    expect(input.custodyVersion).toBe(null);
    expect(result.completeHistory).toBe(false);
  });
  it("takes custody version authority only from independent known evidence", async () => {
    const api = await load(),
      input = api.parseRegisterHistory(completeHistory());
    expect((await api.verifyRegisterHistory(input, registerTrust, known)).custodyVersion).toBe(
      null,
    );
    expect(
      (await api.verifyRegisterHistory(input, registerTrust, { ...known, custodyVersion: 1 }))
        .custodyVersion,
    ).toBe(1);
    await expect(
      api.verifyRegisterHistory(input, registerTrust, { ...known, custodyVersion: 2 }),
    ).rejects.toEqual(invalid);
  });
  it("preserves original signed objects and occupied S1/S2 for two venues", async () => {
    const api = await load();
    const first = reservation(1),
      second = reservation(2, "venue-2");
    const r1 = revision(
      [
        { kind: "reserve", block: first },
        { kind: "consume", consumption: consumption(first) },
      ],
      1,
    );
    const r2 = revision(
      [
        { kind: "reserve", block: second },
        { kind: "consume", consumption: consumption(second) },
      ],
      2,
      0,
      fixtureDigest(r1),
      "2",
    );
    const input = completeHistory([r1, r2]);
    const parsed = api.parseRegisterHistory(input);
    expect(parsed).toEqual(input);
    const result = await api.verifyRegisterHistory(parsed, registerTrust, known);
    expect(result).toMatchObject({
      mode: "complete",
      sHighWater: 2,
      pHighWater: 0,
      nextS: 3,
      nextP: 1,
      completeHistory: true,
      currentnessRequired: true,
      head: { registerId: "register-1", revision: "2", digest: fixtureDigest(r2) },
    });
    expect(
      result.occupied.map((entry) => [
        entry.allocation.installationIdentity,
        entry.recipientVenueId,
        entry.state,
      ]),
    ).toEqual([
      ["S000001", "venue-1", "consumed"],
      ["S000002", "venue-2", "consumed"],
    ]);
    expect(result.originals).toEqual([first, consumption(first), second, consumption(second)]);
    expect(result.originals).not.toBe(input.revisions);
    expect(Object.isFrozen(parsed.revisions)).toBe(true);
  });
  it.each([
    "gap",
    "predecessor",
    "duplicate-allocation",
    "duplicate-name",
    "lowered-floor",
    "terminal-to-free",
    "bad-consumption",
    "wrong-scope",
    "wrong-key",
    "tampered-signature",
  ])("refuses %s", async (kind) => {
    const api = await load();
    const r1 = revision(
      [
        { kind: "reserve", block: reservation(1) },
        { kind: "consume", consumption: consumption() },
      ],
      1,
    );
    let events: unknown[] = [{ kind: "reserve", block: reservation(2, "venue-2") }];
    let floor = 2,
      previous = fixtureDigest(r1),
      n = "2";
    if (kind === "gap") n = "3";
    if (kind === "predecessor") previous = "f".repeat(64);
    if (kind === "duplicate-allocation") events = [{ kind: "reserve", block: reservation(1) }];
    if (kind === "duplicate-name") {
      const b = reservation(1);
      const payload = {
        ...b.payload,
        blockId: "other-block",
        allocations: [{ ...b.payload.allocations[0]!, allocationId: "different-id" }],
      };
      events = [
        {
          kind: "reserve",
          block: {
            payload,
            signature: sign(
              null,
              paperBlockBytes(payload),
              createPrivateKey({
                key: Buffer.from(
                  "302e020100300506032b6570042204209d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
                  "hex",
                ),
                format: "der",
                type: "pkcs8",
              }),
            ).toString("base64url"),
          },
        },
      ];
    }
    if (kind === "lowered-floor") {
      floor = 0;
      events = [];
    }
    if (kind === "terminal-to-free")
      events = [{ kind: "release", allocationId: "allocation-1", eventId: "release-1" }];
    if (kind === "bad-consumption")
      events = [{ kind: "consume", consumption: consumption(reservation(2)) }];
    let r2 = revision(events, floor, 0, previous, n);
    if (kind === "wrong-scope")
      r2 = fixtureSign(
        { ...r2.payload, scope: { ...registerScope, environment: "preproduction" as const } },
        "waitron.paper-register-revision",
      );
    if (kind === "tampered-signature") r2 = { ...r2, signature: "A".repeat(86) };
    const trust =
      kind === "wrong-key"
        ? {
            ...registerTrust,
            publicKey: createPublicKey(
              createPrivateKey({
                key: Buffer.from("302e020100300506032b657004220420" + "01".repeat(32), "hex"),
                format: "der",
                type: "pkcs8",
              }),
            )
              .export({ type: "spki", format: "pem" })
              .toString(),
          }
        : registerTrust;
    await expect(async () =>
      api.verifyRegisterHistory(api.parseRegisterHistory(completeHistory([r1, r2])), trust, known),
    ).rejects.toEqual(invalid);
  });
  it("verifies conservative floors without inventing original history or trusting a typed freshness claim", async () => {
    const api = await load(),
      input = checkpointHistory();
    const result = await api.verifyRegisterHistory(
      api.parseRegisterHistory(input),
      registerTrust,
      known,
    );
    expect(result).toMatchObject({
      mode: "checkpoint",
      nextS: 43,
      nextP: 8,
      sHighWater: 42,
      pHighWater: 7,
      completeHistory: false,
      currentnessRequired: true,
      occupied: [],
      originals: [],
      custodyVersion: null,
      head: {
        registerId: "continuation-1",
        revision: "0",
        digest: fixtureDigest(input.checkpoint),
      },
    });
    expect(input.revisions).toEqual([]);
    await expect(
      api.verifyRegisterHistory(api.parseRegisterHistory(input), registerTrust, {
        ...known,
        sHighWater: 43,
      }),
    ).rejects.toEqual(invalid);
    await expect(
      api.verifyRegisterHistory(api.parseRegisterHistory(completeHistory()), registerTrust, {
        ...known,
        sHighWater: 42,
        pHighWater: 7,
      }),
    ).rejects.toEqual(invalid);
  });
  it.each(["retire", "uncertain"] as const)(
    "keeps %s reservations permanently occupied",
    async (kind) => {
      const api = await load();
      const r = revision(
        [
          { kind: "reserve", block: reservation(1) },
          { kind, allocationId: "allocation-1", eventId: "terminal-1" },
        ],
        1,
      );
      const result = await api.verifyRegisterHistory(
        api.parseRegisterHistory(completeHistory([r])),
        registerTrust,
        known,
      );
      expect(result.occupied[0]?.state).toBe(kind === "retire" ? "retired" : "uncertain");
      expect(result.nextS).toBe(2);
    },
  );
  it("keeps the checkpoint and original evidence through signed later revisions", async () => {
    const api = await load(),
      source = checkpointHistory();
    const block = reservation(43, "venue-43");
    const payload = {
      ...revision([{ kind: "reserve", block }], 43, 7, fixtureDigest(source.checkpoint)).payload,
      registerId: "continuation-1",
    };
    const input = {
      ...source,
      retainedOriginals: [reservation(1), consumption()],
      revisions: [fixtureSign(payload, "waitron.paper-register-revision")],
    };
    const result = await api.verifyRegisterHistory(api.parseRegisterHistory(input), registerTrust, {
      ...known,
      retainedOriginals: [reservation(1), consumption()],
    });
    expect(result).toMatchObject({
      mode: "checkpoint",
      nextS: 44,
      nextP: 8,
      completeHistory: false,
    });
    expect(result.originals).toEqual([reservation(1), consumption(), block]);
    await expect(
      api.verifyRegisterHistory(
        api.parseRegisterHistory({ ...input, retainedOriginals: [] }),
        registerTrust,
        { ...known, retainedOriginals: [reservation(1)] },
      ),
    ).rejects.toEqual(invalid);
  });
  it("anchors a new checkpoint to a known current full head without fabricating that predecessor", async () => {
    const api = await load(),
      currentHead = { registerId: "old-register", revision: "9", digest: "b".repeat(64) };
    const source = checkpointHistory();
    const payload = {
      ...source.checkpoint.payload,
      sourceHeadTag: await registerHeadTag(currentHead),
    };
    const input = { ...source, checkpoint: fixtureSign(payload, "waitron.paper-burn-checkpoint") };
    const result = await api.verifyRegisterHistory(api.parseRegisterHistory(input), registerTrust, {
      ...known,
      currentHead,
    });
    expect(result.head.digest).toBe(fixtureDigest(input.checkpoint));
    expect(result.head.digest).not.toBe(currentHead.digest);
    expect(result.currentnessRequired).toBe(true);
    await expect(
      api.verifyRegisterHistory(api.parseRegisterHistory(source), registerTrust, {
        ...known,
        currentHead,
      }),
    ).rejects.toEqual(invalid);
    await expect(
      api.verifyRegisterHistory(api.parseRegisterHistory(input), registerTrust, {
        ...known,
        currentHead: { ...currentHead, revision: "10", digest: "c".repeat(64) },
        retainedHeads: [currentHead],
      }),
    ).rejects.toEqual(invalid);
  });
  it("never allocates below a reservation preserved as original checkpoint evidence", async () => {
    const api = await load(),
      source = checkpointHistory();
    await expect(
      api.verifyRegisterHistory(
        api.parseRegisterHistory({ ...source, retainedOriginals: [reservation(43)] }),
        registerTrust,
        known,
      ),
    ).rejects.toEqual(invalid);
  });
  it.each(["block", "consumption"])(
    "checks an original %s signature even inside an authentic revision",
    async (part) => {
      const api = await load(),
        block = reservation(1),
        used = consumption(block);
      const events = [
        {
          kind: "reserve",
          block: part === "block" ? { ...block, signature: "A".repeat(86) } : block,
        },
        {
          kind: "consume",
          consumption: part === "consumption" ? { ...used, signature: "A".repeat(86) } : used,
        },
      ];
      const input = completeHistory([revision(events, 1)]);
      await expect(
        api.verifyRegisterHistory(api.parseRegisterHistory(input), registerTrust, known),
      ).rejects.toEqual(invalid);
    },
  );
  it("refuses known forks and older heads even when their high-water positions match", async () => {
    const api = await load(),
      old = completeHistory();
    const oldHead = {
      registerId: "register-1",
      revision: "1",
      digest: fixtureDigest(old.revisions[0]),
    };
    const later = revision([], 1, 0, oldHead.digest, "2");
    const currentHead = { registerId: "register-1", revision: "2", digest: fixtureDigest(later) };
    await expect(
      api.verifyRegisterHistory(api.parseRegisterHistory(old), registerTrust, {
        ...known,
        sHighWater: 1,
        currentHead,
        retainedHeads: [oldHead],
      }),
    ).rejects.toEqual(invalid);
    const fork = revision([], 1, 0, oldHead.digest, "2");
    const changed = fixtureSign(
      { ...fork.payload, createdAt: "2026-10-15T09:00:00.000Z" },
      "waitron.paper-register-revision",
    );
    await expect(
      api.verifyRegisterHistory(
        api.parseRegisterHistory(completeHistory([old.revisions[0]!, changed])),
        registerTrust,
        { ...known, currentHead },
      ),
    ).rejects.toEqual(invalid);
    expect(
      (
        await api.verifyRegisterHistory(
          api.parseRegisterHistory(completeHistory([old.revisions[0]!, later])),
          registerTrust,
          { ...known, currentHead },
        )
      ).nextS,
    ).toBe(2);
  });
  it.each([
    null,
    {},
    { ...completeHistory(), extra: true },
    { ...completeHistory(), revisions: [] },
    { ...completeHistory(), mode: "other" },
    { ...checkpointHistory(), custodyVersion: 0 },
    { ...checkpointHistory(), checkpoint: { ...checkpointHistory().checkpoint, signature: "A=" } },
  ])("refuses malformed history %#", async (input) => {
    const api = await load();
    expect(() => api.parseRegisterHistory(input)).toThrowError(invalid);
  });
  it("pins canonical public bytes independently of object insertion order", async () => {
    const { canonicalRegisterBytes } = await import("./register-protocol.js");
    expect(
      new TextDecoder().decode(canonicalRegisterBytes(["domain", { z: 2, a: { y: "é", b: 1 } }])),
    ).toBe('["domain",{"a":{"b":1,"y":"é"},"z":2}]');
    expect(createHash("sha256").update(canonicalRegisterBytes(registerScope)).digest("hex")).toBe(
      createHash("sha256").update(canonicalFixture(registerScope)).digest("hex"),
    );
  });
  it("reports exhausted ranges without wrapping", async () => {
    const api = await load();
    const result = await api.verifyRegisterHistory(
      api.parseRegisterHistory(checkpointHistory(999999, 999999)),
      registerTrust,
      known,
    );
    expect([result.nextS, result.nextP]).toEqual([null, null]);
    await expect(async () =>
      api.parseRegisterHistory(checkpointHistory(1000000, 0)),
    ).rejects.toEqual(invalid);
  });
});
