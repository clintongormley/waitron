import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as evidence from "./paper-evidence.js";

const custodian = generateKeyPairSync("ed25519");
const impostor = generateKeyPairSync("ed25519");
const publicKey = custodian.publicKey.export({ type: "spki", format: "pem" }).toString();
const fingerprint = createHash("sha256")
  .update(custodian.publicKey.export({ type: "spki", format: "der" }))
  .digest("hex");
const allocation = {
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
const block = {
  version: 1,
  custodianId: "paper-custodian",
  generationId: "generation-2",
  blockId: "block-7",
  packVersion: 1,
  recipientVenueId: "venue-madrid",
  allocations: [allocation],
};
const blockBytes = Buffer.from(
  JSON.stringify([
    "waitron.paper-block",
    1,
    "paper-custodian",
    "generation-2",
    "block-7",
    1,
    "venue-madrid",
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
          ["R-P000042", "rectificative"],
        ],
        "paper",
        "2026-10-12T08:00:00.000Z",
      ],
    ],
  ]),
);
const blockDigest = createHash("sha256").update(blockBytes).digest("hex");
const consumption = {
  version: 1,
  custodianId: "paper-custodian",
  blockDigest,
  allocationId: "allocation-42",
  eventId: "recovery-9",
  operatorId: "administrator-3",
  sourceId: "backup-2026-10-01",
  targetNodeId: "replacement-node",
  incidentEvidence: "outside-register/event-9",
  consumedAt: "2026-10-12T09:00:00.000Z",
};
const consumptionBytes = Buffer.from(
  JSON.stringify([
    "waitron.paper-consumption",
    1,
    "paper-custodian",
    blockDigest,
    "allocation-42",
    "recovery-9",
    "administrator-3",
    "backup-2026-10-01",
    "replacement-node",
    "outside-register/event-9",
    "2026-10-12T09:00:00.000Z",
  ]),
);
const signedBlock = {
  payload: block,
  signature: sign(null, blockBytes, custodian.privateKey).toString("base64url"),
};
const signedConsumption = {
  payload: consumption,
  signature: sign(null, consumptionBytes, custodian.privateKey).toString("base64url"),
};
const trustedCustodian = { custodianId: "paper-custodian", publicKey, fingerprint };
const context = {
  allocationId: "allocation-42",
  taxpayerNif: "B12345678",
  softwareId: "WT",
  environment: "preproduction",
  recipientVenueId: "venue-madrid",
  generationId: "generation-2",
  blockId: "block-7",
  eventId: "recovery-9",
  operatorId: "administrator-3",
  sourceId: "backup-2026-10-01",
  targetNodeId: "replacement-node",
  incidentEvidence: "outside-register/event-9",
  currentRegisterConfirmed: true,
  consumptionConfirmed: true,
  requiredBases: [
    { code: "A", purpose: "standard" },
    { code: "R", purpose: "rectificative" },
  ],
};

function verify(
  input: unknown = { block: signedBlock, consumption: signedConsumption },
  trust: unknown = trustedCustodian,
  expected = context,
) {
  return evidence.verifyPaperEvidence(input, trust, expected);
}

