import { describe, expect, it } from "vitest";
import PDFKit from "pdfkit";
import { PDFDocument, PDFArray, PDFDict, PDFName, PDFString } from "pdf-lib";
import fontUrl from "./assets/register-noto-sans.ttf?url";
import { readRecoveryPdf } from "./recovery-reader.js";
import {
  RECOVERY_ATTACHMENT,
  MAX_RECOVERY_ATTACHMENT,
  MAX_RECOVERY_PDF,
  recoveryDocumentBytes,
  type RecoveryDocument,
} from "./recovery-document.js";
const document: RecoveryDocument = {
  kind: "waitron-recovery-document",
  version: 1,
  scope: { taxpayerNif: "B12345674", softwareId: "W1", environment: "production" },
  taxpayerName: "Olivo Restauración SL",
  venueName: "Olivo Centro",
  createdAt: "2026-10-17T12:30:00.000Z",
  nodeKey: { nodeId: "node-1", name: "Caja principal", secret: "AbCdEfGhIjKlMnOpQrStUvWxYz012345" },
};
async function carrier(entries: readonly (readonly [string, Uint8Array])[]) {
  const font = new Uint8Array(await (await fetch(fontUrl)).arrayBuffer());
  const pdf = new PDFKit({ font: font as unknown as string });
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
  pdf.text("Synthetic recovery sheet");
  for (const [name, bytes] of entries) pdf.file(new Uint8Array(bytes).buffer, { name });
  pdf.end();
  return result;
}
async function base() {
  return PDFDocument.load(await carrier([[RECOVERY_ATTACHMENT, recoveryDocumentBytes(document)]]));
}
function names(pdf: PDFDocument) {
  return pdf.catalog
    .lookup(PDFName.of("Names"), PDFDict)
    .lookup(PDFName.of("EmbeddedFiles"), PDFDict)
    .lookup(PDFName.of("Names"), PDFArray);
}
describe("strict recovery PDF attachment reader", () => {
  it("offers manual entry when a printed copy has no attachment", async () => {
    await expect(readRecoveryPdf(await carrier([]))).rejects.toThrow(
      "No recovery key attachment; enter the key from the sheet manually",
    );
  });
  it.each([
    "wrong name",
    "corrupt",
    "noncanonical",
    "duplicate JSON key",
    "extra secret",
    "oversized",
    "conflicting",
  ])("refuses %s", async (kind) => {
    let bytes = recoveryDocumentBytes(document);
    let name = RECOVERY_ATTACHMENT;
    if (kind === "wrong name") name = "other.json";
    if (kind === "corrupt") bytes = new TextEncoder().encode("broken");
    if (kind === "noncanonical")
      bytes = new TextEncoder().encode(" " + new TextDecoder().decode(bytes));
    if (kind === "duplicate JSON key")
      bytes = new TextEncoder().encode(
        new TextDecoder().decode(bytes).replace('"version":1', '"version":0,"version":1'),
      );
    if (kind === "extra secret")
      bytes = new TextEncoder().encode(JSON.stringify({ ...document, password: "forbidden" }));
    if (kind === "oversized") bytes = new Uint8Array(MAX_RECOVERY_ATTACHMENT + 1);
    const entries: [string, Uint8Array][] = [[name, bytes]];
    if (kind === "conflicting") entries.push(["other.json", bytes]);
    await expect(readRecoveryPdf(await carrier(entries))).rejects.toThrow("Recovery PDF refused");
  });
  it.each([
    "duplicate name",
    "mismatched F",
    "mismatched UF",
    "file annotation",
    "cycle",
    "odd names",
    "both kids and names",
    "conflicting EF UF",
    "catalog association",
  ])("refuses hostile carrier: %s", async (kind) => {
    const pdf = await base();
    const list = names(pdf);
    const spec = list.lookup(1, PDFDict);
    const root = pdf.catalog
      .lookup(PDFName.of("Names"), PDFDict)
      .lookup(PDFName.of("EmbeddedFiles"), PDFDict);
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
    if (kind === "cycle") {
      root.delete(PDFName.of("Names"));
      root.set(PDFName.of("Kids"), pdf.context.obj([pdf.context.register(root)]));
    }
    if (kind === "odd names") list.push(PDFString.of("dangling"));
    if (kind === "conflicting EF UF")
      spec
        .lookup(PDFName.of("EF"), PDFDict)
        .set(PDFName.of("UF"), pdf.context.register(pdf.context.flateStream("hidden secret")));
    if (kind === "catalog association")
      pdf.catalog.set(PDFName.of("AF"), pdf.context.obj([spec, spec]));
    if (kind === "both kids and names") root.set(PDFName.of("Kids"), pdf.context.obj([]));
    await expect(readRecoveryPdf(await pdf.save())).rejects.toThrow("Recovery PDF refused");
  });
  it("accepts a changed PDF wrapper while retaining exact canonical key bytes", async () => {
    const pdf = await base();
    pdf.setTitle("Office annotation");
    expect(await readRecoveryPdf(await pdf.save())).toEqual({
      document,
      attachmentBytes: recoveryDocumentBytes(document),
    });
  });
  it("refuses excessive PDF bytes before parsing", async () => {
    await expect(readRecoveryPdf(new Uint8Array(MAX_RECOVERY_PDF + 1))).rejects.toThrow(
      "Recovery PDF refused",
    );
  });
});
