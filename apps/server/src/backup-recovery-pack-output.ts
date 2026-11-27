import {
  insertRecoveryPack,
  nextMasterKeyNumber,
  nextRecoveryPackNumber,
  readVenue,
  withTransaction,
  type Database,
  type MasterKeyRecord,
  type RecoveryPackRecord,
} from "@waitron/db";
import type { MadeMasterKey } from "@waitron/provisioning";
import { renderRecoveryPack, type PackLocale, type RenderPackInput } from "@waitron/recovery-pack";
import { isAppError } from "@waitron/shared";
import { notSetUp, type BuiltPart } from "./backup-recovery-pack-parts.js";
import { loadRecoveryPackFonts } from "./invoice-font.js";
import type { Logger } from "./logger.js";

/** The master key a pack shows, spelled as `encodeMasterKeyCode` spells it, and its row number. */
export type PackMasterKey = { masterKey: string; masterKeyName: string; number: number };

/**
 * The pack numbers among `packs` that showed the `current` master key, newest first: those whose
 * `master-key` entry names its row number and its name, and a pack written before packs had that entry when it
 * was made at the key's instant, since every site that made a key and a pack saved the key with its
 * pack's `madeAt`; when another such pack shares that instant neither is counted.
 */
export function masterKeyHolders(
  current: MasterKeyRecord,
  packs: readonly RecoveryPackRecord[],
): number[] {
  const entryOf = (pack: RecoveryPackRecord) => pack.parts.find((p) => p.part === "master-key");
  const shown = packs.filter((pack) => {
    const entry = entryOf(pack);
    return entry?.masterKeyNumber === current.number && entry.masterKeyName === current.name;
  });
  const at = current.madeAt.getTime();
  const atInstant = packs.filter(
    (pack) => entryOf(pack) === undefined && pack.madeAt.getTime() === at,
  );
  const holders = atInstant.length === 1 ? [...shown, atInstant[0]!] : shown;
  return holders.map((pack) => pack.number).sort((a, b) => b - a);
}

/**
 * `cloudAddress` is given only by packs that could print the Cloud QR code: `null` records that this
 * one did not.
 */
export async function drawRecoveryPack(
  input: Omit<RenderPackInput, "parts" | "file" | "cloudAddress">,
  details: {
    nodeId: string;
    madeBy: string | null;
    parts: BuiltPart[];
    masterKey: PackMasterKey;
    cloudAddress?: string | null;
  },
): Promise<{ pdf: Uint8Array<ArrayBuffer>; record: Omit<RecoveryPackRecord, "receivedAt"> }> {
  const { number, madeAt } = input.pack;
  const { nodeId, madeBy, parts, cloudAddress } = details;
  const pdf = await renderRecoveryPack({
    ...input,
    ...(typeof cloudAddress === "string" ? { cloudAddress } : {}),
    parts: parts.map((part) => part.part),
    file: {
      kind: "waitron-recovery-pack",
      version: 2,
      number,
      madeAt,
      bucketCode: null,
      masterKey: details.masterKey.masterKey,
      masterKeyName: details.masterKey.masterKeyName,
      masterKeyHeldBy: null,
      ...Object.assign({}, ...parts.map((part) => part.file)),
    },
  });
  return {
    pdf,
    record: {
      nodeId,
      number,
      madeAt: new Date(madeAt),
      madeBy,
      parts: [
        ...(cloudAddress === undefined
          ? []
          : [
              {
                part: "emergency" as const,
                state: cloudAddress === null ? ("absent" as const) : ("included" as const),
              },
            ]),
        ...parts.map((p) => p.record),
        {
          part: "master-key",
          state: "included",
          masterKeyNumber: details.masterKey.number,
          masterKeyName: details.masterKey.masterKeyName,
        },
      ],
    },
  };
}

/**
 * The pack the provision route ends with: the master key's page alone. A drawing
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
    // The setup route writes the key's row after this pack, in a later transaction, so it takes
    // this number.
    const masterKeyNumber = await nextMasterKeyNumber(tx);
    const { madeAt } = shown;
    let output: Awaited<ReturnType<typeof drawRecoveryPack>>;
    try {
      output = await drawRecoveryPack(
        { locale, timeZone, loadFonts: loadRecoveryPackFonts, pack: { venueName, madeAt, number } },
        {
          nodeId,
          madeBy: null,
          parts: [notSetUp("bucket")],
          masterKey: { ...shown.made, number: masterKeyNumber },
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
