import { describe, expect, it } from "vitest";
import { readRecoveryPackPdf } from "@waitron/recovery-pack";
import { createRecoveryDelivery } from "./recovery-delivery.js";
import { readRecoveryPdf } from "./recovery-reader.js";
import { recoveryDocumentBytes, type RecoveryDocument } from "./recovery-document.js";

const document: RecoveryDocument = {
  kind: "waitron-recovery-document",
  version: 1,
  scope: { taxpayerNif: "B12345674", softwareId: "W1", environment: "production" },
  taxpayerName: "Olivo Restauración SL",
  venueName: "Olivo Centro",
  createdAt: "2026-10-17T12:30:00.000Z",
  nodeKey: {
    nodeId: "node-1",
    name: "2026-10-17 · ACRY",
    secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345",
  },
};

async function digest(bytes: Uint8Array<ArrayBuffer>) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
}

describe("setup's delivery is recovery pack 1", () => {
  it.each(["en", "es"] as const)(
    "carries only the staged server key, as pack 1, in %s",
    async (locale) => {
      const session = createRecoveryDelivery(document, locale, async () => true, "Europe/Madrid");
      try {
        const bytes = new Uint8Array(await (await fetch(await session.download())).arrayBuffer());
        expect(await readRecoveryPackPdf(bytes)).toEqual({
          kind: "waitron-recovery-pack",
          version: 1,
          number: 1,
          madeAt: document.createdAt,
          bucketCode: null,
          archiveCode: null,
          backupKey: null,
          serverKey: JSON.parse(new TextDecoder().decode(recoveryDocumentBytes(document))),
          serverKeyName: "2026-10-17 · ACRY",
          serverKeyHeldBy: null,
        });
        expect((await readRecoveryPdf(bytes)).document).toEqual(document);
        expect((await session.ready()).documentDigest).toBe(await digest(bytes));
      } finally {
        session.dispose();
      }
    },
  );
});
