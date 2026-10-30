import { renderRecoveryPack } from "@waitron/recovery-pack";
import { parseRecoveryDocument, type RecoveryDocument } from "./recovery-document.js";
import { serverKeyPage } from "./server-key-page.js";

/** Pack 1, drawn during setup: the staged server key, before any bucket copy or archive exists. */
export async function renderSetupRecoveryPack(
  input: RecoveryDocument,
  locale: "en" | "es",
  timeZone: string,
  loadFont: () => Promise<Uint8Array>,
): Promise<Uint8Array<ArrayBuffer>> {
  const document = await parseRecoveryDocument(input);
  return renderRecoveryPack({
    locale,
    timeZone,
    loadFont,
    cover: {
      legalName: document.taxpayerName,
      taxId: document.scope.taxpayerNif,
      venueName: document.venueName,
      madeAt: document.createdAt,
      madeBy: null,
      number: 1,
    },
    parts: [
      { kind: "bucket", state: "not-set-up" },
      { kind: "archives", state: "not-set-up" },
      {
        kind: "server-key",
        state: "included",
        page: serverKeyPage(document, { locale, timeZone }),
        lastChanged: document.nodeKey.name.slice(0, 10),
        check: document.nodeKey.name,
        serverKeyLocation: { kind: "this-pack" },
      },
    ],
    file: {
      kind: "waitron-recovery-pack",
      version: 1,
      number: 1,
      madeAt: document.createdAt,
      bucketCode: null,
      archiveCode: null,
      backupKey: null,
      serverKey: document,
      serverKeyName: document.nodeKey.name,
      serverKeyHeldBy: null,
    },
  });
}
