import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  paperBlockBytes,
  paperConsumptionBytes,
  type PaperBlock,
  type PaperConsumption,
} from "./paper-protocol.js";
import { signPaperBlock, signPaperConsumptionForBlock } from "./paper-evidence.js";

const keys = generateKeyPairSync("ed25519");
const privatePem = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const block: PaperBlock = {
  version: 1,
  custodianId: "María",
  generationId: "g1",
  blockId: "b1",
  packVersion: 1,
  recipientVenueId: "Olivo — Madrid",
  allocations: [
    {
      version: 1,
      allocationId: "a1",
      taxpayerNif: "89890001K",
      softwareId: "W1",
      environment: "production",
      installationIdentity: "S000001",
      series: [{ code: "A-S000001", purpose: "standard" }],
      source: "initial-paper",
      issuedAt: "2026-10-15T08:00:00.000Z",
    },
  ],
};
const blockText =
  '["waitron.paper-block",1,"María","g1","b1",1,"Olivo — Madrid",[[1,"a1","89890001K","W1","production","S000001",[["A-S000001","standard"]],"initial-paper","2026-10-15T08:00:00.000Z"]]]';

describe("public paper protocol bytes", () => {
  it("keeps literal v1 UTF-8 arrays and Node signing in both directions", () => {
    const bytes = paperBlockBytes(block);
    expect(bytes).toEqual(new TextEncoder().encode(blockText));
    const signed = signPaperBlock(block, privatePem);
    expect(verify(null, bytes, keys.publicKey, Buffer.from(signed.signature, "base64url"))).toBe(
      true,
    );
    expect(sign(null, bytes, keys.privateKey).toString("base64url")).toBe(signed.signature);
  });
  it("ignores object property order while retaining series order", () => {
    const reordered = Object.fromEntries(Object.entries(block).reverse()) as unknown as PaperBlock;
    expect(paperBlockBytes(reordered)).toEqual(new TextEncoder().encode(blockText));
  });
  it("normalizes a recovery operator's property order to the existing Node bytes", () => {
    const value: PaperConsumption = {
      version: 1,
      custodianId: "María",
      blockDigest: "a".repeat(64),
      allocationId: "a1",
      eventId: "event1",
      operatorId: { eventId: "event1", nodeId: "node1", kind: "recovery-key" },
      sourceId: "source1",
      targetNodeId: "node1",
      incidentEvidence: "master/event1",
      consumedAt: "2026-10-15T08:01:00.000Z",
    };
    const expected = JSON.stringify([
      "waitron.paper-consumption",
      1,
      "María",
      "a".repeat(64),
      "a1",
      "event1",
      { kind: "recovery-key", nodeId: "node1", eventId: "event1" },
      "source1",
      "node1",
      "master/event1",
      "2026-10-15T08:01:00.000Z",
    ]);
    expect(paperConsumptionBytes(value)).toEqual(new TextEncoder().encode(expected));
  });
  it.each(["Elena", { kind: "recovery-key" as const, nodeId: "node1", eventId: "event1" }])(
    "preserves the existing consumption operator encoding %j",
    (operatorId) => {
      const signed = signPaperBlock(block, privatePem);
      const consumption = signPaperConsumptionForBlock(
        signed,
        "a1",
        {
          eventId: "event1",
          operatorId,
          sourceId: "source1",
          targetNodeId: "node1",
          incidentEvidence: "Cuaderno público",
          consumedAt: "2026-10-15T08:01:00.000Z",
        },
        privatePem,
      );
      const digest = createHash("sha256").update(blockText).digest("hex");
      const literal = JSON.stringify([
        "waitron.paper-consumption",
        1,
        "María",
        digest,
        "a1",
        "event1",
        operatorId,
        "source1",
        "node1",
        "Cuaderno público",
        "2026-10-15T08:01:00.000Z",
      ]);
      const bytes = paperConsumptionBytes(consumption.payload);
      expect(bytes).toEqual(new TextEncoder().encode(literal));
      expect(
        verify(null, bytes, keys.publicKey, Buffer.from(consumption.signature, "base64url")),
      ).toBe(true);
      expect(sign(null, bytes, keys.privateKey).toString("base64url")).toBe(consumption.signature);
    },
  );
});
