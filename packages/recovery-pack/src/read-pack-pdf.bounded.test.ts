import PDFKit from "pdfkit";
import { deflateSync } from "node:zlib";
import { PDFArray, PDFDict, PDFDocument, PDFName } from "pdf-lib";
import {
  buildRecoveryPackFile,
  MAX_PACK_FILE,
  PACK_ATTACHMENT,
  RecoveryPackFileError,
  type RecoveryPackFile,
} from "./pack-file.js";
import { readRecoveryPackPdf } from "./read-pack-pdf.js";

type Stage = { buffer?: Uint8Array; stream?: Stage };
const decoded: Stage[] = [];

vi.mock("pdf-lib", async (importOriginal) => {
  const original = await importOriginal<typeof import("pdf-lib")>();
  return {
    ...original,
    decodePDFRawStream: (...args: Parameters<typeof original.decodePDFRawStream>) => {
      const stream = original.decodePDFRawStream(...args);
      decoded.push(stream as unknown as Stage);
      return stream;
    },
  };
});

/** Every decoding stage's buffer, in bytes, for the streams the reader decoded. */
function allocated(): number {
  let total = 0;
  for (let stage: Stage | undefined = decoded.at(-1); stage; stage = stage.stream)
    total += stage.buffer?.byteLength ?? 0;
  return total;
}

const file: RecoveryPackFile = {
  kind: "waitron-recovery-pack",
  version: 1,
  number: 2,
  madeAt: "2026-10-29T17:00:00.000Z",
  bucketCode: "WAITRON-RECOVERY-KIT-1:" + "b".repeat(600),
  archiveCode: null,
  backupKey: null,
  serverKey: null,
  serverKeyName: null,
  serverKeyHeldBy: null,
};

async function carrier(): Promise<PDFDocument> {
  const pdf = new PDFKit();
  const fileBytes = buildRecoveryPackFile(file);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", fileBytes));
  Object.assign(pdf.info, {
    WaitronRecoveryDigest:
      "sha256-v1:" + Array.from(hash, (n) => n.toString(16).padStart(2, "0")).join(""),
  });
  const done = new Promise<Uint8Array>((resolve) => {
    const chunks: Uint8Array[] = [];
    pdf.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
  });
  pdf.file(Buffer.from(fileBytes), { name: PACK_ATTACHMENT });
  pdf.end();
  return PDFDocument.load(await done);
}

/** The carrier with its attached stream replaced by `contents`, Flate-encoded, declaring no size. */
async function withAttachment(
  contents: Uint8Array,
  filter: string | string[] = "FlateDecode",
): Promise<Uint8Array> {
  const pdf = await carrier();
  const spec = pdf.catalog
    .lookup(PDFName.of("Names"), PDFDict)
    .lookup(PDFName.of("EmbeddedFiles"), PDFDict)
    .lookup(PDFName.of("Names"), PDFArray)
    .lookup(1, PDFDict);
  const stream = pdf.context.register(
    pdf.context.stream(contents, { Type: "EmbeddedFile", Filter: filter }),
  );
  spec.lookup(PDFName.of("EF"), PDFDict).set(PDFName.of("F"), stream);
  return pdf.save();
}

/**
 * One fixed-Huffman Deflate block of `repeats` zero runs of 258 bytes. A decoder that reads whole
 * blocks has to produce all of it before it can stop.
 */
function oneBlockOfZeros(repeats: number): Uint8Array {
  const bits: number[] = [];
  const lsbFirst = (value: number, n: number) => {
    for (let i = 0; i < n; i++) bits.push((value >> i) & 1);
  };
  const msbFirst = (code: number, n: number) => {
    for (let i = n - 1; i >= 0; i--) bits.push((code >> i) & 1);
  };
  lsbFirst(1, 1); // last block
  lsbFirst(1, 2); // fixed Huffman codes
  msbFirst(0x30, 8); // literal 0
  for (let i = 0; i < repeats; i++) {
    msbFirst(0xc5, 8); // length 258
    msbFirst(0, 5); // distance 1
  }
  msbFirst(0, 7); // end of block
  const out = new Uint8Array(2 + Math.ceil(bits.length / 8));
  out.set([0x78, 0x01]);
  bits.forEach((bit, i) => (out[2 + (i >> 3)]! |= bit << (i & 7)));
  return out;
}

async function reason(bytes: Uint8Array): Promise<string> {
  try {
    await readRecoveryPackPdf(bytes);
  } catch (error) {
    expect(error).toBeInstanceOf(RecoveryPackFileError);
    return (error as RecoveryPackFileError).reason;
  }
  throw new Error("accepted");
}

describe("an attached file that inflates past the limit", () => {
  beforeEach(() => {
    decoded.length = 0;
  });

  it("is refused without inflating all of it, made by zlib with no declared size", async () => {
    const bytes = await withAttachment(deflateSync(new Uint8Array(32 * 1024 * 1024)));
    expect(bytes.length).toBeLessThan(64 * 1024);
    expect(await reason(bytes)).toBe("size");
    expect(allocated()).toBeLessThanOrEqual(32 * MAX_PACK_FILE);
  });

  it("is refused without inflating all of it, as one Deflate block", async () => {
    const block = oneBlockOfZeros(Math.ceil((24 * 1024 * 1024) / 258));
    expect(block.length).toBeLessThan(512 * 1024);
    expect(await reason(await withAttachment(block))).toBe("size");
    expect(allocated()).toBeLessThanOrEqual(32 * MAX_PACK_FILE);
  });

  it("is refused when an earlier filter inflates what a later one reads to nothing", async () => {
    const spaces = deflateSync(new Uint8Array(32 * 1024 * 1024).fill(0x20));
    expect(await reason(await withAttachment(spaces, ["FlateDecode", "ASCIIHexDecode"]))).toBe(
      "size",
    );
    expect(allocated()).toBeLessThanOrEqual(32 * MAX_PACK_FILE);
  });

  it("is still read when it inflates to the limit or less", async () => {
    const bytes = await withAttachment(deflateSync(buildRecoveryPackFile(file)));
    // The carrier's digest is of the original attachment, which this one equals.
    expect(await readRecoveryPackPdf(bytes)).toEqual(file);
  });
});
