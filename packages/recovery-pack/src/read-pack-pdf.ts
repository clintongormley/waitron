import {
  decodePDFRawStream,
  ParseSpeeds,
  PDFArray,
  type PDFContext,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFParser,
  PDFRawStream,
  PDFString,
} from "pdf-lib";
import {
  looksLikePdf,
  MAX_PACK_FILE,
  MAX_PACK_PDF,
  PACK_ATTACHMENT,
  parseRecoveryPackFile,
  RecoveryPackFileError,
  type RecoveryPackFile,
  type RecoveryPackFileRefusal,
} from "./pack-file.js";

export { MAX_PACK_PDF };

function refuse(reason: RecoveryPackFileRefusal): never {
  throw new RecoveryPackFileError(reason);
}

function text(value: unknown): string {
  return value instanceof PDFString || value instanceof PDFHexString
    ? value.decodeText()
    : refuse("carrier");
}

type Entry = { name: string; spec: PDFDict };

/**
 * The same walk as the fiscal reader's (`packages/fiscal-verifactu/src/recovery-reader.ts`), in
 * pdf-lib alone so it also runs on Node: exactly one embedded file, reached through a bounded,
 * acyclic name tree, and nowhere else in the document, so no two PDF readers can find different
 * files in it.
 */
function onlyEmbeddedFile(pdf: PDFDocument): Entry | undefined {
  const visited = new Set<PDFDict>();
  const entries: Entry[] = [];
  function tree(node: PDFDict, depth: number): void {
    if (depth > 16 || visited.has(node)) refuse("carrier");
    visited.add(node);
    const kids = node.lookupMaybe(PDFName.of("Kids"), PDFArray);
    const names = node.lookupMaybe(PDFName.of("Names"), PDFArray);
    if (Boolean(kids) === Boolean(names)) refuse("carrier");
    for (let i = 0; i < (kids?.size() ?? 0); i++) tree(kids!.lookup(i, PDFDict), depth + 1);
    if (names) {
      if (names.size() % 2 !== 0) refuse("carrier");
      for (let i = 0; i < names.size(); i += 2) {
        entries.push({ name: text(names.lookup(i)), spec: names.lookup(i + 1, PDFDict) });
        if (entries.length > 1) refuse("carrier");
      }
    }
  }
  for (const page of pdf.getPages()) {
    if (page.node.has(PDFName.of("AF"))) refuse("carrier");
    const annotations = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    for (let i = 0; i < (annotations?.size() ?? 0); i++) {
      const annotation = annotations!.lookup(i, PDFDict);
      if (annotation.get(PDFName.of("Subtype"))?.toString() === "/FileAttachment")
        refuse("carrier");
    }
  }
  const names = pdf.catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  const files = names?.lookupMaybe(PDFName.of("EmbeddedFiles"), PDFDict);
  if (files) tree(files, 0);
  const entry = entries[0];
  const associated = pdf.catalog.lookupMaybe(PDFName.of("AF"), PDFArray);
  if (associated && (associated.size() !== 1 || associated.lookup(0, PDFDict) !== entry?.spec))
    refuse("carrier");
  return entry;
}

function contents(spec: PDFDict, budget: Budget): Uint8Array {
  if (text(spec.lookup(PDFName.of("F"))) !== PACK_ATTACHMENT) refuse("carrier");
  const uf = spec.lookup(PDFName.of("UF"));
  if (uf && text(uf) !== PACK_ATTACHMENT) refuse("carrier");
  const ef = spec.lookup(PDFName.of("EF"), PDFDict);
  if (ef.keys().some((key) => !["/F", "/UF"].includes(key.toString()))) refuse("carrier");
  const stream = ef.lookup(PDFName.of("F"));
  if (!(stream instanceof PDFRawStream)) refuse("carrier");
  const unicodeStream = ef.lookup(PDFName.of("UF"));
  if (unicodeStream && unicodeStream !== stream) refuse("carrier");
  const size = stream.dict.lookupMaybe(PDFName.of("Params"), PDFDict)?.get(PDFName.of("Size"));
  if (size && Number(size.toString()) > MAX_PACK_FILE) refuse("size");
  const bytes = new Uint8Array(boundedDecode(stream, budget).getBytes(MAX_PACK_FILE + 1));
  if (bytes.length > MAX_PACK_FILE) refuse("size");
  return bytes;
}

/** What one read may decode in all; see {@link boundedDecode}. */
const DECODE_BUDGET = 16 * MAX_PACK_FILE;

/** Shared by every stream one read decodes, so many small streams cannot add up to a large one. */
type Budget = { left: number; exceeded: boolean };

