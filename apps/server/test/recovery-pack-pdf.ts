import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import PDFKit from "pdfkit";
import { encodeMasterKeyCode } from "@waitron/shared";
import {
  buildRecoveryPackFile,
  canonicalJson,
  PACK_ATTACHMENT,
  renderRecoveryPack,
  type RecoveryPackFile,
} from "@waitron/recovery-pack";

const FONT = new URL("../src/assets/invoice-noto-sans.ttf", import.meta.url);

/** A recovery pack PDF drawn by the real renderer, carrying these codes in its attached file. */
export async function recoveryPackPdf(codes: {
  bucketCode: string | null;
  masterKey?: string;
  masterKeyName?: string;
}): Promise<Uint8Array<ArrayBuffer>> {
  const file: RecoveryPackFile = {
    kind: "waitron-recovery-pack",
    version: 2,
    number: 2,
    madeAt: "2026-10-29T17:00:00.000Z",
    bucketCode: codes.bucketCode,
    masterKey: codes.masterKey ?? encodeMasterKeyCode(new Uint8Array(16).fill(1)),
    masterKeyName: codes.masterKeyName ?? "2026-10-29 · QZJV",
    masterKeyHeldBy: null,
  };
  buildRecoveryPackFile(file);
  const font = new Uint8Array(await readFile(FONT));
  return renderRecoveryPack({
    locale: "en",
    timeZone: "Europe/Madrid",
    loadFonts: async () => ({
      regular: font,
      mono: new Uint8Array(
        await readFile(new URL("../src/assets/invoice-noto-sans-mono.ttf", import.meta.url)),
      ),
    }),
    pack: { venueName: "Local", madeAt: file.madeAt, number: file.number },
    parts: [],
    file,
  });
}

const NO_MASTER_KEY: RecoveryPackFile = {
  kind: "waitron-recovery-pack",
  version: 2,
  number: 2,
  madeAt: "2026-10-29T17:00:00.000Z",
  bucketCode: null,
  masterKey: null,
  masterKeyName: null,
  masterKeyHeldBy: null,
};

/**
 * A pack PDF whose attached file holds no master key. The renderer refuses such a file, so this
 * carrier attaches it directly.
 */
export async function packPdfWithoutMasterKey(): Promise<Uint8Array<ArrayBuffer>> {
  return carrierPdf(buildRecoveryPackFile(NO_MASTER_KEY));
}

/**
 * The same pack file also carrying `archiveCode` and `backupKey`, both null, as the format required
 * of every pack file before A1323 PR 4b-2. It is written in canonical form and the PDF names its
 * true digest, so only its shape is wrong.
 */
export async function packPdfWithArchiveFields(): Promise<Uint8Array<ArrayBuffer>> {
  const fields = { ...NO_MASTER_KEY, archiveCode: null, backupKey: null };
  return carrierPdf(new TextEncoder().encode(canonicalJson(fields)));
}

async function carrierPdf(fileBytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(fileBytes)));
  const digest = "sha256-v1:" + Array.from(hash, (n) => n.toString(16).padStart(2, "0")).join("");
  const pdf = new PDFKit();
  Object.assign(pdf.info, { WaitronRecoveryDigest: digest });
  const done = new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    const chunks: Buffer[] = [];
    pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
    pdf.on("error", reject);
    pdf.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
  });
  pdf.text("Recovery pack");
  pdf.file(Buffer.from(fileBytes), { name: PACK_ATTACHMENT, type: "application/json" });
  pdf.end();
  return done;
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
  "restore failed: the PDF is not a Waitron recovery pack; give the venue's recovery pack PDF or a file with the master key";
export const PACK_DAMAGED =
  "restore failed: the recovery pack PDF is damaged, or was changed after it was made; use the pack PDF as it was saved";

/** A well-formed PDF with no attached file, such as any other document the owner keeps. */
export async function plainPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  return pdf.save();
}
