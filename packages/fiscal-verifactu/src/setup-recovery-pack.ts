import { renderRecoveryPack } from "@waitron/recovery-pack";
import { parseRecoveryDocument, type RecoveryDocument } from "./recovery-document.js";
import { serverKeyPage } from "./server-key-page.js";

/**
 * Pack 1, drawn during setup: the new master key and the staged server key, before any bucket copy
 * or archive exists.
 */
export async function renderSetupRecoveryPack(
  input: RecoveryDocument,
  made: { masterKey: string; masterKeyName: string },
  locale: "en" | "es",
  timeZone: string,
  loadFonts: () => Promise<{ regular: Uint8Array; mono: Uint8Array }>,
): Promise<Uint8Array<ArrayBuffer>> {
  const document = await parseRecoveryDocument(input);
  return renderRecoveryPack({
    locale,
    timeZone,
    loadFonts,
    pack: { venueName: document.venueName, madeAt: document.createdAt, number: 1 },
    parts: [
      { kind: "bucket", state: "not-set-up" },
      { kind: "archives", state: "not-set-up" },
      {
        kind: "server-key",
        state: "included",
        page: serverKeyPage(document, { locale, timeZone }),
        serverKeyLocation: { kind: "this-pack" },
      },
    ],
    file: {
      kind: "waitron-recovery-pack",
      version: 2,
      number: 1,
      madeAt: document.createdAt,
      bucketCode: null,
      archiveCode: null,
      backupKey: null,
      serverKey: document,
      serverKeyName: document.nodeKey.name,
      serverKeyHeldBy: null,
      masterKey: made.masterKey,
      masterKeyName: made.masterKeyName,
      masterKeyHeldBy: null,
    },
  });
}
