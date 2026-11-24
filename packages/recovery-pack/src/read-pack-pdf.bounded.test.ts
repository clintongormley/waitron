import PDFKit from "pdfkit";
import { deflateSync } from "node:zlib";
import {
  decodePDFRawStream,
  PDFArray,
  PDFContext,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNull,
  PDFRef,
} from "pdf-lib";
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
  version: 2,
  number: 2,
  madeAt: "2026-10-29T17:00:00.000Z",
  bucketCode: "WAITRON-RECOVERY-KIT-2:" + "b".repeat(600),
  archiveCode: null,
  backupKey: null,
  serverKey: null,
  serverKeyName: null,
  serverKeyHeldBy: null,
  masterKey: null,
  masterKeyName: null,
  masterKeyHeldBy: null,
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

/** Every decoding stage's buffer growth, in bytes, during the reads in this file. */
const growth = vi.spyOn(
  Object.getPrototypeOf(
    Object.getPrototypeOf(decodePDFRawStream(PDFContext.create().flateStream(new Uint8Array(1)))),
  ) as { ensureBuffer: (requested: number) => Uint8Array },
  "ensureBuffer",
);

function largestRequest(): number {
  return Math.max(0, ...growth.mock.calls.map(([requested]) => requested));
}

/** A document built by hand around Flate streams of `[keys, inflated]`, numbered from 3. */
function documentAround(
  streams: readonly (readonly [string, Uint8Array])[],
  xrefStream = false,
): Uint8Array {
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  const length = () => parts.reduce((n, p) => n + p.length, 0);
  const push = (s: string | Uint8Array) =>
    parts.push(typeof s === "string" ? Buffer.from(s, "latin1") : s);
  push("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n");
  offsets[1] = length();
  push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  offsets[2] = length();
  push("2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n");
  streams.forEach(([keys, inflated], i) => {
    const z = deflateSync(inflated);
    offsets[3 + i] = length();
    push(`${3 + i} 0 obj\n<< ${keys} /Filter /FlateDecode /Length ${z.length} >>\nstream\n`);
    push(z);
    push("\nendstream\nendobj\n");
  });
  const end = length();
  const size = 3 + streams.length;
  if (xrefStream) push(`startxref\n${offsets.at(-1)}\n%%EOF\n`);
  else
    push(
      `xref\n0 ${size}\n0000000000 65535 f \n` +
        offsets
          .slice(1)
          .map((offset) => String(offset).padStart(10, "0") + " 00000 n \n")
          .join("") +
        `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${end}\n%%EOF\n`,
    );
  return Buffer.concat(parts);
}

/** An object stream holding one `null` as object `number`, padded with spaces to `size` bytes. */
function paddedObjectStream(number: number, size: number): readonly [string, Uint8Array] {
  const head = `${number} 0\n`;
  const inflated = new Uint8Array(size).fill(0x20);
  inflated.set(Buffer.from(head + "null", "latin1"));
  return [`/Type /ObjStm /N 1 /First ${head.length}`, inflated];
}

describe("a document whose own structure inflates past the limit", () => {
  beforeEach(() => {
    decoded.length = 0;
    growth.mockClear();
  });

  it("is refused without inflating an object stream", async () => {
    const bytes = documentAround([
      ["/Type /ObjStm /N 1 /First 4", new Uint8Array(64 * 1024 * 1024).fill(0x20)],
    ]);
    expect(bytes.length).toBeLessThan(128 * 1024);
    expect(await reason(bytes)).toBe("size");
    expect(largestRequest()).toBeLessThanOrEqual(32 * MAX_PACK_FILE);
  });

  it("is refused without inflating a cross-reference stream", async () => {
    const bytes = documentAround(
      [
        [
          "/Type /XRef /Size 4 /W [1 2 1] /Index [0 1] /Root 1 0 R",
          new Uint8Array(64 * 1024 * 1024),
        ],
      ],
      true,
    );
    expect(bytes.length).toBeLessThan(128 * 1024);
    expect(await reason(bytes)).toBe("size");
    expect(largestRequest()).toBeLessThanOrEqual(32 * MAX_PACK_FILE);
  });

  it("is refused when streams each within the limit add up past it", async () => {
    const quarter = 4 * MAX_PACK_FILE;
    const parts = [3, 4, 5, 6, 7].map((n) => paddedObjectStream(n, quarter - 1024));
    expect(await reason(documentAround(parts.slice(0, 2)))).toBe("not_a_pack");
    growth.mockClear();
    expect(await reason(documentAround(parts))).toBe("size");
    expect(largestRequest()).toBeLessThanOrEqual(32 * MAX_PACK_FILE);
  });

  it("leaves another pdf-lib load at the same time unbounded", async () => {
    const large = documentAround([paddedObjectStream(3, 64 * MAX_PACK_FILE)]);
    const [refused, other] = await Promise.all([
      reason(documentAround([paddedObjectStream(3, 64 * MAX_PACK_FILE)])),
      PDFDocument.load(large),
    ]);
    expect(refused).toBe("size");
    expect(other.context.lookup(PDFRef.of(3))).toBe(PDFNull);
  });
});
