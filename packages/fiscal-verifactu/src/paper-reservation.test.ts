import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as evidence from "./paper-evidence.js";

const keys = generateKeyPairSync("ed25519");
const otherKeys = generateKeyPairSync("ed25519");
const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const trust = evidence.enrolPaperCustodian(
  "custodian",
  publicKey,
  evidence.paperCustodianFingerprint(publicKey),
)!;
const allocation = {
  version: 1 as const,
  allocationId: "allocation-42",
  taxpayerNif: "B12345678",
  softwareId: "WT",
  environment: "preproduction" as const,
  installationIdentity: "P000042",
  series: [
    { code: "A-P000042", purpose: "standard" },
    { code: "FF-P000042", purpose: "full" },
    { code: "R-P000042", purpose: "rectificative" },
  ],
  source: "paper" as const,
  issuedAt: "2026-10-12T08:00:00.000Z",
};
const payload = {
  version: 1 as const,
  custodianId: "custodian",
  generationId: "generation-1",
  blockId: "block-1",
  packVersion: 1 as const,
  recipientVenueId: "venue-1",
  allocations: [allocation],
};
const blockBytes = Buffer.from(
  JSON.stringify([
    "waitron.paper-block",
    1,
    "custodian",
    "generation-1",
    "block-1",
    1,
    "venue-1",
    [
      [
        1,
        "allocation-42",
        "B12345678",
        "WT",
        "preproduction",
        "P000042",
        [
          ["A-P000042", "standard"],
          ["FF-P000042", "full"],
          ["R-P000042", "rectificative"],
        ],
        "paper",
        "2026-10-12T08:00:00.000Z",
      ],
    ],
  ]),
);
const block = { payload, signature: sign(null, blockBytes, keys.privateKey).toString("base64url") };
const event = {
  eventId: "join-1",
  operatorId: "administrator",
  sourceId: "primary-node",
  targetNodeId: "standby-node",
  incidentEvidence: "master-register/join-1",
  reservedAt: "2026-10-12T09:00:00.000Z",
};
const reservation = {
  version: 1 as const,
  custodianId: "custodian",
  blockDigest: createHash("sha256").update(blockBytes).digest("hex"),
  allocationId: "allocation-42",
  ...event,
};
const reservationBytes = Buffer.from(
  JSON.stringify([
    "waitron.paper-reservation",
    1,
    "custodian",
    reservation.blockDigest,
    "allocation-42",
    "join-1",
    "administrator",
    "primary-node",
    "standby-node",
    "master-register/join-1",
    "2026-10-12T09:00:00.000Z",
  ]),
);
const receipt = {
  payload: reservation,
  signature: sign(null, reservationBytes, keys.privateKey).toString("base64url"),
};
const context = {
  allocationId: "allocation-42",
  taxpayerNif: "B12345678",
  softwareId: "WT",
  environment: "preproduction",
  recipientVenueId: "venue-1",
  generationId: "generation-1",
  blockId: "block-1",
  eventId: "join-1",
  operatorId: "administrator",
  sourceId: "primary-node",
  targetNodeId: "standby-node",
  incidentEvidence: "master-register/join-1",
  currentRegisterConfirmed: true,
  reservationConfirmed: true,
  currentEntryState: "reserved" as const,
  requiredBases: [
    { code: "A", purpose: "standard" },
    { code: "FF", purpose: "full" },
    { code: "R", purpose: "rectificative" },
  ],
};

function check(
  input: unknown = { block, reservation: receipt },
  authority: unknown = trust,
  expected = context,
) {
  return evidence.verifyPaperReservation(input, authority, expected);
}

