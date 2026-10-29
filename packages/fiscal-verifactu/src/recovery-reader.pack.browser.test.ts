import { describe, expect, it } from "vitest";
import PDFKit from "pdfkit";
import { PDFDocument, PDFName } from "pdf-lib";
import {
  canonicalJson,
  PACK_ATTACHMENT,
  renderRecoveryPack,
  type PackPart,
  type RecoveryPackFile,
} from "@waitron/recovery-pack";
import fontUrl from "./assets/register-noto-sans.ttf?url";
import { readRecoveryPdf } from "./recovery-reader.js";
import {
  RECOVERY_ATTACHMENT,
  RecoveryPackWithoutKeyError,
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
const bucketCode = "WAITRON-RECOVERY-KIT-1:" + "Ab9_-".repeat(40);
const archiveCode = "WAITRON-ARCHIVE-PACK-1:" + "Zx7-_".repeat(30);

function packFile(overrides: Partial<RecoveryPackFile> = {}): RecoveryPackFile {
  return {
    kind: "waitron-recovery-pack",
    version: 1,
    number: 3,
    madeAt: "2026-10-17T12:40:00.000Z",
    bucketCode,
    archiveCode,
    backupKey: "backup-key-of-the-venue",
    serverKey: JSON.parse(new TextDecoder().decode(recoveryDocumentBytes(keyDocument))),
    serverKeyName: "Caja principal",
    serverKeyHeldBy: null,
    ...overrides,
  };
}

async function font(): Promise<Uint8Array> {
  return new Uint8Array(await (await fetch(fontUrl)).arrayBuffer());
}

const bucketPart: PackPart = {
  kind: "bucket",
  state: "included",
  page: {
    title: "Bucket copy",
    rows: [],
    secret: { label: "Restore code", text: bucketCode, qr: true },
    notes: [],
  },
};

async function pack(file: RecoveryPackFile): Promise<Uint8Array<ArrayBuffer>> {
  return renderRecoveryPack({
    locale: "en",
    timeZone: "Europe/Madrid",
    loadFont: font,
    cover: {
      legalName: keyDocument.taxpayerName,
      taxId: keyDocument.scope.taxpayerNif,
      venueName: keyDocument.venueName,
      madeAt: file.madeAt,
      madeBy: null,
      number: file.number,
    },
    parts: [bucketPart],
    file,
  });
}

async function digestOf(bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
  return "sha256-v1:" + Array.from(hash, (n) => n.toString(16).padStart(2, "0")).join("");
}

/** A PDF carrying exactly these attached files; its digest names the first unless given. */
async function carrier(entries: readonly (readonly [string, Uint8Array])[], digest?: string) {
  const pdf = new PDFKit({ font: (await font()) as unknown as string });
  Object.assign(pdf.info, { WaitronRecoveryDigest: digest ?? (await digestOf(entries[0]![1])) });
  const result = new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    pdf.on("data", (b: Uint8Array) => chunks.push(b));
    pdf.on("error", reject);
    pdf.on("end", () => {
      const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
      let offset = 0;
      for (const c of chunks) {
        bytes.set(c, offset);
        offset += c.length;
      }
      resolve(bytes);
    });
  });
  pdf.text("Synthetic recovery pack");
  for (const [name, bytes] of entries) pdf.file(new Uint8Array(bytes).buffer, { name });
  pdf.end();
  return result;
}

const encode = (value: unknown) => new TextEncoder().encode(canonicalJson(value));

describe("the fiscal reader and a recovery pack PDF", () => {
  it("returns the server key document a pack holds", async () => {
    expect(await readRecoveryPdf(await pack(packFile()))).toEqual({
      document: keyDocument,
      attachmentBytes: recoveryDocumentBytes(keyDocument),
    });
  });

  it("returns only the key document, never the pack's other secrets", async () => {
    const answer = await readRecoveryPdf(await pack(packFile()));
    expect(Object.keys(answer).sort()).toEqual(["attachmentBytes", "document"]);
    const text = new TextDecoder().decode(answer.attachmentBytes);
    for (const secret of [bucketCode, archiveCode, "backup-key-of-the-venue"])
      expect(text).not.toContain(secret);
  });

  it.each([
    ["key file first", false],
    ["pack file first", false],
    ["key file first, no catalog association", true],
    ["pack file first, no catalog association", true],
  ] as const)("refuses a PDF carrying both files (%s)", async (order, strip) => {
    const both: [string, Uint8Array][] = [
      [RECOVERY_ATTACHMENT, recoveryDocumentBytes(keyDocument)],
      [PACK_ATTACHMENT, encode(packFile())],
    ];
    if (order.startsWith("pack")) both.reverse();
    const pdf = await PDFDocument.load(await carrier(both));
    if (strip) pdf.catalog.delete(PDFName.of("AF"));
    await expect(readRecoveryPdf(await pdf.save())).rejects.toThrow("Recovery PDF refused");
  });

  it.each(["extra field", "secret of the wrong form", "wrong kind"])(
    "refuses a pack whose server key has an %s",
    async (fault) => {
      const serverKey = JSON.parse(new TextDecoder().decode(recoveryDocumentBytes(keyDocument)));
      if (fault === "extra field") serverKey.password = "forbidden";
      if (fault === "secret of the wrong form") serverKey.nodeKey.secret = "short";
      if (fault === "wrong kind") serverKey.kind = "waitron-recovery-pack";
      await expect(readRecoveryPdf(await pack(packFile({ serverKey })))).rejects.toThrow(
        "Recovery PDF refused",
      );
    },
  );

  it("refuses a pack whose nested key file is not in canonical key order", async () => {
    const canonical = new TextDecoder().decode(encode(packFile()));
    const keyText = canonicalJson(packFile().serverKey);
    const reordered = keyText
      .replace('{"createdAt"', '{"version":1,"createdAt"')
      .replace(/,"version":1}$/, "}");
    expect(reordered).not.toBe(keyText);
    const bytes = new TextEncoder().encode(canonical.replace(keyText, reordered));
    await expect(readRecoveryPdf(await carrier([[PACK_ATTACHMENT, bytes]]))).rejects.toThrow(
      "Recovery PDF refused",
    );
  });

  it("refuses a pack whose attached file does not match its digest", async () => {
    const forged = await carrier(
      [[PACK_ATTACHMENT, encode(packFile({ bucketCode: null }))]],
      await digestOf(encode(packFile())),
    );
    await expect(readRecoveryPdf(forged)).rejects.toThrow("Recovery PDF refused");
  });

  it.each([
    [{ number: 1, madeOn: "2026-09-02", received: true }, "Caja principal"],
    [{ number: 2, madeOn: "2026-09-12", received: false }, "Caja principal"],
    [null, "Caja principal"],
    [null, null],
  ] as const)(
    "says which pack holds the key when this one does not (%o, %s)",
    async (heldBy, serverKeyName) => {
      const error = await readRecoveryPdf(
        await pack(packFile({ serverKey: null, serverKeyHeldBy: heldBy, serverKeyName })),
      ).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(RecoveryPackWithoutKeyError);
      expect(error).toMatchObject({ serverKeyName, heldBy });
    },
  );
});
