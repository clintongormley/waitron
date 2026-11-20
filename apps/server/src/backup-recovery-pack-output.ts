import {
  insertRecoveryPack,
  nextRecoveryPackNumber,
  readTaxpayer,
  readVenue,
  requireStamp,
  withNodeTransaction,
  withTransaction,
  type RecoveryPackRecord,
} from "@waitron/db";
import type { WaitronModule } from "@waitron/module";
import { setRecoveryKeyTx, type VenueAndNodeHandles } from "@waitron/node-db";
import { renderRecoveryPack, type PackLocale, type RenderPackInput } from "@waitron/recovery-pack";
import type { NodeId } from "@waitron/shared";
import {
  buildServerKeyPart,
  notSetUp,
  serverKeySeat,
  type BuiltPart,
} from "./backup-recovery-pack-parts.js";
import { chooseBreakGlassKeyName, makeBreakGlassSecret } from "./break-glass.js";
import { loadRecoveryPackFonts } from "./invoice-font.js";
import type { Logger } from "./logger.js";
import type { RecoveryDocumentEvidence } from "./recovery-document-evidence.js";

export async function drawRecoveryPack(
  input: Omit<RenderPackInput, "parts" | "file">,
  details: { nodeId: string; madeBy: string | null; parts: BuiltPart[] },
): Promise<{ pdf: Uint8Array<ArrayBuffer>; record: Omit<RecoveryPackRecord, "receivedAt"> }> {
  const { number, madeAt } = input.cover;
  const { nodeId, madeBy, parts } = details;
  const pdf = await renderRecoveryPack({
    ...input,
    parts: parts.map((part) => part.part),
    file: {
      kind: "waitron-recovery-pack",
      version: 1,
      number,
      madeAt,
      bucketCode: null,
      archiveCode: null,
      backupKey: null,
      serverKey: null,
      serverKeyName: null,
      serverKeyHeldBy: null,
      ...Object.assign({}, ...parts.map((part) => part.file)),
    },
  });
  return {
    pdf,
    record: { nodeId, number, madeAt: new Date(madeAt), madeBy, parts: parts.map((p) => p.record) },
  };
}

export async function makePreparationRecoveryPack(
  handles: VenueAndNodeHandles,
  nodeId: string,
  module: WaitronModule,
  locale: PackLocale,
  readEvidence: RecoveryDocumentEvidence,
  log: Logger,
): Promise<{ secret: string; name: string; recoveryPackPdf?: string }> {
  await requireStamp(handles.venue);
  const { secret, verifier } = await makeBreakGlassSecret();
  const seat = await serverKeySeat([module], readEvidence);
  return withNodeTransaction(handles.node, async (nodeTx) => {
    const name = await chooseBreakGlassKeyName(handles.venue, nodeTx, nodeId);
    const recoveryPackPdf = await withTransaction(handles.venue, async (tx) => {
      const taxpayer = await readTaxpayer(tx);
      if (taxpayer === null) throw new Error("the box has no taxpayer to name on a recovery pack");
      const { name: venueName, timeZone } = await readVenue(tx);
      const number = await nextRecoveryPackNumber(tx, nodeId);
      const madeAt = new Date().toISOString();
      let output: Awaited<ReturnType<typeof drawRecoveryPack>>;
      try {
        const serverKey = await buildServerKeyPart(
          tx,
          { locale, timeZone, madeAt, nodeId },
          {
            seat,
            node: { nodeId: nodeId as NodeId },
            keyInForce: {
              name,
              holder: { kind: "sheet", keyName: name, madeOn: name.slice(0, 10) },
            },
            newKey: { name, secret },
          },
        );
        if (serverKey.record.carriedKey !== true || serverKey.file.serverKey == null)
          return undefined;
        output = await drawRecoveryPack(
          {
            locale,
            timeZone,
            loadFonts: loadRecoveryPackFonts,
            cover: {
              legalName: taxpayer.legalName,
              taxId: taxpayer.taxId,
              venueName,
              madeAt,
              madeBy: null,
              number,
            },
          },
          { nodeId, madeBy: null, parts: [notSetUp("bucket"), notSetUp("archives"), serverKey] },
        );
      } catch {
        log("warn", "setup.recovery_pack_drawing_failed", {});
        return undefined;
      }
      await insertRecoveryPack(tx, output.record);
      return Buffer.from(output.pdf).toString("base64");
    });
    // The pack record commits first. A failed key save leaves no private reply, and retry mints
    // both a new key and a new pack number before publication.
    await setRecoveryKeyTx(nodeTx, nodeId, verifier, name, null);
    return { secret, name, ...(recoveryPackPdf === undefined ? {} : { recoveryPackPdf }) };
  });
}
