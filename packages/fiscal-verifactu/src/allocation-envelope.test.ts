import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as fiscal from "./index.js";
import {
  enrolPaperCustodian,
  paperCustodianFingerprint,
  signPaperBlock,
  signPaperConsumptionForBlock,
} from "./paper-evidence.js";

const keys = generateKeyPairSync("ed25519");
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const trust = enrolPaperCustodian("custodian", publicKey, paperCustodianFingerprint(publicKey))!;
const candidate = {
  version: 1,
  allocationId: "allocation-42",
  taxpayerNif: "B12345678",
  softwareId: "WT",
  environment: "preproduction",
  installationIdentity: "P000042",
  series: [
    { code: "A-P000042", purpose: "standard" },
    { code: "R-P000042", purpose: "rectificative" },
  ],
  source: "paper",
  issuedAt: "2026-10-12T08:00:00.000Z",
};
const approval = {
  version: 1,
  eventId: "recovery-9",
  operatorId: "administrator",
  sourceId: "backup-1",
  targetNodeId: "replacement-node",
  oldMachineOffline: true,
  oldMachineAbsent: false,
  noParallelRecovery: true,
  confirmedAt: "2026-10-12T09:00:00.000Z",
  incidentEvidence: "master/recovery-9",
};
function signedEvidence(input = candidate) {
  const block = signPaperBlock(
    {
      version: 1,
      custodianId: "custodian",
      generationId: "generation-1",
      blockId: "block-1",
      packVersion: 1,
      recipientVenueId: "venue-1",
      allocations: [input],
    },
    privateKey,
  );
  const consumption = signPaperConsumptionForBlock(
    block,
    input.allocationId,
    {
      eventId: approval.eventId,
      operatorId: approval.operatorId,
      sourceId: approval.sourceId,
      targetNodeId: approval.targetNodeId,
      incidentEvidence: approval.incidentEvidence,
      consumedAt: approval.confirmedAt,
    },
    privateKey,
  );
  return { block, consumption };
}
const allocation = { ...candidate, reservationEvidence: signedEvidence() };
const context = {
  taxpayerNif: "B12345678",
  softwareId: "WT",
  environment: "preproduction",
  mode: "recovery",
  eventId: "recovery-9",
  operatorId: "administrator",
  sourceId: "backup-1",
  targetNodeId: "replacement-node",
  incidentEvidence: "master/recovery-9",
  requiredBases: [
    { code: "A", purpose: "standard" },
    { code: "R", purpose: "rectificative" },
  ],
  reauthentication: { operatorId: "administrator", eventId: "recovery-9" },
  priorActivation: "none",
  authority: {
    kind: "paper",
    trust,
    recipientVenueId: "venue-1",
    generationId: "generation-1",
    blockId: "block-1",
    currentRegisterConfirmed: true,
    consumptionConfirmed: true,
    currentEntryState: "consumed-for-event",
  },
};

function validate(
  input: unknown = allocation,
  permission: unknown = approval,
  expected: unknown = context,
): unknown {
  const api = fiscal as unknown as {
    validateAllocationEnvelope?: (a: unknown, p: unknown, c: unknown) => unknown;
  };
  expect(api.validateAllocationEnvelope).toBeTypeOf("function");
  return api.validateAllocationEnvelope!(input, permission, expected);
}