describe("a paper allocation's independently trusted evidence", () => {
  it("accepts an independently signed block and consumption bound to the complete recovery", () => {
    expect(verify()).toEqual({ ok: true, allocation });
  });

  it("ignores object property order without changing the signed facts", () => {
    const reordered = Object.fromEntries(Object.entries(block).reverse());
    expect(
      verify({ block: { ...signedBlock, payload: reordered }, consumption: signedConsumption }),
    ).toEqual({ ok: true, allocation });
  });

  it("refuses a submitted signer's key instead of enrolling it from the evidence", () => {
    const forged = {
      block: {
        payload: block,
        signature: sign(null, blockBytes, impostor.privateKey).toString("base64url"),
      },
      consumption: {
        payload: consumption,
        signature: sign(null, consumptionBytes, impostor.privateKey).toString("base64url"),
      },
      publicKey: impostor.publicKey.export({ type: "spki", format: "pem" }).toString(),
    };
    expect(verify(forged)).toEqual({ ok: false, reason: "untrusted" });
  });

  it.each(["currentRegisterConfirmed", "consumptionConfirmed"])(
    "requires the outside fact %s even with valid signatures",
    (field) => {
      expect(verify(undefined, undefined, { ...context, [field]: false })).toEqual({
        ok: false,
        reason: "outside_confirmation_missing",
      });
    },
  );

  it.each([
    "allocationId",
    "taxpayerNif",
    "softwareId",
    "environment",
    "recipientVenueId",
    "generationId",
    "blockId",
    "eventId",
    "operatorId",
    "sourceId",
    "targetNodeId",
    "incidentEvidence",
  ])("refuses evidence for a different %s", (field) => {
    expect(verify(undefined, undefined, { ...context, [field]: "another" })).toEqual({
      ok: false,
      reason: "scope_mismatch",
    });
  });

  it("requires the complete configured series and purposes", () => {
    expect(
      verify(undefined, undefined, {
        ...context,
        requiredBases: [...context.requiredBases, { code: "FF", purpose: "full" }],
      }),
    ).toEqual({ ok: false, reason: "series_mismatch" });
  });

  it.each(["block", "consumption"])("rejects a changed %s signature", (part) => {
    const input: Record<string, unknown> = { block: signedBlock, consumption: signedConsumption };
    input[part] = {
      ...(part === "block" ? signedBlock : signedConsumption),
      signature: Buffer.alloc(64).toString("base64url"),
    };
    expect(verify(input)).toEqual({ ok: false, reason: "untrusted" });
  });

  it.each([undefined, null, 1, {}, [], { block: signedBlock }, { consumption: signedConsumption }])(
    "rejects malformed evidence %j",
    (input) => {
      expect(evidence.verifyPaperEvidence(input, trustedCustodian, context)).toEqual({
        ok: false,
        reason: "malformed",
      });
    },
  );

  it.each([
    undefined,
    null,
    {},
    { ...trustedCustodian, fingerprint: "0".repeat(64) },
    { ...trustedCustodian, custodianId: "another" },
  ])("refuses absent or inconsistent trust %j", (trust) => {
    expect(
      evidence.verifyPaperEvidence(
        { block: signedBlock, consumption: signedConsumption },
        trust,
        context,
      ),
    ).toEqual({ ok: false, reason: "untrusted" });
  });
});

const privateKey = custodian.privateKey.export({ type: "pkcs8", format: "pem" }).toString();

describe("the external paper custodian's signing and independent enrolment", () => {
  it("enrols only the public key matching the administrator's outside fingerprint", () => {
    expect(evidence.enrolPaperCustodian("paper-custodian", publicKey, fingerprint)).toEqual(
      trustedCustodian,
    );
    expect(evidence.enrolPaperCustodian("paper-custodian", publicKey, "0".repeat(64))).toBeNull();
  });

  it("publishes the same canonical fingerprint for a differently wrapped public key", () => {
    const der = custodian.publicKey.export({ type: "spki", format: "der" });
    const pem = `-----BEGIN PUBLIC KEY-----\n${der.toString("base64")}\n-----END PUBLIC KEY-----\n`;
    expect(evidence.paperCustodianFingerprint(pem)).toBe(fingerprint);
  });

  it.each([null, undefined, "", "not a key", privateKey])(
    "refuses unsuitable public key input %j",
    (key) => {
      expect(evidence.paperCustodianFingerprint(key)).toBeNull();
      expect(evidence.enrolPaperCustodian("paper-custodian", key, fingerprint)).toBeNull();
    },
  );

  it("refuses a different signing algorithm even with its correct fingerprint", () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = rsa.publicKey.export({ type: "spki", format: "pem" }).toString();
    const hash = createHash("sha256")
      .update(rsa.publicKey.export({ type: "spki", format: "der" }))
      .digest("hex");
    expect(evidence.enrolPaperCustodian("paper-custodian", pem, hash)).toBeNull();
  });

  it.each(["", " ", "custodian\n", "A".repeat(257)])(
    "refuses an unnamed or malformed custodian %j",
    (id) => {
      expect(evidence.enrolPaperCustodian(id, publicKey, fingerprint)).toBeNull();
    },
  );

  it("signs exactly the independently constructed block bytes", () => {
    expect(evidence.signPaperBlock(block, privateKey)).toEqual(signedBlock);
  });

  it("signs exactly the independently constructed consumption bytes", () => {
    expect(evidence.signPaperConsumption(consumption, privateKey)).toEqual(signedConsumption);
  });

  it("does not enrol an embedded private key after an otherwise valid public key", () => {
    expect(
      evidence.enrolPaperCustodian("paper-custodian", publicKey + privateKey, fingerprint),
    ).toBeNull();
  });

  it("returns immutable public allocation facts without retaining caller-owned references", () => {
    const input = structuredClone({ block: signedBlock, consumption: signedConsumption });
    const result = verify(input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected valid paper evidence");
    input.block.payload.allocations[0]!.series[0]!.code = "altered-after-check";
    expect(result.allocation).toEqual(allocation);
    expect(Reflect.set(result.allocation, "installationIdentity", "P000043")).toBe(false);
    expect(Reflect.set(result.allocation.series[0]!, "code", "altered-result")).toBe(false);
    expect(
      Reflect.set(result.allocation.series, "0", { code: "altered-result", purpose: "standard" }),
    ).toBe(false);
  });
});

