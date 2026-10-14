import { readFileSync } from "node:fs";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as fiscal from "./index.js";
import type { AllocationContext, AllocationValidation } from "./allocation-envelope.js";
import { validateAllocationReplay } from "./allocation-envelope.js";

const fixture = JSON.parse(
  readFileSync(new URL("../test/cloud-allocation-receipt.json", import.meta.url), "utf8"),
) as {
  issuer: string;
  keyId: string;
  publicKey: string;
  packet: string;
  receipt: {
    payload: {
      allocation: fiscal.FiscalAllocation;
      approval: fiscal.RecoveryApproval;
      [key: string]: unknown;
    };
    keyId: string;
    signature: string;
  };
};
const trust = { issuer: fixture.issuer, keys: new Map([[fixture.keyId, fixture.publicKey]]) };
const context: AllocationContext = {
  taxpayerNif: "89890001K",
  softwareId: "WT",
  environment: "preproduction",
  mode: "recovery",
  eventId: "event-1",
  operatorId: "operator-1",
  sourceId: "source-1",
  targetNodeId: "node-1",
  incidentEvidence: "incident-1",
  requiredBases: [
    { code: "A", purpose: "standard" },
    { code: "FF", purpose: "full" },
    { code: "R", purpose: "rectificative" },
  ],
  reauthentication: { eventId: "event-1", operatorId: "operator-1" },
  priorActivation: "none",
  authority: { kind: "cloud" },
};

function verify(value: unknown = fixture.receipt, held = context, enrolled: unknown = trust) {
  const api = fiscal as unknown as {
    verifyCloudAllocationEvidence?: (
      receipt: unknown,
      trust: unknown,
      context: AllocationContext,
    ) => AllocationValidation;
  };
  expect(api.verifyCloudAllocationEvidence).toBeTypeOf("function");
  return api.verifyCloudAllocationEvidence!(value, enrolled, held);
}

// The signing fixture uses Cloud's sorted recursive JSON wire format, independently of the verifier.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null)
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function signed(change: (payload: typeof fixture.receipt.payload) => void) {
  const payload = structuredClone(fixture.receipt.payload);
  change(payload);
  const keys = generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey.export({ type: "spki", format: "der" });
  const keyId = createHash("sha256").update(publicKey).digest("hex");
  const receipt = {
    payload,
    keyId,
    signature: sign(
      null,
      Buffer.from(canonical(["waitron.fiscal-allocation-receipt", 1, keyId, payload])),
      keys.privateKey,
    ).toString("base64url"),
  };
  return {
    receipt,
    trust: { issuer: fixture.issuer, keys: new Map([[keyId, publicKey.toString("base64url")]]) },
  };
}

