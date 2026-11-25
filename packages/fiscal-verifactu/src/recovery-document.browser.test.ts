import { describe, expect, it } from "vitest";
import {
  parseRecoveryDocument,
  parseRecoveryDocumentPublic,
  recoveryDocumentPublic,
  type RecoveryDocument,
} from "./recovery-document.js";

export function fixture(): RecoveryDocument {
  return {
    kind: "waitron-recovery-document",
    version: 1,
    scope: { taxpayerNif: "B12345674", softwareId: "W1", environment: "production" },
    taxpayerName: "Olivo Restauración SL",
    venueName: "Olivo Centro",
    createdAt: "2026-10-17T12:30:00.000Z",
    nodeKey: { nodeId: "node-1", name: "Caja principal" },
  };
}
describe("key-only recovery document", () => {
  it("parses a detached document", async () => {
    const input = fixture();
    const parsed = await parseRecoveryDocument(input);
    Object.assign(input.nodeKey, { name: "changed" });
    expect(parsed.nodeKey.name).toBe("Caja principal");
  });
  it("public projection has exact public keys and refuses a secret", () => {
    const input = fixture();
    const publicDoc = recoveryDocumentPublic(input);
    expect(publicDoc).toEqual({ ...input, nodeKey: { nodeId: "node-1", name: "Caja principal" } });
    expect(parseRecoveryDocumentPublic(publicDoc)).toEqual(publicDoc);
    expect(() =>
      parseRecoveryDocumentPublic({
        ...input,
        nodeKey: { ...input.nodeKey, secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345" },
      }),
    ).toThrow("Recovery PDF refused");
  });
  it.each([
    (d: RecoveryDocument) => Object.assign(d, { password: "forbidden" }),
    (d: RecoveryDocument) => Object.assign(d.scope, { secret: "forbidden" }),
    (d: RecoveryDocument) => Object.assign(d.nodeKey, { extra: "forbidden" }),
    (d: RecoveryDocument) => {
      Object.assign(d.nodeKey, { secret: "short" });
    },
    (d: RecoveryDocument) => {
      Object.assign(d.nodeKey, { name: "a\nlabel" });
    },
    (d: RecoveryDocument) => {
      Object.assign(d.nodeKey, { nodeId: " " });
    },
    (d: RecoveryDocument) => {
      d.taxpayerName = "x".repeat(257);
    },
    (d: RecoveryDocument) => {
      d.venueName = "";
    },
    (d: RecoveryDocument) => {
      d.createdAt = "2026-10-17T12:30:00Z";
    },
    (d: RecoveryDocument) => {
      d.createdAt = "2026-02-30T12:30:00.000Z";
    },
    (d: RecoveryDocument) => {
      Object.assign(d.scope, { taxpayerNif: "invalid" });
    },
    (d: RecoveryDocument) => {
      Object.assign(d.scope, { softwareId: "bad" });
    },
    (d: RecoveryDocument) => Object.assign(d.scope, { environment: "demo" }),
  ])("refuses malformed or extra data %#", async (change) => {
    const d = fixture();
    change(d);
    await expect(parseRecoveryDocument(d)).rejects.toThrow("Recovery PDF refused");
  });
});