describe("paper evidence payload qualification", () => {
  it.each(
    [
      null,
      undefined,
      [],
      {},
      { ...block, version: 2 },
      { ...block, packVersion: 2 },
      { ...block, custodianId: "" },
      { ...block, generationId: "\u0085" },
      { ...block, blockId: "A".repeat(257) },
      { ...block, recipientVenueId: " venue" },
      { ...block, allocations: [] },
      { ...block, allocations: "not a list" },
      { ...block, allocations: new Array(1001).fill(allocation) },
      { ...block, allocations: [null] },
      { ...block, allocations: [allocation, allocation] },
      { ...block, allocations: [allocation, { ...allocation, allocationId: "other" }] },
      { ...block, extra: "unexpected" },
    ].map((payload, index) => ({ payload, index })),
  )("does not sign malformed block case $index", ({ payload }) => {
    expect(() => evidence.signPaperBlock(payload, privateKey)).toThrow(RangeError);
    expect(verify({ block: { ...signedBlock, payload }, consumption: signedConsumption })).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it.each(
    [
      { ...allocation, version: 2 },
      { ...allocation, allocationId: "" },
      { ...allocation, taxpayerNif: "B1234567" },
      { ...allocation, softwareId: "wt" },
      { ...allocation, environment: "dev" },
      { ...allocation, installationIdentity: "P000000" },
      { ...allocation, source: "cloud" },
      { ...allocation, source: "initial-paper" },
      { ...allocation, issuedAt: "2026-02-30T08:00:00.000Z" },
      { ...allocation, issuedAt: "not a date" },
      { ...allocation, issuedAt: "2026-10-12T08:00:00Z" },
      { ...allocation, series: null },
      { ...allocation, series: [] },
      { ...allocation, series: [null] },
      { ...allocation, series: [{ code: 1, purpose: "standard" }] },
      { ...allocation, series: [{ code: "A-P000042", purpose: "other" }] },
      { ...allocation, series: [{ code: "R-P000042", purpose: "rectificative" }] },
      { ...allocation, series: [{ code: "A-P000043", purpose: "standard" }] },
      { ...allocation, series: [allocation.series[0], allocation.series[0]] },
      { ...allocation, recoveryKey: "never belongs in evidence" },
    ].map((value, index) => ({ value, index })),
  )("does not sign malformed allocation case $index", ({ value }) => {
    expect(() => evidence.signPaperBlock({ ...block, allocations: [value] }, privateKey)).toThrow(
      RangeError,
    );
  });

  it.each(["taxpayerNif", "softwareId", "environment"])(
    "does not sign a block mixing %s scopes",
    (field) => {
      const second = {
        ...allocation,
        allocationId: "allocation-43",
        installationIdentity: "P000043",
        series: [{ code: "A-P000043", purpose: "standard" }],
        [field]:
          field === "environment" ? "production" : field === "softwareId" ? "WX" : "B87654321",
      };
      expect(() =>
        evidence.signPaperBlock({ ...block, allocations: [allocation, second] }, privateKey),
      ).toThrow(RangeError);
    },
  );

  it.each(
    [
      null,
      [],
      {},
      { ...consumption, version: 2 },
      { ...consumption, blockDigest: "0".repeat(63) },
      { ...consumption, consumedAt: "2026-13-12T09:00:00.000Z" },
      { ...consumption, operatorId: "" },
      { ...consumption, recoveryKey: "never belongs in evidence" },
    ].map((payload, index) => ({ payload, index })),
  )("does not sign malformed consumption case $index", ({ payload }) => {
    expect(() => evidence.signPaperConsumption(payload, privateKey)).toThrow(RangeError);
    expect(verify({ block: signedBlock, consumption: { ...signedConsumption, payload } })).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("does not pair a genuine consumption with another signed block", () => {
    const other = evidence.signPaperBlock({ ...block, generationId: "generation-3" }, privateKey);
    expect(
      verify({ block: other, consumption: signedConsumption }, undefined, {
        ...context,
        generationId: "generation-3",
      }),
    ).toEqual({ ok: false, reason: "scope_mismatch" });
  });

  it("does not pair another genuinely signed allocation's consumption", () => {
    const other = evidence.signPaperConsumption(
      { ...consumption, allocationId: "allocation-43" },
      privateKey,
    );
    expect(verify({ block: signedBlock, consumption: other })).toEqual({
      ok: false,
      reason: "scope_mismatch",
    });
  });

  it("supports the separate initial-paper namespace for first setup", () => {
    const initial = {
      ...allocation,
      installationIdentity: "S000001",
      source: "initial-paper",
      series: [{ code: "A-S000001", purpose: "standard" }],
    };
    const initialBlock = evidence.signPaperBlock({ ...block, allocations: [initial] }, privateKey);
    const event = {
      eventId: "recovery-9",
      operatorId: "administrator-3",
      sourceId: "backup-2026-10-01",
      targetNodeId: "replacement-node",
      incidentEvidence: "outside-register/event-9",
      consumedAt: "2026-10-12T09:00:00.000Z",
    };
    const receipt = evidence.signPaperConsumptionForBlock(
      initialBlock,
      "allocation-42",
      event,
      privateKey,
    );
    expect(
      verify({ block: initialBlock, consumption: receipt }, undefined, {
        ...context,
        requiredBases: [{ code: "A", purpose: "standard" }],
      }),
    ).toEqual({ ok: true, allocation: initial });
  });

  it.each([
    "",
    "A".repeat(85),
    "A".repeat(87),
    signedBlock.signature + "=",
    signedBlock.signature.slice(0, -1) + "B",
  ])("refuses malformed or noncanonical signature %j", (signature) => {
    expect(
      verify({ block: { ...signedBlock, signature }, consumption: signedConsumption }),
    ).toEqual({ ok: false, reason: "malformed" });
  });

  it("signs no consumption for a block from a different key", () => {
    const forged = {
      payload: block,
      signature: sign(null, blockBytes, impostor.privateKey).toString("base64url"),
    };
    expect(() =>
      evidence.signPaperConsumptionForBlock(forged, "allocation-42", {}, privateKey),
    ).toThrow(RangeError);
  });

  it("signs no consumption for an allocation outside the block", () => {
    expect(() =>
      evidence.signPaperConsumptionForBlock(signedBlock, "allocation-43", {}, privateKey),
    ).toThrow(RangeError);
  });

  it.each([null, {}, [], { eventId: "recovery-9", blockDigest }])(
    "signs no malformed or digest-substituting event %j",
    (event) => {
      expect(() =>
        evidence.signPaperConsumptionForBlock(signedBlock, "allocation-42", event, privateKey),
      ).toThrow(RangeError);
    },
  );

  it("refuses an RSA private key for either signature", () => {
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const key = rsa.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    expect(() => evidence.signPaperBlock(block, key)).toThrow(RangeError);
    expect(() => evidence.signPaperConsumption(consumption, key)).toThrow(RangeError);
  });

  it("refuses a public-key envelope whose bytes cannot be parsed", () => {
    const invalid = "-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----\n";
    expect(evidence.paperCustodianFingerprint(invalid)).toBeNull();
    expect(evidence.enrolPaperCustodian("paper-custodian", invalid, fingerprint)).toBeNull();
  });

  it("refuses an overlong public-key envelope", () => {
    expect(
      evidence.paperCustodianFingerprint(
        "-----BEGIN PUBLIC KEY-----\n" + "A".repeat(1024) + "\n-----END PUBLIC KEY-----\n",
      ),
    ).toBeNull();
  });
});

it("does not retain hidden trailing private material inside a public-key encoding", () => {
  const publicDer = custodian.publicKey.export({ type: "spki", format: "der" });
  const privateDer = custodian.privateKey.export({ type: "pkcs8", format: "der" });
  const combined = Buffer.concat([publicDer, privateDer]).toString("base64");
  const input = `-----BEGIN PUBLIC KEY-----\n${combined}\n-----END PUBLIC KEY-----\n`;
  expect(evidence.enrolPaperCustodian("paper-custodian", input, fingerprint)).toBeNull();
});

it("enrols the same public key without a trailing newline", () => {
  expect(evidence.enrolPaperCustodian("paper-custodian", publicKey.trimEnd(), fingerprint)).toEqual(
    {
      custodianId: "paper-custodian",
      publicKey: publicKey.trimEnd(),
      fingerprint,
    },
  );
});
