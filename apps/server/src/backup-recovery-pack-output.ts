import {
  insertRecoveryPack,
  nextRecoveryPackNumber,
  readCurrentMasterKey,
  readRecoveryPacks,
  readVenue,
  requireStamp,
  withNodeTransaction,
  withTransaction,
  type Database,
  type RecoveryPackRecord,
  type Transaction,
} from "@waitron/db";
import type { WaitronModule } from "@waitron/module";
import { setRecoveryKeyTx, type VenueAndNodeHandles } from "@waitron/node-db";
import type { MadeMasterKey } from "@waitron/provisioning";
import {
  renderRecoveryPack,
  type PackLocale,
  type RecoveryPackFile,
  type RenderPackInput,
} from "@waitron/recovery-pack";
import { isAppError, type NodeId } from "@waitron/shared";
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

/** What a pack's attached file says of the master key. */
export type PackMasterKey = Pick<
  RecoveryPackFile,
  "masterKey" | "masterKeyName" | "masterKeyHeldBy"
>;

/** A pack that shows a master key made with it. */
export function shownMasterKey(made: MadeMasterKey): PackMasterKey {
  return { masterKey: made.masterKey, masterKeyName: made.masterKeyName, masterKeyHeldBy: null };
}

/**
 * A pack that does not show the master key names the current one, and this box's pack that showed
 * it: the one made at the same instant, since every site that makes a key saves it with its pack's
 * `madeAt`.
 */
export async function currentMasterKeyElsewhere(
  tx: Transaction,
  nodeId: string,
): Promise<PackMasterKey> {
  const current = await readCurrentMasterKey(tx);
  if (current === null) return { masterKey: null, masterKeyName: null, masterKeyHeldBy: null };
  const at = current.madeAt.getTime();
  const holder = (await readRecoveryPacks(tx, nodeId)).find((r) => r.madeAt.getTime() === at);
  return { masterKey: null, masterKeyName: current.name, masterKeyHeldBy: holder?.number ?? null };
}

export async function drawRecoveryPack(
  input: Omit<RenderPackInput, "parts" | "file">,
  details: { nodeId: string; madeBy: string | null; parts: BuiltPart[]; masterKey: PackMasterKey },
): Promise<{ pdf: Uint8Array<ArrayBuffer>; record: Omit<RecoveryPackRecord, "receivedAt"> }> {
  const { number, madeAt } = input.pack;
  const { nodeId, madeBy, parts } = details;
  const pdf = await renderRecoveryPack({
    ...input,
    parts: parts.map((part) => part.part),
    file: {
      kind: "waitron-recovery-pack",
      version: 2,
      number,
      madeAt,
      bucketCode: null,
      archiveCode: null,
      backupKey: null,
      serverKey: null,
      serverKeyName: null,
      serverKeyHeldBy: null,
      ...details.masterKey,
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
  shown: { made: MadeMasterKey; madeAt: string },
): Promise<{ secret: string; name: string; recoveryPackPdf?: string }> {
  await requireStamp(handles.venue);
  const { secret, verifier } = await makeBreakGlassSecret();
  const seat = await serverKeySeat([module], readEvidence);
  return withNodeTransaction(handles.node, async (nodeTx) => {
    const name = await chooseBreakGlassKeyName(handles.venue, nodeTx, nodeId);
    const recoveryPackPdf = await withTransaction(handles.venue, async (tx) => {
      const { name: venueName, timeZone } = await readVenue(tx);
      const number = await nextRecoveryPackNumber(tx, nodeId);
      const { madeAt } = shown;
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
        if (serverKey.record.carriedKey !== true || serverKey.file.serverKey == null) {
          log("warn", "setup.recovery_pack_drawing_failed", {
            reason: serverKey.failedWith ?? "server_key_missing",
          });
          return undefined;
        }
        output = await drawRecoveryPack(
          {
            locale,
            timeZone,
            loadFonts: loadRecoveryPackFonts,
            pack: { venueName, madeAt, number },
          },
          {
            nodeId,
            madeBy: null,
            parts: [notSetUp("bucket"), notSetUp("archives"), serverKey],
            masterKey: shownMasterKey(shown.made),
          },
        );
      } catch (error) {
        log("warn", "setup.recovery_pack_drawing_failed", {
          reason: isAppError(error) ? error.code : "unexpected",
        });
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

/**
 * The pack a setup with no box key to print ends with: the master key's page alone. A drawing
 * failure is logged and answers no pack; the key is still shown on the screen.
 */
export async function makeMasterKeyRecoveryPack(
  db: Database,
  nodeId: string,
  locale: PackLocale,
  log: Logger,
  shown: { made: MadeMasterKey; madeAt: string },
): Promise<string | undefined> {
  return withTransaction(db, async (tx) => {
    const { name: venueName, timeZone } = await readVenue(tx);
    const number = await nextRecoveryPackNumber(tx, nodeId);
    const { madeAt } = shown;
    let output: Awaited<ReturnType<typeof drawRecoveryPack>>;
    try {
      output = await drawRecoveryPack(
        { locale, timeZone, loadFonts: loadRecoveryPackFonts, pack: { venueName, madeAt, number } },
        {
          nodeId,
          madeBy: null,
          parts: [notSetUp("bucket"), notSetUp("archives")],
          masterKey: shownMasterKey(shown.made),
        },
      );
    } catch (error) {
      log("warn", "setup.recovery_pack_drawing_failed", {
        reason: isAppError(error) ? error.code : "unexpected",
      });
      return undefined;
    }
    await insertRecoveryPack(tx, output.record);
    return Buffer.from(output.pdf).toString("base64");
  });
}
