import { expect, it } from "vitest";
import { parseRecoveryDocument, type RecoveryDocument } from "./recovery-document.js";

const sheet: RecoveryDocument = {
  kind: "waitron-recovery-document",
  version: 1,
  scope: { taxpayerNif: "B12345674", softwareId: "W1", environment: "production" },
  taxpayerName: "Olivo Restauración SL",
  venueName: "Olivo Centro",
  createdAt: "2026-10-17T12:30:00.000Z",
  nodeKey: { nodeId: "node-1", name: "Caja principal" },
};

it("accepts a sheet that carries the key and scope only", () => {
  expect(parseRecoveryDocument(sheet)).toEqual(sheet);
});

it("refuses a sheet that still carries installation codes", () => {
  expect(() => parseRecoveryDocument({ ...sheet, installationCodes: ["0CNNW"] })).toThrow(
    "Recovery PDF refused",
  );
});

it("a recovery document carries no box-key secret", () => {
  expect(() =>
    parseRecoveryDocument({
      ...sheet,
      nodeKey: { ...sheet.nodeKey, secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345" },
    }),
  ).toThrow("Recovery PDF refused");
  const parsed = parseRecoveryDocument(sheet);
  expect(parsed).toEqual(sheet);
  expect(parseRecoveryDocument(parsed)).toEqual(sheet);
});
