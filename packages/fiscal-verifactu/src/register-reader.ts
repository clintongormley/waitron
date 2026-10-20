import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { RegisterDocument } from "./paper-register-protocol.js";
import {
  PDFDocument,
  PDFDict,
  PDFArray,
  PDFName,
  PDFString,
  PDFHexString,
  PDFRawStream,
} from "pdf-lib";
import {
  MAX_REGISTER_PDF,
  MAX_REGISTER_ATTACHMENT,
  REGISTER_ATTACHMENT,
  refuseRegister,
  parseRegisterDocument,
  registerDocumentBytes,
} from "./register-document.js";
GlobalWorkerOptions.workerSrc = workerUrl;
export function openRegisterPdf(bytes: Uint8Array) {
  return getDocument({
    data: bytes.slice(),
    useSystemFonts: false,
    disableFontFace: true,
    stopAtErrors: true,
    useWorkerFetch: false,
    useWasm: false,
  });
}
async function checkCarrier(bytes: Uint8Array): Promise<void> {
  const pdf = await PDFDocument.load(bytes, { throwOnInvalidObject: true, updateMetadata: false });
  const visited = new Set<PDFDict>();
  let entries = 0;
  const string = (v: unknown) =>
    v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : refuseRegister();
  function tree(node: PDFDict, depth: number): void {
    if (depth > 16 || visited.has(node)) refuseRegister();
    visited.add(node);
    const kids = node.lookupMaybe(PDFName.of("Kids"), PDFArray);
    const names = node.lookupMaybe(PDFName.of("Names"), PDFArray);
    if (Boolean(kids) === Boolean(names)) refuseRegister();
    if (kids) {
      for (let i = 0; i < kids.size(); i++) tree(kids.lookup(i, PDFDict), depth + 1);
    }
    if (names) {
      if (names.size() % 2 !== 0) refuseRegister();
      for (let i = 0; i < names.size(); i += 2) {
        if (++entries !== 1 || string(names.lookup(i)) !== REGISTER_ATTACHMENT) refuseRegister();
        const spec = names.lookup(i + 1, PDFDict);
        if (string(spec.lookup(PDFName.of("F"))) !== REGISTER_ATTACHMENT) refuseRegister();
        const uf = spec.lookup(PDFName.of("UF"));
        if (uf && string(uf) !== REGISTER_ATTACHMENT) refuseRegister();
        const ef = spec.lookup(PDFName.of("EF"), PDFDict);
        const stream = ef.lookup(PDFName.of("F"));
        if (!(stream instanceof PDFRawStream)) refuseRegister();
        const params = stream.dict.lookupMaybe(PDFName.of("Params"), PDFDict);
        const size = params?.get(PDFName.of("Size"));
        if (size && Number(size.toString()) > MAX_REGISTER_ATTACHMENT) refuseRegister();
      }
    }
  }
  const names = pdf.catalog.lookup(PDFName.of("Names"), PDFDict);
  tree(names.lookup(PDFName.of("EmbeddedFiles"), PDFDict), 0);
  if (entries !== 1) refuseRegister();
  for (const page of pdf.getPages()) {
    const annotations = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    for (let i = 0; i < (annotations?.size() ?? 0); i++) {
      const annotation = annotations!.lookup(i, PDFDict);
      if (annotation.get(PDFName.of("Subtype"))?.toString() === "/FileAttachment") refuseRegister();
    }
  }
}
export async function readRegisterPdf(
  bytes: Uint8Array,
): Promise<{ document: RegisterDocument; attachmentBytes: Uint8Array<ArrayBuffer> }> {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > MAX_REGISTER_PDF)
    refuseRegister();
  let task: ReturnType<typeof openRegisterPdf> | undefined;
  try {
    await checkCarrier(bytes);
    task = openRegisterPdf(bytes);
    const pdf = await task.promise;
    const attachments = await pdf.getAttachments();
    if (!attachments || attachments.size !== 1) refuseRegister();
    const entry = [...attachments.entries()][0]!;
    if (entry[0] !== REGISTER_ATTACHMENT || entry[1].filename !== REGISTER_ATTACHMENT)
      refuseRegister();
    const content = await pdf.getAttachmentContent(entry[0]);
    if (!content || content.length > MAX_REGISTER_ATTACHMENT) refuseRegister();
    const attachmentBytes = new Uint8Array(content);
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(attachmentBytes);
    const document = await parseRegisterDocument(JSON.parse(text));
    const canonical = registerDocumentBytes(document);
    if (
      canonical.length !== attachmentBytes.length ||
      canonical.some((b, i) => attachmentBytes[i] !== b)
    )
      refuseRegister();
    return { document, attachmentBytes };
  } catch {
    return refuseRegister();
  } finally {
    await task?.destroy();
  }
}