type Stage = {
  buffer: Uint8Array;
  ensureBuffer: (requested: number) => Uint8Array;
  stream?: unknown;
};

/**
 * pdf-lib's decoders (pinned at 1.17.1) stop between Deflate blocks once `getBytes` has enough,
 * but finish a block once begun, and one block can inflate to gigabytes. Every stage grows its
 * buffer only through `ensureBuffer`, and holds the stage it reads from in `stream`, so refusing
 * growth once the stages sharing `budget` have grown by it in all bounds every chain they decode:
 * together they never hold twice the budget.
 */
export function boundedDecode(
  raw: PDFRawStream,
  budget: Budget = { left: DECODE_BUDGET, exceeded: false },
) {
  const decoder = decodePDFRawStream(raw);
  const stages: Stage[] = [];
  for (
    let stage = decoder as unknown as Partial<Stage>;
    typeof stage?.ensureBuffer === "function";
    stage = stage.stream as Partial<Stage>
  )
    stages.push(stage as Stage);
  for (const stage of stages) {
    const grow = stage.ensureBuffer.bind(stage);
    stage.ensureBuffer = (requested) => {
      const before = stage.buffer.byteLength;
      if (requested > before && requested - before > budget.left) {
        budget.exceeded = true;
        refuse("size");
      }
      const buffer = grow(requested);
      budget.left -= buffer.byteLength - before;
      return buffer;
    };
  }
  return decoder;
}

type Opening = new (
  context: PDFContext,
  ignoreEncryption: boolean,
  updateMetadata: boolean,
) => PDFDocument;

/**
 * `PDFDocument.load`, except that the object and cross-reference streams its parser decodes whole
 * reach it already decoded within `budget`. Only this parser's `parseObject` is replaced, so no
 * other pdf-lib use in the process is affected.
 */
async function load(bytes: Uint8Array, budget: Budget): Promise<PDFDocument> {
  const parser = PDFParser.forBytesWithOptions(bytes, ParseSpeeds.Slow, true);
  const parseObject = parser.parseObject.bind(parser);
  parser.parseObject = () => {
    const object = parseObject();
    if (!(object instanceof PDFRawStream)) return object;
    const type = object.dict.lookup(PDFName.of("Type"));
    if (type !== PDFName.of("ObjStm") && type !== PDFName.of("XRef")) return object;
    const dict = object.dict.clone();
    dict.delete(PDFName.of("Filter"));
    dict.delete(PDFName.of("DecodeParms"));
    return PDFRawStream.of(dict, boundedDecode(object, budget).decode());
  };
  const context = await parser.parseDocument();
  return new (PDFDocument as unknown as Opening)(context, false, false);
}

async function digest(bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)));
  return "sha256-v1:" + Array.from(hash, (n) => n.toString(16).padStart(2, "0")).join("");
}

/**
 * The pack file attached to a recovery pack PDF. `not_a_pack` names a document that is not a pack
 * at all — not a PDF, no attached file, or one attached file of another name (such as the recovery
 * PDF from before the pack) — so a caller can tell it apart from a pack that was tampered with.
 */
export async function readRecoveryPackPdf(bytes: Uint8Array): Promise<RecoveryPackFile> {
  if (bytes.length === 0 || bytes.length > MAX_PACK_PDF) refuse("size");
  if (!looksLikePdf(bytes)) refuse("not_a_pack");
  let found: { file: Uint8Array; claimed: unknown };
  const budget: Budget = { left: DECODE_BUDGET, exceeded: false };
  try {
    const pdf = await load(bytes, budget);
    const entry = onlyEmbeddedFile(pdf);
    if (entry === undefined || entry.name !== PACK_ATTACHMENT) refuse("not_a_pack");
    const file = contents(entry.spec, budget);
    const info = pdf.context.lookup(pdf.context.trailerInfo.Info, PDFDict);
    found = { file, claimed: info.lookup(PDFName.of("WaitronRecoveryDigest")) };
  } catch (error) {
    // pdf-lib's parser turns a refusal inside it into an error of its own.
    if (budget.exceeded) refuse("size");
    if (error instanceof RecoveryPackFileError) throw error;
    refuse("carrier");
  }
  const claimed =
    found.claimed instanceof PDFString || found.claimed instanceof PDFHexString
      ? found.claimed.decodeText()
      : undefined;
  if (claimed === undefined || !/^sha256-v1:[a-f0-9]{64}$/.test(claimed)) refuse("digest");
  if ((await digest(found.file)) !== claimed) refuse("digest");
  return parseRecoveryPackFile(found.file);
}
