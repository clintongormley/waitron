import PDFKit from "pdfkit";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from "pdf-lib";
import {
  buildRecoveryPackFile,
  MAX_PACK_FILE,
  PACK_ATTACHMENT,
  RecoveryPackFileError,
  type RecoveryPackFile,
} from "./pack-file.js";
import { MAX_PACK_PDF, readRecoveryPackPdf } from "./read-pack-pdf.js";

const file: RecoveryPackFile = {
  kind: "waitron-recovery-pack",
  version: 1,
  number: 2,
  madeAt: "2026-10-29T17:00:00.000Z",
  bucketCode: "WAITRON-RECOVERY-KIT-1:" + "b".repeat(600),
  archiveCode: null,
  backupKey: "k".repeat(43),
  serverKey: null,
  serverKeyName: "2026-10-12 · key",
  serverKeyHeldBy: { number: 1, madeOn: "2026-10-12", received: true },
};
const fileBytes = buildRecoveryPackFile(file);

async function digest(bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
  return "sha256-v1:" + Array.from(hash, (n) => n.toString(16).padStart(2, "0")).join("");
}

async function carrier(
  entries: readonly (readonly [string, Uint8Array])[],
  infoDigest?: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const pdf = new PDFKit();
  const first = entries[0];
  const value = infoDigest ?? (first ? await digest(first[1]) : undefined);
  if (value) Object.assign(pdf.info, { WaitronRecoveryDigest: value });
  const done = new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    pdf.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    pdf.on("error", reject);
    pdf.on("end", () => {
      const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      resolve(bytes);
    });
  });
  pdf.text("Synthetic recovery pack");
  for (const [name, bytes] of entries) pdf.file(Buffer.from(bytes), { name });
  pdf.end();
  return done;
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

function embedded(pdf: PDFDocument) {
  const root = pdf.catalog
    .lookup(PDFName.of("Names"), PDFDict)
    .lookup(PDFName.of("EmbeddedFiles"), PDFDict);
  const list = root.lookup(PDFName.of("Names"), PDFArray);
  return { root, list, spec: list.lookup(1, PDFDict) };
}

