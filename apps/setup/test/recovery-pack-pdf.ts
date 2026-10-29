import { PDFDocument } from "pdf-lib";
import {
  buildRecoveryPackFile,
  type RecoveryPackFile,
} from "@waitron/recovery-pack/src/pack-file.js";
import { renderRecoveryPack } from "@waitron/recovery-pack/src/render-pack.js";
import fontUrl from "../../../packages/fiscal-verifactu/src/assets/register-noto-sans.ttf?url";

/** A recovery pack PDF drawn by the real renderer, carrying this bucket code in its attached file. */
export async function recoveryPackPdf(bucketCode: string | null): Promise<File> {
  const file: RecoveryPackFile = {
    kind: "waitron-recovery-pack",
    version: 1,
    number: 2,
    madeAt: "2026-10-29T17:00:00.000Z",
    bucketCode,
    archiveCode: null,
    backupKey: null,
    serverKey: null,
    serverKeyName: null,
    serverKeyHeldBy: null,
  };
  buildRecoveryPackFile(file);
  const font = new Uint8Array(await (await fetch(fontUrl)).arrayBuffer());
  const bytes = await renderRecoveryPack({
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
  return new File([bytes], "waitron-recovery-pack-2.pdf", { type: "application/pdf" });
}

/** A well-formed PDF with no attached file, such as any other document the owner keeps. */
export async function plainPdf(): Promise<File> {
  const pdf = await PDFDocument.create();
  pdf.addPage();
  return new File([new Uint8Array(await pdf.save())], "letter.pdf", { type: "application/pdf" });
}

/** The real bucket code shape, accepted by the pack file's own check. */
export const BUCKET_CODE = "WAITRON-RECOVERY-KIT-1:" + "Ab9_-".repeat(40);

/** The same pack claiming another digest for its attached file; every byte offset stays true. */
export async function damaged(pack: File): Promise<File> {
  const bytes = new Uint8Array(await pack.arrayBuffer());
  const marker = new TextEncoder().encode("(sha256-v1:");
  const at = bytes.findIndex((_, i) => marker.every((byte, j) => bytes[i + j] === byte));
  if (at < 0) throw new Error("no digest in the pack");
  bytes.fill("0".charCodeAt(0), at + marker.length, at + marker.length + 64);
  return new File([bytes], pack.name, { type: pack.type });
}

/** Chooses `file` in a native file input, as a person picking it would. */
export function choose(input: HTMLInputElement, file: File): void {
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change"));
}

/**
 * A text file whose read waits for `release`. Once released, a text file's read does no further
 * I/O, so one timer turn afterwards has let it finish.
 */
export function heldFile(text: string): { file: File; release: () => Promise<void> } {
  let open!: (bytes: ArrayBuffer) => void;
  const held = new Promise<ArrayBuffer>((resolve) => (open = resolve));
  const file = new File([text], "kit.txt");
  Object.defineProperty(file, "arrayBuffer", { value: () => held });
  return {
    file,
    release: async () => {
      open(new TextEncoder().encode(text).buffer);
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}
