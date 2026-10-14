import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as paper from "./paper-evidence.js";

const keys = generateKeyPairSync("ed25519");
const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
const custodian = paper.enrolPaperCustodian(
  "master-custodian",
  publicKey,
  paper.paperCustodianFingerprint(publicKey),
)!;
const scope = {
  taxpayerNif: "89890001K",
  softwareId: "W1",
  environment: "preproduction",
  recipientVenueId: "venue-one",
  requiredBases: [
    { code: "A", purpose: "standard" },
    { code: "R", purpose: "rectificative" },
    { code: "FF", purpose: "full" },
  ],
};

function block() {
  return paper.signPaperBlock(
    {
      version: 1,
      custodianId: "master-custodian",
      generationId: "paper-generation-7",
      blockId: "paper-block-42",
      packVersion: 1,
      recipientVenueId: "venue-one",
      allocations: [
        {
          version: 1,
          allocationId: "reserved-42",
          taxpayerNif: "89890001K",
          softwareId: "W1",
          environment: "preproduction",
          installationIdentity: "P000042",
          series: [
            { code: "A-P000042", purpose: "standard" },
            { code: "R-P000042", purpose: "rectificative" },
            { code: "FF-P000042", purpose: "full" },
          ],
          source: "paper",
          issuedAt: "2026-10-14T08:00:00.000Z",
        },
      ],
    },
    privateKey,
  );
}

function verify(input: unknown, trust: unknown = custodian, context: unknown = scope) {
  return paper.verifyPaperBlockSnapshot(
    input,
    trust,
    context as Parameters<typeof paper.verifyPaperBlockSnapshot>[2],
  );
}

describe("paper pack's public allocation snapshot", () => {
  it("retains signed identities and public trust without granting consumption authority", () => {
    const signed = block();
    expect(verify(signed)).toEqual({ ok: true, block: signed, custodian });
    expect(JSON.stringify(verify(signed))).not.toContain(privateKey);
    expect(JSON.stringify(verify(signed))).not.toContain("consumptionConfirmed");
  });

  it.each([
    { taxpayerNif: "A58818501" },
    { softwareId: "W2" },
    { environment: "production" },
    { recipientVenueId: "venue-two" },
  ])("refuses a signed block belonging to a different scope: %j", (changed) => {
    expect(verify(block(), custodian, { ...scope, ...changed })).toEqual({
      ok: false,
      reason: "scope_mismatch",
    });
  });

  it("refuses a block missing the full invoice series the venue needs", () => {
    const signed = block();
    const allocation = signed.payload.allocations[0]!;
    const incomplete = paper.signPaperBlock(
      {
        ...signed.payload,
        allocations: [{ ...allocation, series: allocation.series.slice(0, 2) }],
      },
      privateKey,
    );
    expect(verify(incomplete)).toEqual({ ok: false, reason: "series_mismatch" });
  });

  it("refuses a changed identity with otherwise valid series names", () => {
    const signed = block();
    const changed = {
      ...signed,
      payload: {
        ...signed.payload,
        allocations: [
          {
            ...signed.payload.allocations[0]!,
            installationIdentity: "P000043",
            series: scope.requiredBases.map((base) => ({
              code: `${base.code}-P000043`,
              purpose: base.purpose,
            })),
          },
        ],
      },
    };
    expect(verify(changed)).toEqual({ ok: false, reason: "untrusted" });
  });

  it.each([null, {}, { payload: {}, signature: "bad" }])("refuses malformed input %j", (input) => {
    expect(verify(input)).toEqual({ ok: false, reason: "malformed" });
  });

  it("refuses hidden private material beside an otherwise valid public key", () => {
    expect(verify(block(), { ...custodian, privateKey })).toEqual({
      ok: false,
      reason: "untrusted",
    });
  });

  it("refuses hidden properties in a signed envelope rather than printing them", () => {
    expect(verify({ ...block(), privateKey })).toEqual({ ok: false, reason: "malformed" });
  });

  it("refuses a replaced custodian key", () => {
    const other = generateKeyPairSync("ed25519");
    const replacement = other.publicKey.export({ type: "spki", format: "pem" }).toString();
    const trust = paper.enrolPaperCustodian(
      "master-custodian",
      replacement,
      paper.paperCustodianFingerprint(replacement),
    );
    expect(verify(block(), trust)).toEqual({ ok: false, reason: "untrusted" });
  });
});