describe("reading the pack file out of a pack PDF", () => {
  it("returns the parsed pack file", async () => {
    expect(await readRecoveryPackPdf(await carrier([[PACK_ATTACHMENT, fileBytes]]))).toEqual(file);
  });

  it("still reads the file after the PDF wrapper is re-saved", async () => {
    const pdf = await PDFDocument.load(await carrier([[PACK_ATTACHMENT, fileBytes]]));
    pdf.setTitle("Annotated in an office");
    expect(await readRecoveryPackPdf(await pdf.save())).toEqual(file);
  });

  it("tells a PDF that is not a pack apart: no file, or one file of another name", async () => {
    expect(await reason(await carrier([]))).toBe("not_a_pack");
    expect(await reason(await carrier([["waitron-recovery-key-v1.json", fileBytes]]))).toBe(
      "not_a_pack",
    );
  });

  it("refuses bytes that are not a PDF at all", async () => {
    expect(await reason(new TextEncoder().encode("WAITRON-RECOVERY-KIT-1:abc"))).toBe("not_a_pack");
    expect(await reason(new TextEncoder().encode("%PDF-1.7 broken"))).toBe("carrier");
  });

  it("refuses a second embedded file, whatever its name", async () => {
    // pdfkit also lists every file in the catalogue's /AF; dropping it leaves the name tree's
    // own one-file check as the only thing that can refuse.
    const twoFiles = async (entries: [string, Uint8Array][]) => {
      const pdf = await PDFDocument.load(await carrier(entries));
      pdf.catalog.delete(PDFName.of("AF"));
      return pdf.save();
    };
    expect(
      await reason(
        await twoFiles([
          [PACK_ATTACHMENT, fileBytes],
          ["waitron-recovery-key-v1.json", fileBytes],
        ]),
      ),
    ).toBe("carrier");
    expect(
      await reason(
        await twoFiles([
          ["waitron-recovery-key-v1.json", fileBytes],
          [PACK_ATTACHMENT, fileBytes],
        ]),
      ),
    ).toBe("carrier");
  });

  it.each([
    "duplicate name",
    "mismatched F",
    "mismatched UF",
    "file annotation",
    "page association",
    "cycle",
    "too deep",
    "odd names",
    "both kids and names",
    "neither kids nor names",
    "conflicting EF UF",
    "extra EF key",
    "catalog association",
    "name not text",
    "file not a stream",
  ])("refuses a hostile carrier: %s", async (kind) => {
    const pdf = await PDFDocument.load(await carrier([[PACK_ATTACHMENT, fileBytes]]));
    const { root, list, spec } = embedded(pdf);
    if (kind === "duplicate name") {
      list.push(list.get(0));
      list.push(list.get(1));
    }
    if (kind === "mismatched F") spec.set(PDFName.of("F"), PDFString.of("other.json"));
    if (kind === "mismatched UF") spec.set(PDFName.of("UF"), PDFString.of("other.json"));
    if (kind === "file annotation")
      pdf
        .getPage(0)
        .node.set(
          PDFName.of("Annots"),
          pdf.context.obj([{ Type: "Annot", Subtype: "FileAttachment", FS: spec }]),
        );
    if (kind === "page association")
      pdf.getPage(0).node.set(PDFName.of("AF"), pdf.context.obj([spec]));
    if (kind === "cycle") {
      root.delete(PDFName.of("Names"));
      root.set(PDFName.of("Kids"), pdf.context.obj([pdf.context.register(root)]));
    }
    if (kind === "too deep") {
      let node = pdf.context.obj({ Names: list });
      for (let i = 0; i < 17; i++) node = pdf.context.obj({ Kids: [pdf.context.register(node)] });
      root.delete(PDFName.of("Names"));
      root.set(PDFName.of("Kids"), node.lookup(PDFName.of("Kids"), PDFArray));
    }
    if (kind === "odd names") list.push(PDFString.of("dangling"));
    if (kind === "both kids and names") root.set(PDFName.of("Kids"), pdf.context.obj([]));
    if (kind === "neither kids nor names") root.delete(PDFName.of("Names"));
    if (kind === "conflicting EF UF")
      spec
        .lookup(PDFName.of("EF"), PDFDict)
        .set(PDFName.of("UF"), pdf.context.register(pdf.context.flateStream("hidden secret")));
    if (kind === "extra EF key")
      spec
        .lookup(PDFName.of("EF"), PDFDict)
        .set(PDFName.of("DOS"), pdf.context.register(pdf.context.flateStream("hidden")));
    if (kind === "catalog association")
      pdf.catalog.set(PDFName.of("AF"), pdf.context.obj([spec, spec]));
    if (kind === "name not text") list.set(0, PDFName.of("waitron-recovery-pack-v1.json"));
    if (kind === "file not a stream")
      spec.lookup(PDFName.of("EF"), PDFDict).set(PDFName.of("F"), pdf.context.obj({ Length: 0 }));
    expect(await reason(await pdf.save())).toBe("carrier");
  });

  it("accepts a nested name tree and the catalogue's one association with the file", async () => {
    const pdf = await PDFDocument.load(await carrier([[PACK_ATTACHMENT, fileBytes]]));
    const { root, list } = embedded(pdf);
    root.delete(PDFName.of("Names"));
    root.set(
      PDFName.of("Kids"),
      pdf.context.obj([pdf.context.register(pdf.context.obj({ Names: list }))]),
    );
    pdf.catalog.set(PDFName.of("AF"), pdf.context.obj([list.get(1)]));
    expect(await readRecoveryPackPdf(await pdf.save())).toEqual(file);
  });

  it("accepts a page with an annotation that carries no file", async () => {
    const pdf = await PDFDocument.load(await carrier([[PACK_ATTACHMENT, fileBytes]]));
    pdf
      .getPage(0)
      .node.set(PDFName.of("Annots"), pdf.context.obj([{ Type: "Annot", Subtype: "Link" }]));
    expect(await readRecoveryPackPdf(await pdf.save())).toEqual(file);
  });

  it("refuses a file over the limit that declares no size", async () => {
    const big = new Uint8Array(MAX_PACK_FILE + 1).fill(0x20);
    const pdf = await PDFDocument.load(await carrier([[PACK_ATTACHMENT, big]]));
    const stream = embedded(pdf).spec.lookup(PDFName.of("EF"), PDFDict).lookup(PDFName.of("F"));
    (stream as unknown as { dict: PDFDict }).dict.delete(PDFName.of("Params"));
    expect(await reason(await pdf.save())).toBe("size");
  });

  it("refuses a digest that does not match the file, or no digest", async () => {
    expect(
      await reason(
        await carrier([[PACK_ATTACHMENT, fileBytes]], await digest(new Uint8Array([1]))),
      ),
    ).toBe("digest");
    expect(await reason(await carrier([[PACK_ATTACHMENT, fileBytes]], "sha256-v1:short"))).toBe(
      "digest",
    );
    const pdf = await PDFDocument.load(await carrier([[PACK_ATTACHMENT, fileBytes]]));
    const info = pdf.context.lookup(pdf.context.trailerInfo.Info, PDFDict);
    info.delete(PDFName.of("WaitronRecoveryDigest"));
    expect(await reason(await pdf.save())).toBe("digest");
  });

  it("refuses a declared size over the limit, a file over the limit and input over 8 MiB", async () => {
    const pdf = await PDFDocument.load(await carrier([[PACK_ATTACHMENT, fileBytes]]));
    const stream = embedded(pdf).spec.lookup(PDFName.of("EF"), PDFDict).lookup(PDFName.of("F"));
    const params = (stream as unknown as { dict: PDFDict }).dict.lookup(
      PDFName.of("Params"),
      PDFDict,
    );
    params.set(PDFName.of("Size"), pdf.context.obj(MAX_PACK_FILE + 1));
    expect(await reason(await pdf.save())).toBe("size");
    const big = new Uint8Array(MAX_PACK_FILE + 1).fill(0x20);
    expect(await reason(await carrier([[PACK_ATTACHMENT, big]]))).toBe("size");
    expect(await reason(new Uint8Array(MAX_PACK_PDF + 1))).toBe("size");
    expect(await reason(new Uint8Array())).toBe("size");
    expect(MAX_PACK_PDF).toBe(8 * 1024 * 1024);
  });

  it("refuses a pack file the format refuses", async () => {
    const extra = new TextEncoder().encode(JSON.stringify({ ...file, extra: 1 }));
    expect(await reason(await carrier([[PACK_ATTACHMENT, extra]]))).toBe("shape");
  });
});