describe("an allocation and its independently authorised recovery", () => {
  it("returns the exact immutable allocation and approval after signed paper consumption", () => {
    const result = validate() as {
      ok: boolean;
      allocation: typeof allocation;
      approval: typeof approval;
    };
    expect(result).toEqual({ ok: true, allocation, approval });
    expect(Object.isFrozen(result.allocation)).toBe(true);
    expect(Object.isFrozen(result.allocation.series[0])).toBe(true);
    expect(Object.isFrozen(result.allocation.reservationEvidence.block.payload)).toBe(true);
    expect(Object.isFrozen(result.approval)).toBe(true);
    const input = structuredClone(allocation);
    const snapshot = validate(input) as typeof result;
    expect(Reflect.set(input.series[0]!, "code", "tampered")).toBe(true);
    expect(snapshot.allocation.series[0]!.code).toBe("A-P000042");
  });

  it.each([
    ["taxpayerNif", "B87654321", "taxpayer_mismatch"],
    ["softwareId", "AB", "software_mismatch"],
    ["environment", "production", "environment_mismatch"],
    ["source", "initial-paper", "source_mismatch"],
    ["installationIdentity", "P000043", "reservation_mismatch"],
    ["allocationId", "another-allocation", "reservation_mismatch"],
    ["issuedAt", "2026-10-12T07:00:00.000Z", "reservation_mismatch"],
  ])("refuses a changed %s with a distinct cause", (field, value, reason) => {
    expect(validate({ ...allocation, [field]: value })).toEqual({ ok: false, reason });
  });

  it.each([
    null,
    {},
    [],
    { ...allocation, version: 2 },
    { ...allocation, installationIdentity: "P000000" },
    { ...allocation, issuedAt: "2026-02-30T08:00:00.000Z" },
    { ...allocation, privateKey },
    { ...allocation, series: [{ code: "A-P000042", purpose: "standard", secret: "hidden" }] },
  ])("refuses a malformed or secret-bearing allocation %#", (input) => {
    expect(validate(input)).toEqual({ ok: false, reason: "malformed_allocation" });
  });

  it.each(
    [
      [],
      allocation.series.slice(0, 1),
      [...allocation.series, allocation.series[0]],
      [{ code: "A-P000042", purpose: "rectificative" }, allocation.series[1]],
    ].map((series) => [series]),
  )("refuses an incomplete, repeated or substituted purpose set %#", (series) => {
    expect(validate({ ...allocation, series })).toEqual({ ok: false, reason: "series_mismatch" });
  });

  it.each(["eventId", "sourceId", "targetNodeId", "operatorId", "incidentEvidence"])(
    "binds approval %s to the independently expected event",
    (field) => {
      expect(validate(allocation, { ...approval, [field]: "another" })).toEqual({
        ok: false,
        reason: "event_mismatch",
      });
    },
  );
  it.each([
    null,
    {},
    { ...approval, version: 2 },
    { ...approval, confirmedAt: "yesterday" },
    { ...approval, oldMachineOffline: "true" },
    { ...approval, privateKey },
  ])("refuses malformed approval %#", (permission) => {
    expect(validate(allocation, permission)).toEqual({ ok: false, reason: "malformed_approval" });
  });
  it("refuses an active former machine", () => {
    expect(validate(allocation, { ...approval, oldMachineOffline: false })).toEqual({
      ok: false,
      reason: "old_machine_active",
    });
  });
  it("refuses a parallel recovery", () => {
    expect(validate(allocation, { ...approval, noParallelRecovery: false })).toEqual({
      ok: false,
      reason: "parallel_recovery",
    });
  });
  it.each([
    null,
    { operatorId: "another", eventId: approval.eventId },
    { operatorId: approval.operatorId, eventId: "old-event" },
  ])("requires host reauthentication for this operator and event %#", (reauthentication) => {
    expect(validate(allocation, approval, { ...context, reauthentication })).toEqual({
      ok: false,
      reason: "reauthentication_required",
    });
  });
  it("refuses uncertainty about a previous local activation", () => {
    expect(validate(allocation, approval, { ...context, priorActivation: "uncertain" })).toEqual({
      ok: false,
      reason: "uncertain_prior_activation",
    });
  });
  it("does not mistake a locally committed activation for permission to activate again", () => {
    expect(validate(allocation, approval, { ...context, priorActivation: "committed" })).toEqual({
      ok: false,
      reason: "prior_activation_requires_replay",
    });
  });
  it.each(["currentRegisterConfirmed", "consumptionConfirmed"])("requires outside %s", (field) => {
    expect(
      validate(allocation, approval, {
        ...context,
        authority: { ...context.authority, [field]: false },
      }),
    ).toEqual({ ok: false, reason: "outside_confirmation_missing" });
  });
  it("refuses an unenrolled custodian", () => {
    expect(
      validate(allocation, approval, {
        ...context,
        authority: { ...context.authority, trust: null },
      }),
    ).toEqual({ ok: false, reason: "reservation_untrusted" });
  });
  it.each([
    ["reserved", "reservation_not_consumed"],
    ["consumed-elsewhere", "allocation_consumed"],
    ["retired", "allocation_retired"],
    ["abandoned", "reservation_abandoned"],
  ])(
    "refuses current outside entry state %s despite an earlier signed receipt",
    (currentEntryState, reason) => {
      expect(
        validate(allocation, approval, {
          ...context,
          authority: { ...context.authority, currentEntryState },
        }),
      ).toEqual({ ok: false, reason });
    },
  );
  it("requires a current outside entry state instead of relying only on the signed receipt", () => {
    expect(
      validate(allocation, approval, {
        ...context,
        authority: { ...context.authority, currentEntryState: undefined },
      }),
    ).toEqual({ ok: false, reason: "outside_confirmation_missing" });
  });
  it("refuses paper evidence signed for another backup even when the approval matches", () => {
    const input = structuredClone(allocation);
    input.reservationEvidence.consumption = {
      ...input.reservationEvidence.consumption,
      payload: { ...input.reservationEvidence.consumption.payload, sourceId: "another-backup" },
    };
    expect(validate(input)).toEqual({ ok: false, reason: "reservation_untrusted" });
  });
  it.each([
    null,
    { block: allocation.reservationEvidence.block },
    { ...allocation.reservationEvidence, privateKey },
  ])("refuses missing or extended reservation evidence %#", (reservationEvidence) => {
    expect(validate({ ...allocation, reservationEvidence })).toEqual({
      ok: false,
      reason: "reservation_missing",
    });
  });
  it("accepts initial setup only with an explicit absence of a former machine", () => {
    const initial = {
      ...candidate,
      source: "initial-paper",
      installationIdentity: "S000042",
      series: [
        { code: "A-S000042", purpose: "standard" },
        { code: "R-S000042", purpose: "rectificative" },
      ],
    };
    const input = { ...initial, reservationEvidence: signedEvidence(initial) };
    const expected = { ...context, mode: "initial-setup" };
    expect(
      validate(input, { ...approval, oldMachineAbsent: true, oldMachineOffline: false }, expected),
    ).toEqual({
      ok: true,
      allocation: input,
      approval: { ...approval, oldMachineAbsent: true, oldMachineOffline: false },
    });
    expect(validate(input, approval, expected)).toEqual({
      ok: false,
      reason: "old_machine_absence_unconfirmed",
    });
  });
  it("does not treat a recovery as an initial setup with no former seller", () => {
    expect(validate(allocation, { ...approval, oldMachineAbsent: true })).toEqual({
      ok: false,
      reason: "old_machine_absence_unconfirmed",
    });
  });
  it("rejects a cloud-looking allocation without a trusted registry adapter", () => {
    expect(
      validate(
        {
          ...allocation,
          source: "cloud",
          installationIdentity: "C000042",
          series: [
            { code: "A-C000042", purpose: "standard" },
            { code: "R-C000042", purpose: "rectificative" },
          ],
        },
        approval,
        { ...context, authority: { kind: "cloud" } },
      ),
    ).toEqual({ ok: false, reason: "reservation_untrusted" });
  });
});

