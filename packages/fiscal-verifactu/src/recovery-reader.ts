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
  MAX_PACK_FILE,
  PACK_ATTACHMENT,
  parseRecoveryPackFile,
} from "@waitron/recovery-pack/src/pack-file.js";
import {
  MAX_RECOVERY_PDF,
  MAX_RECOVERY_ATTACHMENT,
  RECOVERY_ATTACHMENT,
  RecoveryPackWithoutKeyError,
  refuseRecovery,
  parseRecoveryDocument,
  recoveryDocumentBytes,
} from "./recovery-document.js";
GlobalWorkerOptions.workerSrc = workerUrl;
/** The one attached file a recovery PDF may carry: the key file, or a recovery pack's file. */
const ATTACHMENT_LIMITS: ReadonlyMap<string, number> = new Map([
  [RECOVERY_ATTACHMENT, MAX_RECOVERY_ATTACHMENT],
  [PACK_ATTACHMENT, MAX_PACK_FILE],
]);
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
async function checkCarrier(bytes: Uint8Array): Promise<{ contentDigest: string; name: string }> {
  const pdf = await PDFDocument.load(bytes, { throwOnInvalidObject: true, updateMetadata: false });
  let attachedSpec: PDFDict | undefined;
  let attachedName = "";
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
        attachedName = string(names.lookup(i));
        if (++entries !== 1 || !ATTACHMENT_LIMITS.has(attachedName)) refuseRecovery();
        const spec = names.lookup(i + 1, PDFDict);
        attachedSpec = spec;
        if (string(spec.lookup(PDFName.of("F"))) !== attachedName) refuseRecovery();
        const uf = spec.lookup(PDFName.of("UF"));
        if (uf && string(uf) !== attachedName) refuseRecovery();
        const ef = spec.lookup(PDFName.of("EF"), PDFDict);
        const stream = ef.lookup(PDFName.of("F"));
        if (!(stream instanceof PDFRawStream)) refuseRecovery();
        if (ef.keys().some((key) => !["/F", "/UF"].includes(key.toString()))) refuseRecovery();
        const unicodeStream = ef.lookup(PDFName.of("UF"));
        if (unicodeStream && unicodeStream !== stream) refuseRecovery();
        const params = stream.dict.lookupMaybe(PDFName.of("Params"), PDFDict);
        const size = params?.get(PDFName.of("Size"));
        if (size && Number(size.toString()) > ATTACHMENT_LIMITS.get(attachedName)!)
          refuseRecovery();
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
  return { contentDigest, name: attachedName };
}
/**
 * The server key a pack carries, held to the key file's checks. The pack file's own canonical-bytes
 * check covers the nested key's bytes, so it needs no second comparison; only the key leaves.
 */
async function packServerKey(file: Uint8Array): Promise<RecoveryDocument> {
  const pack = parseRecoveryPackFile(file);
  if (pack.serverKey === null)
    throw new RecoveryPackWithoutKeyError(pack.serverKeyName, pack.serverKeyHeldBy);
  return parseRecoveryDocument(pack.serverKey);
}
export async function readRecoveryPdf(
  bytes: Uint8Array,
): Promise<{ document: RecoveryDocument; attachmentBytes: Uint8Array<ArrayBuffer> }> {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > MAX_RECOVERY_PDF)
    refuseRecovery();
  let task: ReturnType<typeof openRecoveryPdf> | undefined;
  try {
    const { contentDigest, name } = await checkCarrier(bytes);
    task = openRecoveryPdf(bytes);
    const pdf = await task.promise;
    const attachments = await pdf.getAttachments();
    if (!attachments || attachments.size !== 1) refuseRecovery();
    const entry = [...attachments.entries()][0]!;
    if (entry[0] !== name || entry[1].filename !== name) refuseRecovery();
    const content = await pdf.getAttachmentContent(entry[0]);
    if (!content || content.length > ATTACHMENT_LIMITS.get(name)!) refuseRecovery();
    const attachedBytes = new Uint8Array(content);
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", attachedBytes));
    const actual = "sha256-v1:" + Array.from(hash, (n) => n.toString(16).padStart(2, "0")).join("");
    if (name === PACK_ATTACHMENT) {
      if (actual !== contentDigest) refuseRecovery();
      const document = await packServerKey(attachedBytes);
      return { document, attachmentBytes: recoveryDocumentBytes(document) };
    }
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(attachedBytes);
    const document = await parseRecoveryDocument(JSON.parse(text));
    const canonical = recoveryDocumentBytes(document);
    if (
      canonical.length !== attachedBytes.length ||
      canonical.some((b, i) => attachedBytes[i] !== b)
    )
      refuseRecovery();
    if (actual !== contentDigest) refuseRecovery();
    return { document, attachmentBytes: attachedBytes };
  } catch (error) {
    if (
      error instanceof RecoveryPackWithoutKeyError ||
      (error instanceof Error &&
        error.message === "No recovery key attachment; enter the key from the sheet manually")
    )
      throw error;
    return refuseRecovery();
  } finally {
    await task?.destroy();
  }
}
