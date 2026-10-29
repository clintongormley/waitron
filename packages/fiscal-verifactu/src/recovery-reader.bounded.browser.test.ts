import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import PDFKit from "pdfkit";
import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";
import { canonicalJson, PACK_ATTACHMENT, type RecoveryPackFile } from "@waitron/recovery-pack";
import fontUrl from "./assets/register-noto-sans.ttf?url";
import { openRecoveryPdf, readRecoveryPdf } from "./recovery-reader.js";
import {
  RECOVERY_ATTACHMENT,
  recoveryDocumentBytes,
  type RecoveryDocument,
} from "./recovery-document.js";

const keyDocument: RecoveryDocument = {
  kind: "waitron-recovery-document",
  version: 1,
  scope: { taxpayerNif: "B12345674", softwareId: "W1", environment: "production" },
  taxpayerName: "Olivo Restauración SL",
  venueName: "Olivo Centro",
  createdAt: "2026-10-17T12:30:00.000Z",
  nodeKey: { nodeId: "node-1", name: "Caja principal", secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345" },
};
const packFile: RecoveryPackFile = {
  kind: "waitron-recovery-pack",
  version: 1,
  number: 3,
  madeAt: "2026-10-17T12:40:00.000Z",
  bucketCode: null,
  archiveCode: null,
  backupKey: null,
  serverKey: JSON.parse(new TextDecoder().decode(recoveryDocumentBytes(keyDocument))),
  serverKeyName: "Caja principal",
  serverKeyHeldBy: null,
};
const attachments: Readonly<Record<string, Uint8Array>> = {
  [RECOVERY_ATTACHMENT]: recoveryDocumentBytes(keyDocument),
  [PACK_ATTACHMENT]: new TextEncoder().encode(canonicalJson(packFile)),
};

async function digestOf(bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
  return "sha256-v1:" + Array.from(hash, (n) => n.toString(16).padStart(2, "0")).join("");
}

/** A PDF carrying `bytes` attached as `name`, with that attachment's digest. */
async function carrier(name: string, bytes: Uint8Array): Promise<PDFDocument> {
  const font = new Uint8Array(await (await fetch(fontUrl)).arrayBuffer());
  const pdf = new PDFKit({ font: font as unknown as string });
  Object.assign(pdf.info, { WaitronRecoveryDigest: await digestOf(bytes) });
  const result = new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    pdf.on("data", (b: Uint8Array) => chunks.push(b));
    pdf.on("error", reject);
    pdf.on("end", () => {
      const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
      let offset = 0;
      for (const c of chunks) {
        all.set(c, offset);
        offset += c.length;
      }
      resolve(all);
    });
  });
  pdf.text("Synthetic recovery carrier");
  pdf.file(new Uint8Array(bytes).buffer, { name });
  pdf.end();
  return PDFDocument.load(await result);
}

/** The carrier with its attached stream replaced by `contents`, Flate-encoded, declaring no size. */
async function withAttachment(name: string, contents: Uint8Array): Promise<Uint8Array> {
  const pdf = await carrier(name, attachments[name]!);
  const spec = pdf.catalog
    .lookup(PDFName.of("Names"), PDFDict)
    .lookup(PDFName.of("EmbeddedFiles"), PDFDict)
    .lookup(PDFName.of("Names"), PDFArray)
    .lookup(1, PDFDict);
  const stream = pdf.context.register(pdf.context.flateStream(contents, { Type: "EmbeddedFile" }));
  const ef = spec.lookup(PDFName.of("EF"), PDFDict);
  ef.set(PDFName.of("F"), stream);
  ef.delete(PDFName.of("UF"));
  return pdf.save();
}

let proxy: { getAttachmentContent: (id: string) => Promise<Uint8Array | null> };

beforeAll(async () => {
  const task = openRecoveryPdf(
    await (await carrier(RECOVERY_ATTACHMENT, attachments[RECOVERY_ATTACHMENT])).save(),
  );
  proxy = Object.getPrototypeOf(await task.promise);
  await task.destroy();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("an attached file that inflates past its limit, with no declared size", () => {
  it.each([RECOVERY_ATTACHMENT, PACK_ATTACHMENT])(
    "is refused as %s before the second reader inflates it",
    async (name) => {
      const bytes = await withAttachment(name, new Uint8Array(32 * 1024 * 1024));
      expect(bytes.length).toBeLessThan(256 * 1024);
      const content = vi.spyOn(proxy, "getAttachmentContent");
      await expect(readRecoveryPdf(bytes)).rejects.toThrow("Recovery PDF refused");
      expect(content).not.toHaveBeenCalled();
    },
  );

  it.each([RECOVERY_ATTACHMENT, PACK_ATTACHMENT])(
    "is still read as %s when it inflates to its limit or less",
    async (name) => {
      const content = vi.spyOn(proxy, "getAttachmentContent");
      const answer = await readRecoveryPdf(await withAttachment(name, attachments[name]!));
      expect(answer.document).toEqual(keyDocument);
      expect(content).toHaveBeenCalledTimes(1);
    },
  );
});
