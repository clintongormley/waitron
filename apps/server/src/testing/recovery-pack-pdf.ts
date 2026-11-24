import type { RecoveryPackFile } from "@waitron/recovery-pack/src/pack-file.js";
import { renderRecoveryPack } from "@waitron/recovery-pack/src/render-pack.js";
import { loadRecoveryPackFonts } from "../invoice-font.js";

/** A recovery pack PDF whose attached file carries `masterKey`, or, without it, names the pack
 * that holds it. */
export function recoveryPackPdf(
  masterKey: string | null,
  heldBy: number | null = null,
): Promise<Uint8Array<ArrayBuffer>> {
  const file: RecoveryPackFile = {
    kind: "waitron-recovery-pack",
    version: 2,
    number: 2,
    madeAt: "2026-11-23T12:00:00.000Z",
    bucketCode: null,
    archiveCode: null,
    backupKey: null,
    serverKey: null,
    serverKeyName: null,
    serverKeyHeldBy: null,
    masterKey,
    masterKeyName: "2026-11-23 · QZJV",
    masterKeyHeldBy: heldBy,
  };
  return renderRecoveryPack({
    locale: "en",
    timeZone: "UTC",
    loadFonts: loadRecoveryPackFonts,
    pack: { venueName: "Casa Pepe", madeAt: file.madeAt, number: 2 },
    parts: [],
    file,
  });
}
