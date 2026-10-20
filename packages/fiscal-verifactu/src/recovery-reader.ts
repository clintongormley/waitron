import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { RecoveryDocument } from "./recovery-document.js";
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
  MAX_RECOVERY_PDF,
  MAX_RECOVERY_ATTACHMENT,
  RECOVERY_ATTACHMENT,
  refuseRecovery,
  parseRecoveryDocument,
  recoveryDocumentBytes,
} from "./recovery-document.js";
GlobalWorkerOptions.workerSrc = workerUrl;
export function openRecoveryPdf(bytes: Uint8Array) {
  return getDocument({
    data: bytes.slice(),
    useSystemFonts: false,
    disableFontFace: true,
    stopAtErrors: true,
    useWorkerFetch: false,
    useWasm: false,
  });
}
async function checkCarrier(bytes: Uint8Array): Promise<string> {
  const pdf = await PDFDocument.load(bytes, { throwOnInvalidObject: true, updateMetadata: false });
  let attachedSpec: PDFDict | undefined;
  const visited = new Set<PDFDict>();
  let entries = 0;
  const string = (v: unknown) =>
    v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : refuseRecovery();
  function tree(node: PDFDict, depth: number): void {
    if (depth > 16 || visited.has(node)) refuseRecovery();
    visited.add(node);
    const kids = node.lookupMaybe(PDFName.of("Kids"), PDFArray);
    const names = node.lookupMaybe(PDFName.of("Names"), PDFArray);
    if (Boolean(kids) === Boolean(names)) refuseRecovery();
    if (kids) {
      for (let i = 0; i < kids.size(); i++) tree(kids.lookup(i, PDFDict), depth + 1);
    }
    if (names) {
      if (names.size() % 2 !== 0) refuseRecovery();
      for (let i = 0; i < names.size(); i += 2) {
        if (++entries !== 1 || string(names.lookup(i)) !== RECOVERY_ATTACHMENT) refuseRecovery();
        const spec = names.lookup(i + 1, PDFDict);
        attachedSpec = spec;
        if (string(spec.lookup(PDFName.of("F"))) !== RECOVERY_ATTACHMENT) refuseRecovery();
        const uf = spec.lookup(PDFName.of("UF"));
        if (uf && string(uf) !== RECOVERY_ATTACHMENT) refuseRecovery();
        const ef = spec.lookup(PDFName.of("EF"), PDFDict);
        const stream = ef.lookup(PDFName.of("F"));
        if (!(stream instanceof PDFRawStream)) refuseRecovery();
        if (ef.keys().some((key) => !["/F", "/UF"].includes(key.toString()))) refuseRecovery();
        const unicodeStream = ef.lookup(PDFName.of("UF"));
        if (unicodeStream && unicodeStream !== stream) refuseRecovery();
        const params = stream.dict.lookupMaybe(PDFName.of("Params"), PDFDict);
        const size = params?.get(PDFName.of("Size"));
        if (size && Number(size.toString()) > MAX_RECOVERY_ATTACHMENT) refuseRecovery();
      }
    }
  }
  for (const page of pdf.getPages()) {
    if (page.node.has(PDFName.of("AF"))) refuseRecovery();
    const annotations = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    for (let i = 0; i < (annotations?.size() ?? 0); i++) {
      const annotation = annotations!.lookup(i, PDFDict);
      if (annotation.get(PDFName.of("Subtype"))?.toString() === "/FileAttachment") refuseRecovery();
    }
  }
  const names = pdf.catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  const files = names?.lookupMaybe(PDFName.of("EmbeddedFiles"), PDFDict);
  if (!files) throw new Error("No recovery key attachment; enter the key from the sheet manually");
  tree(files, 0);
  if (entries !== 1) refuseRecovery();
  const associated = pdf.catalog.lookupMaybe(PDFName.of("AF"), PDFArray);
  if (associated && (associated.size() !== 1 || associated.lookup(0, PDFDict) !== attachedSpec))
    refuseRecovery();
  const info = pdf.context.lookup(pdf.context.trailerInfo.Info, PDFDict);
  const contentDigest = string(info.lookup(PDFName.of("WaitronRecoveryDigest")));
  if (!/^sha256-v1:[a-f0-9]{64}$/.test(contentDigest)) refuseRecovery();
  return contentDigest;
}
export async function readRecoveryPdf(
  bytes: Uint8Array,
): Promise<{ document: RecoveryDocument; attachmentBytes: Uint8Array<ArrayBuffer> }> {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > MAX_RECOVERY_PDF)
    refuseRecovery();
  let task: ReturnType<typeof openRecoveryPdf> | undefined;
  try {
    const contentDigest = await checkCarrier(bytes);
    task = openRecoveryPdf(bytes);
    const pdf = await task.promise;
    const attachments = await pdf.getAttachments();
    if (!attachments || attachments.size !== 1) refuseRecovery();
    const entry = [...attachments.entries()][0]!;
    if (entry[0] !== RECOVERY_ATTACHMENT || entry[1].filename !== RECOVERY_ATTACHMENT)
      refuseRecovery();
    const content = await pdf.getAttachmentContent(entry[0]);
    if (!content || content.length > MAX_RECOVERY_ATTACHMENT) refuseRecovery();
    const attachmentBytes = new Uint8Array(content);
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(attachmentBytes);
    const document = await parseRecoveryDocument(JSON.parse(text));
    const canonical = recoveryDocumentBytes(document);
    if (
      canonical.length !== attachmentBytes.length ||
      canonical.some((b, i) => attachmentBytes[i] !== b)
    )
      refuseRecovery();
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", attachmentBytes));
    const actual = "sha256-v1:" + Array.from(hash, (n) => n.toString(16).padStart(2, "0")).join("");
    if (actual !== contentDigest) refuseRecovery();
    return { document, attachmentBytes };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "No recovery key attachment; enter the key from the sheet manually"
    )
      throw error;
    return refuseRecovery();
  } finally {
    await task?.destroy();
  }
}