describe("a paper reservation for a dormant named standby", () => {
  it("accepts independently signed reservation evidence with every invoice purpose", () => {
    expect(check()).toEqual({ ok: true, allocation, reservation });
  });

  it.each([
    "taxpayerNif",
    "softwareId",
    "environment",
    "recipientVenueId",
    "generationId",
    "blockId",
    "allocationId",
    "eventId",
    "operatorId",
    "sourceId",
    "targetNodeId",
    "incidentEvidence",
  ])("refuses a reservation for another %s", (field) => {
    expect(check(undefined, trust, { ...context, [field]: "other" })).toEqual({
      ok: false,
      reason: "scope_mismatch",
    });
  });

  it.each(["consumed-for-event", "consumed-elsewhere", "retired", "abandoned", "unknown"])(
    "refuses outside register state %s",
    (state) => {
      expect(
        check(undefined, trust, { ...context, currentEntryState: state } as typeof context),
      ).toEqual({ ok: false, reason: "reservation_not_current" });
    },
  );

  it.each(["currentRegisterConfirmed", "reservationConfirmed"])(
    "requires host confirmation %s",
    (field) => {
      expect(check(undefined, trust, { ...context, [field]: false })).toEqual({
        ok: false,
        reason: "outside_confirmation_missing",
      });
      expect(check(undefined, trust, { ...context, [field]: "true" })).toEqual({
        ok: false,
        reason: "outside_confirmation_missing",
      });
    },
  );

  it.each([null, { ...trust, fingerprint: "0".repeat(64) }, { ...trust, custodianId: "other" }])(
    "refuses untrusted custodian %j",
    (authority) => {
      expect(check(undefined, authority)).toEqual({ ok: false, reason: "untrusted" });
    },
  );

  it("refuses a replaced custodian key even when the old evidence still has valid signatures", () => {
    const newKey = otherKeys.publicKey.export({ type: "spki", format: "pem" }).toString();
    const newTrust = evidence.enrolPaperCustodian(
      "custodian",
      newKey,
      evidence.paperCustodianFingerprint(newKey),
    );
    expect(check(undefined, newTrust)).toEqual({ ok: false, reason: "untrusted" });
  });

  it.each(["block", "reservation"])("checks the %s signature", (field) => {
    const input = structuredClone({ block, reservation: receipt });
    input[field as keyof typeof input].signature = sign(
      null,
      field === "block" ? blockBytes : reservationBytes,
      otherKeys.privateKey,
    ).toString("base64url");
    expect(check(input)).toEqual({ ok: false, reason: "untrusted" });
  });

  it("refuses a changed target even when the rest of the signed reservation is intact", () => {
    expect(
      check({
        block,
        reservation: { ...receipt, payload: { ...reservation, targetNodeId: "other-node" } },
      }),
    ).toEqual({ ok: false, reason: "untrusted" });
  });

  it("refuses the same node as source and target, even with a matching independently signed receipt", () => {
    const bytes = Buffer.from(
      JSON.stringify([
        "waitron.paper-reservation",
        1,
        "custodian",
        reservation.blockDigest,
        "allocation-42",
        "join-1",
        "administrator",
        "primary-node",
        "primary-node",
        "master-register/join-1",
        event.reservedAt,
      ]),
    );
    expect(
      check(
        {
          block,
          reservation: {
            payload: { ...reservation, targetNodeId: "primary-node" },
            signature: sign(null, bytes, keys.privateKey).toString("base64url"),
          },
        },
        trust,
        { ...context, targetNodeId: "primary-node" },
      ),
    ).toEqual({ ok: false, reason: "scope_mismatch" });
  });

  it("refuses a valid signed receipt for a different block digest", () => {
    const digest = "0".repeat(64);
    const bytes = Buffer.from(
      JSON.stringify([
        "waitron.paper-reservation",
        1,
        "custodian",
        digest,
        "allocation-42",
        "join-1",
        "administrator",
        "primary-node",
        "standby-node",
        "master-register/join-1",
        event.reservedAt,
      ]),
    );
    expect(
      check({
        block,
        reservation: {
          payload: { ...reservation, blockDigest: digest },
          signature: sign(null, bytes, keys.privateKey).toString("base64url"),
        },
      }),
    ).toEqual({ ok: false, reason: "scope_mismatch" });
  });

  it("requires the complete standard, full and rectificative series", () => {
    expect(
      check(undefined, trust, { ...context, requiredBases: context.requiredBases.slice(0, 2) }),
    ).toEqual({ ok: false, reason: "series_mismatch" });
    expect(check(undefined, trust, { ...context, requiredBases: [] })).toEqual({
      ok: false,
      reason: "series_mismatch",
    });
  });

  it.each([
    null,
    [],
    {},
    { block },
    { reservation: receipt },
    { block, consumption: receipt },
    { block, reservation: receipt, trust },
  ])("refuses malformed evidence %j", (input) => {
    expect(check(input)).toEqual({ ok: false, reason: "malformed" });
  });

  it.each([
    "version",
    "custodianId",
    "blockDigest",
    "allocationId",
    "eventId",
    "operatorId",
    "sourceId",
    "targetNodeId",
    "incidentEvidence",
    "reservedAt",
  ])("refuses a malformed reservation field %s", (field) => {
    expect(
      check({ block, reservation: { ...receipt, payload: { ...reservation, [field]: null } } }),
    ).toEqual({ ok: false, reason: "malformed" });
  });

  it("returns a detached frozen proof rather than retaining mutable submitted state", () => {
    const input = structuredClone({ block, reservation: receipt });
    const result = check(input) as {
      ok: true;
      allocation: typeof allocation;
      reservation: typeof reservation;
    };
    input.block.payload.allocations[0]!.series[0]!.code = "changed";
    input.reservation.payload.targetNodeId = "changed";
    expect(result.allocation.series[0]).toEqual({ code: "A-P000042", purpose: "standard" });
    expect(result.reservation.targetNodeId).toBe("standby-node");
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.reservation)).toBe(true);
    expect(Object.isFrozen(result.allocation.series)).toBe(true);
    expect(Object.isFrozen(result.allocation.series[0])).toBe(true);
  });

  it("cannot use the reservation receipt as an activation consumption receipt", () => {
    expect(
      evidence.verifyPaperEvidence({ block, consumption: receipt }, trust, {
        ...context,
        consumptionConfirmed: true,
      }),
    ).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("the outside custodian signs the named reservation", () => {
  function mint(
    input: unknown = block,
    id = "allocation-42",
    scope: unknown = event,
    key = privateKey,
  ) {
    return evidence.signPaperReservationForBlock(input, id, scope, key);
  }

  it("signs the exact domain-separated bytes independently checked by the public key", () => {
    const proof = mint();
    expect(proof.payload).toEqual(reservation);
    expect(
      verify(null, reservationBytes, keys.publicKey, Buffer.from(proof.signature, "base64url")),
    ).toBe(true);
    expect(check({ block, reservation: proof })).toEqual({ ok: true, allocation, reservation });
  });

  it("refuses an initial setup allocation for a standby reservation", () => {
    const initial = evidence.signPaperBlock(
      {
        ...payload,
        allocations: [
          {
            ...allocation,
            source: "initial-paper",
            installationIdentity: "S000001",
            series: [{ code: "A-S000001", purpose: "standard" }],
          },
        ],
      },
      privateKey,
    );
    expect(() => mint(initial)).toThrow(RangeError);
  });

  it.each([
    null,
    { ...block, signature: "invalid" },
    { ...block, payload: { ...payload, custodianId: "changed" } },
  ])("refuses malformed or tampered block %j", (input) => {
    expect(() => mint(input)).toThrow(RangeError);
  });

  it("refuses an allocation outside the signed block", () => {
    expect(() => mint(block, "absent")).toThrow(RangeError);
  });

  it("refuses another custodian's key", () => {
    const wrongKey = otherKeys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    expect(() => mint(block, "allocation-42", event, wrongKey)).toThrow(RangeError);
  });

  it.each([
    null,
    {},
    { ...event, extra: true },
    { ...event, targetNodeId: event.sourceId },
    { ...event, reservedAt: "2026-02-30T09:00:00.000Z" },
    { ...event, operatorId: " " },
    { ...event, incidentEvidence: "x".repeat(257) },
  ])("refuses malformed reservation event %j", (input) => {
    expect(() => mint(block, "allocation-42", input)).toThrow(RangeError);
  });
});
