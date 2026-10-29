import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import {
  buildRecoveryPackFile,
  renderRecoveryPack,
  type RecoveryPackFile,
} from "@waitron/recovery-pack";

const FONT = new URL("../src/assets/invoice-noto-sans.ttf", import.meta.url);

/** A recovery pack PDF drawn by the real renderer, carrying these codes in its attached file. */
export async function recoveryPackPdf(codes: {
  bucketCode: string | null;
  archiveCode: string | null;
}): Promise<Uint8Array<ArrayBuffer>> {
  const file: RecoveryPackFile = {
    kind: "waitron-recovery-pack",
    version: 1,
    number: 2,
    madeAt: "2026-10-29T17:00:00.000Z",
    ...codes,
    backupKey: null,
    serverKey: null,
    serverKeyName: null,
    serverKeyHeldBy: null,
  };
  buildRecoveryPackFile(file);
  const font = new Uint8Array(await readFile(FONT));
  return renderRecoveryPack({
    locale: "en",
    timeZone: "Europe/Madrid",
    loadFont: async () => font,
    cover: {
      legalName: "Waitron SL",
      taxId: "89890001K",
      venueName: "Local",
      madeAt: file.madeAt,
      madeBy: null,
      number: file.number,
    },
    parts: [],
    file,
  });
}

/**
 * The same PDF claiming another digest for its attached file. The renderer writes the digest as a
 * literal string, and a same-length value leaves every byte offset in the PDF true.
 */
export function withDigest(pdf: Uint8Array, digest: string): Uint8Array {
  const text = Buffer.from(pdf).toString("latin1");
  const changed = text.replace(/\(sha256-v1:[a-f0-9]{64}\)/, `(${digest})`);
  if (changed === text || changed.length !== text.length) throw new Error("no digest replaced");
  return new Uint8Array(Buffer.from(changed, "latin1"));
}

export const NOT_A_PACK =
  "restore failed: the PDF is not a Waitron recovery pack; give the venue's recovery pack PDF, or the kit or pack file saved for this venue";
export const PACK_DAMAGED =
  "restore failed: the recovery pack PDF is damaged, or was changed after it was made; use the pack PDF as it was saved";

/** A well-formed PDF with no attached file, such as any other document the owner keeps. */
export async function plainPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  return pdf.save();
}
