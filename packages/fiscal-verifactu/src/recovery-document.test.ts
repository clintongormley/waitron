import { expect, it } from "vitest";
import { parseRecoveryDocumentPublic, type RecoveryDocumentPublic } from "./recovery-document.js";

const sheet: RecoveryDocumentPublic = {
  kind: "waitron-recovery-document",
  version: 1,
  scope: { taxpayerNif: "B12345674", softwareId: "W1", environment: "production" },
  taxpayerName: "Olivo Restauración SL",
  venueName: "Olivo Centro",
  createdAt: "2026-10-17T12:30:00.000Z",
  nodeKey: { nodeId: "node-1", name: "Caja principal" },
};

it("accepts a sheet that carries the key and scope only", () => {
  expect(parseRecoveryDocumentPublic(sheet)).toEqual(sheet);
});

it("refuses a sheet that still carries installation codes", () => {
  expect(() => parseRecoveryDocumentPublic({ ...sheet, installationCodes: ["0CNNW"] })).toThrow(
    "Recovery PDF refused",
  );
});