describe("Cloud consumed evidence and independent local recovery authority", () => {
  it("validates a consumed packet produced by the landed Cloud signer", () => {
    expect(verify()).toEqual({
      ok: true,
      allocation: fixture.receipt.payload.allocation,
      approval: fixture.receipt.payload.approval,
    });
    expect(verify(fixture.packet)).toEqual(verify());
  });

  it("detaches and freezes the verified identity set and approval", () => {
    const input = structuredClone(fixture.receipt);
    const result = verify(input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected trusted receipt");
    Reflect.set(input.payload.allocation, "series", [{ code: "changed", purpose: "standard" }]);
    expect(result.allocation.series).toEqual([
      { code: "A-C000042", purpose: "standard" },
      { code: "FF-C000042", purpose: "full" },
      { code: "R-C000042", purpose: "rectificative" },
    ]);
    expect(Object.isFrozen(result.allocation.series[0])).toBe(true);
    expect(Object.isFrozen(result.allocation.reservationEvidence)).toBe(true);
    expect(Object.isFrozen(result.approval)).toBe(true);
  });

  it.each([null, { ...trust, issuer: "another-registry" }, { ...trust, keys: new Map() }])(
    "refuses missing or untrusted enrolment %#",
    (enrolled) => {
      expect(verify(fixture.receipt, context, enrolled)).toEqual({
        ok: false,
        reason: "reservation_untrusted",
      });
    },
  );

  it("refuses a changed signed allocation even when the changed identity fits the local bases", () => {
    const receipt = structuredClone(fixture.receipt);
    Reflect.set(receipt.payload.allocation, "installationIdentity", "C000043");
    Reflect.set(
      receipt.payload.allocation,
      "series",
      context.requiredBases.map((base) => ({
        code: `${base.code}-C000043`,
        purpose: base.purpose,
      })),
    );
    expect(verify(receipt)).toEqual({ ok: false, reason: "reservation_untrusted" });
  });

  it("refuses changed signature bytes on an otherwise unchanged trusted receipt", () => {
    const signature = Buffer.from(fixture.receipt.signature, "base64url");
    signature[0] = signature[0]! ^ 1;
    expect(verify({ ...fixture.receipt, signature: signature.toString("base64url") })).toEqual({
      ok: false,
      reason: "reservation_untrusted",
    });
  });

  it.each(["reserved", "abandoned"])("refuses a correctly signed %s receipt", (state) => {
    const input = signed((payload) => {
      payload.state = state;
      (payload as Record<string, unknown>).approval = null;
    });
    expect(verify(input.receipt, context, input.trust)).toEqual({
      ok: false,
      reason: state === "reserved" ? "reservation_not_consumed" : "reservation_abandoned",
    });
  });

  it.each(["eventId", "sourceId", "targetNodeId", "operatorId", "incidentEvidence"])(
    "binds the signed %s to the local event",
    (field) => {
      expect(verify(fixture.receipt, { ...context, [field]: "different" })).toEqual({
        ok: false,
        reason: "event_mismatch",
      });
    },
  );

  it.each([
    ["taxpayerNif", "B12345674", "taxpayer_mismatch"],
    ["softwareId", "AB", "software_mismatch"],
    ["environment", "production", "environment_mismatch"],
  ])("binds %s to the local fiscal scope", (field, value, reason) => {
    expect(verify(fixture.receipt, { ...context, [field]: value })).toEqual({ ok: false, reason });
  });

  it("refuses substituting the full-invoice purpose in the local snapshot", () => {
    expect(
      verify(fixture.receipt, {
        ...context,
        requiredBases: [
          { code: "A", purpose: "standard" },
          { code: "FF", purpose: "standard" },
          { code: "R", purpose: "rectificative" },
        ],
      }),
    ).toEqual({ ok: false, reason: "series_mismatch" });
  });

  it("does not infer reauthentication from the signed Cloud account", () => {
    expect(verify(fixture.receipt, { ...context, reauthentication: null })).toEqual({
      ok: false,
      reason: "reauthentication_required",
    });
  });

  it.each([
    ["committed", "prior_activation_requires_replay"],
    ["uncertain", "uncertain_prior_activation"],
  ] as const)("refuses a new activation when local history is %s", (priorActivation, reason) => {
    expect(verify(fixture.receipt, { ...context, priorActivation })).toEqual({ ok: false, reason });
  });

  it.each([
    null,
    [],
    { ...fixture.receipt, secret: "extra" },
    { ...fixture.receipt, signature: `${fixture.receipt.signature}=` },
    { ...fixture.receipt, signature: Buffer.alloc(63).toString("base64url") },
    `${fixture.packet}=`,
    "WAITRON-FISCAL-ALLOCATION-1:" + "A".repeat(12289),
    "WAITRON-FISCAL-ALLOCATION-1:" + Buffer.from("{}").toString("base64url"),
  ])("refuses malformed, extended and oversized evidence %#", (input) => {
    expect(verify(input)).toEqual({ ok: false, reason: "reservation_untrusted" });
  });

  it("refuses a packet whose JSON spelling differs from Cloud's canonical bytes", () => {
    const packet =
      "WAITRON-FISCAL-ALLOCATION-1:" +
      Buffer.from(JSON.stringify(fixture.receipt, null, 2)).toString("base64url");
    expect(verify(packet)).toEqual({ ok: false, reason: "reservation_untrusted" });
  });

  it.each([
    (p: typeof fixture.receipt.payload) => {
      p.version = 2;
    },
    (p: typeof fixture.receipt.payload) => {
      p.privateKey = "hidden";
    },
    (p: typeof fixture.receipt.payload) => {
      p.recordedAt = "2026-02-30T10:00:00.000Z";
    },
    (p: typeof fixture.receipt.payload) => {
      p.venueId = "not-a-uuid";
    },
    (p: typeof fixture.receipt.payload) => {
      Reflect.set(p.allocation, "reservationEvidence", { kind: "cloud", receipt: fixture.receipt });
    },
    (p: typeof fixture.receipt.payload) => {
      Reflect.set(p.allocation, "reservationEvidence", {
        kind: "cloud",
        authorityId: "another-authority",
        reservationId: "10000000-0000-4000-8000-000000000001",
        reservationSequence: "42",
      });
    },
    (p: typeof fixture.receipt.payload) => {
      Reflect.set(p.allocation, "reservationEvidence", {
        kind: "cloud",
        authorityId: "fixture-authority",
        reservationId: "10000000-0000-4000-8000-000000000001",
        reservationSequence: "43",
      });
    },
    (p: typeof fixture.receipt.payload) => {
      p.continuity = { ...(p.continuity as object), cHighWater: 41 };
    },
    (p: typeof fixture.receipt.payload) => {
      p.continuity = {
        ...(p.continuity as object),
        scope: { taxpayerNif: "B12345674", softwareId: "WT", environment: "preproduction" },
      };
    },
    (p: typeof fixture.receipt.payload) => {
      p.binding = { ...(p.binding as object), sourceId: "another" };
    },
  ])("refuses correctly signed but inconsistent receipt metadata %#", (change) => {
    const input = signed(change);
    expect(verify(input.receipt, context, input.trust)).toEqual({
      ok: false,
      reason: "reservation_untrusted",
    });
  });

  it("requires the enrolled key's fingerprint to equal the receipt's key id", () => {
    const other = generateKeyPairSync("ed25519");
    expect(
      verify(fixture.receipt, context, {
        issuer: fixture.issuer,
        keys: new Map([
          [
            fixture.keyId,
            other.publicKey.export({ type: "spki", format: "der" }).toString("base64url"),
          ],
        ]),
      }),
    ).toEqual({ ok: false, reason: "reservation_untrusted" });
  });

  it("refuses a valid signature whose enrolled key is labeled with another fingerprint", () => {
    const other = generateKeyPairSync("ed25519");
    const mislabeled = {
      ...fixture.receipt,
      signature: sign(
        null,
        Buffer.from(
          canonical([
            "waitron.fiscal-allocation-receipt",
            1,
            fixture.keyId,
            fixture.receipt.payload,
          ]),
        ),
        other.privateKey,
      ).toString("base64url"),
    };
    expect(
      verify(mislabeled, context, {
        issuer: fixture.issuer,
        keys: new Map([
          [
            fixture.keyId,
            other.publicKey.export({ type: "spki", format: "der" }).toString("base64url"),
          ],
        ]),
      }),
    ).toEqual({ ok: false, reason: "reservation_untrusted" });
  });

  it("retains a consumed receipt without requiring a live subscription or wall-clock freshness", () => {
    const input = signed((payload) => {
      payload.entitlementVersion = "ended-entitlement-retained-receipt";
      payload.recordedAt = "2020-01-01T00:00:00.000Z";
    });
    expect(verify(input.receipt, context, input.trust)).toEqual({
      ok: true,
      allocation: input.receipt.payload.allocation,
      approval: input.receipt.payload.approval,
    });
  });

  it("keeps the recovery-key operator as a tagged node/event identity", () => {
    const operator = { kind: "recovery-key" as const, nodeId: "node-1", eventId: "event-1" };
    const input = signed((payload) => {
      payload.binding = { ...(payload.binding as object), operatorId: operator };
      Reflect.set(payload.approval, "operatorId", operator);
    });
    const expected = {
      ...context,
      operatorId: operator,
      reauthentication: { eventId: "event-1", operatorId: operator },
    };
    expect(verify(input.receipt, expected, input.trust)).toEqual({
      ok: true,
      allocation: input.receipt.payload.allocation,
      approval: input.receipt.payload.approval,
    });
    expect(verify(input.receipt, context, input.trust)).toEqual({
      ok: false,
      reason: "event_mismatch",
    });
  });

  it("refuses substituting an independently trusted receipt for a different allocation", () => {
    const different = signed((payload) => {
      Reflect.set(payload.allocation, "allocationId", "10000000-0000-4000-8000-000000000006");
    });
    expect(
      fiscal.validateAllocationEnvelope(
        fixture.receipt.payload.allocation,
        fixture.receipt.payload.approval,
        {
          ...context,
          authority: { kind: "cloud", receipt: different.receipt, trust: different.trust },
        },
      ),
    ).toEqual({ ok: false, reason: "reservation_mismatch" });
  });

  it("refuses changing the approval beside an unchanged signed receipt", () => {
    expect(
      fiscal.validateAllocationEnvelope(
        fixture.receipt.payload.allocation,
        { ...fixture.receipt.payload.approval, confirmedAt: "2026-10-14T10:00:00.000Z" },
        { ...context, authority: { kind: "cloud", receipt: fixture.receipt, trust } },
      ),
    ).toEqual({ ok: false, reason: "reservation_mismatch" });
  });

  it("allows only the exact retained allocation and approval through local replay", () => {
    const allocation = fixture.receipt.payload.allocation;
    const approval = fixture.receipt.payload.approval;
    const replay = {
      ...context,
      priorActivation: "committed" as const,
      authority: { kind: "cloud" as const, receipt: fixture.receipt, trust },
    };
    expect(
      validateAllocationReplay(allocation, approval, replay, { allocation, approval }),
    ).toEqual({ ok: true, allocation, approval });
    expect(
      validateAllocationReplay(allocation, approval, replay, {
        allocation,
        approval: { ...approval, sourceId: "different-source" },
      }),
    ).toEqual({ ok: false, reason: "event_mismatch" });
  });
});