describe("emergency allocation authority", () => {
  function emergency() {
    const api = fiscal as unknown as {
      drawEmergencyIdentity?: () => { identity: string; checksum: string };
    };
    expect(api.drawEmergencyIdentity).toBeTypeOf("function");
    const draw = api.drawEmergencyIdentity!();
    const input = {
      ...candidate,
      source: "emergency",
      installationIdentity: draw.identity,
      series: [
        { code: `A-${draw.identity}`, purpose: "standard" },
        { code: `R-${draw.identity}`, purpose: "rectificative" },
      ],
      reservationEvidence: { checksum: draw.checksum },
    };
    const expected = {
      ...context,
      authority: {
        kind: "emergency",
        draw,
        knownIdentities: [] as string[],
        incidentRecorded: true,
        uncertaintyRecorded: false,
      },
    };
    return { input, expected, draw };
  }

  it("accepts a fresh generator draw with a separate checksum and outside incident", () => {
    const { input, expected, draw } = emergency();
    expect(draw.identity).toMatch(/^E[0-7][0123456789ABCDEFGHJKMNPQRSTVWXYZ]{25}$/);
    expect(draw.checksum).toMatch(/^[0-9A-F]{4}$/);
    expect(validate(input, approval, expected)).toEqual({ ok: true, allocation: input, approval });
  });
  it("keeps the checksum out of the installation and series identities", () => {
    const { input, expected, draw } = emergency();
    expect(input.installationIdentity).toHaveLength(27);
    expect(input.series[0]!.code).toBe(`A-${draw.identity}`);
    expect(
      validate({ ...input, reservationEvidence: { checksum: "ZZZZ" } }, approval, expected),
    ).toEqual({ ok: false, reason: "checksum_invalid" });
  });
  it("refuses a mismatched but well-formed checksum", () => {
    const { input, expected, draw } = emergency();
    const checksum = draw.checksum === "0000" ? "0001" : "0000";
    expect(validate({ ...input, reservationEvidence: { checksum } }, approval, expected)).toEqual({
      ok: false,
      reason: "checksum_invalid",
    });
  });
  it("does not accept a caller's copy as a cryptographic draw", () => {
    const { input, expected, draw } = emergency();
    expect(
      validate(input, approval, {
        ...expected,
        authority: { ...expected.authority, draw: { ...draw } },
      }),
    ).toEqual({ ok: false, reason: "emergency_draw_untrusted" });
  });
  it("binds the candidate to the independently generated draw", () => {
    const first = emergency();
    const second = emergency();
    expect(first.draw.identity).not.toBe(second.draw.identity);
    expect(validate(first.input, approval, second.expected)).toEqual({
      ok: false,
      reason: "emergency_draw_untrusted",
    });
  });
  it("refuses a name found in current outside history", () => {
    const { input, expected, draw } = emergency();
    expect(
      validate(input, approval, {
        ...expected,
        authority: { ...expected.authority, knownIdentities: [draw.identity] },
      }),
    ).toEqual({ ok: false, reason: "identity_known" });
  });
  it("requires the incident to be recorded outside the restored database", () => {
    const { input, expected } = emergency();
    expect(
      validate(input, approval, {
        ...expected,
        authority: { ...expected.authority, incidentRecorded: false },
      }),
    ).toEqual({ ok: false, reason: "outside_confirmation_missing" });
  });
  it("requires an explicit uncertainty record when outside history is unavailable", () => {
    const { input, expected } = emergency();
    const absent = { ...expected, authority: { ...expected.authority, knownIdentities: null } };
    expect(validate(input, approval, absent)).toEqual({
      ok: false,
      reason: "emergency_uncertainty_missing",
    });
    expect(
      validate(input, approval, {
        ...absent,
        authority: { ...absent.authority, uncertaintyRecorded: true },
      }),
    ).toEqual({ ok: true, allocation: input, approval });
  });
  it("does not use the wall clock to decide whether an emergency identity is fresh", () => {
    const { input, expected } = emergency();
    const older = { ...input, issuedAt: "2020-01-01T00:00:00.000Z" };
    expect(
      validate(older, { ...approval, confirmedAt: "2020-01-01T00:00:00.000Z" }, expected),
    ).toEqual({
      ok: true,
      allocation: older,
      approval: { ...approval, confirmedAt: "2020-01-01T00:00:00.000Z" },
    });
  });
  it("refuses secret-bearing emergency evidence", () => {
    const { input, expected } = emergency();
    expect(
      validate(
        { ...input, reservationEvidence: { ...input.reservationEvidence, privateKey } },
        approval,
        expected,
      ),
    ).toEqual({ ok: false, reason: "reservation_missing" });
  });
});
