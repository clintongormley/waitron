import { eq, sql } from "drizzle-orm";
import { nowIso, type Transaction } from "@waitron/db";
import { departmentReceipts } from "@waitron/venue-service";
import { AppError, type ReceiptLogoRasters } from "@waitron/shared";
import { validateFraming, type ImageEditInput } from "./framing.js";
import { readImage, readImageBytes, validateImageMetadata, type ImageRecord } from "./images.js";
import { mediaImageBlobs, mediaImageEdits, mediaImages } from "./schema/images.js";
import { imageFilename } from "./stored-filename.js";
import type { PreparedImage } from "./prepare.js";
import "./errors.js";

export function normalizeUploadFilename(input: unknown): string | null {
  if (input === undefined || input === null) return null;
  if (typeof input !== "string") throw new AppError("image.invalid_metadata", {});
  const basename = input.split(/[\\/]/).at(-1)!;
  if (!basename || basename.length > 255 || /[\0\r\n]/.test(basename))
    throw new AppError("image.invalid_metadata", {});
  return basename;
}

export async function saveImage(
  tx: Transaction,
  id: string,
  edit: ImageEditInput,
  prepared: PreparedImage | null,
  rasters: ReceiptLogoRasters | undefined,
  fallbackLanguage: string,
): Promise<ImageRecord> {
  const current = await readImage(tx, id);
  if (
    !Number.isSafeInteger(edit.expectedRevision) ||
    edit.expectedRevision < 0 ||
    edit.expectedRevision >= Number.MAX_SAFE_INTEGER
  )
    throw new AppError("image.invalid_metadata", {});
  if (edit.expectedRevision !== current.revision)
    throw new AppError("image.changed", { imageId: id });
  const framing = validateFraming(edit.framing);
  const metadata = await validateImageMetadata(tx, edit, fallbackLanguage);
  const originalFilename =
    edit.originalFilename === undefined
      ? current.originalFilename
      : normalizeUploadFilename(edit.originalFilename);
  const sourceFilename = prepared?.filename ?? current.sourceFilename;
  const pixelsChanged =
    sourceFilename !== current.sourceFilename ||
    framing.x !== current.framing.x ||
    framing.y !== current.framing.y ||
    framing.zoom !== current.framing.zoom;
  if (prepared) {
    if (imageFilename(prepared.bytes) !== prepared.filename || !prepared.filename.endsWith(".webp"))
      throw new AppError("image.invalid_file", {});
    const existing = await readImageBytes(tx, prepared.filename);
    if (existing && !Buffer.from(existing.bytes).equals(prepared.bytes))
      throw new AppError("image.hash_conflict", { filename: prepared.filename });
    const hash = prepared.filename.slice(0, 64);
    const [blob] = await tx
      .select({ bytes: mediaImageBlobs.bytes })
      .from(mediaImageBlobs)
      .where(eq(mediaImageBlobs.hash, hash));
    if (blob && !Buffer.from(blob.bytes).equals(prepared.bytes))
      throw new AppError("image.hash_conflict", { filename: prepared.filename });
    if (!blob) await tx.insert(mediaImageBlobs).values({ hash, bytes: prepared.bytes });
  }
  // Match inside the write transaction: a logo may have been attached while pixels were prepared.
  const logoMatch = sql`case when json_valid(${departmentReceipts.receipt}) then
    case when json_type(${departmentReceipts.receipt}) = 'object' and json_type(${departmentReceipts.receipt}, '$.logo') = 'text'
    then json_extract(${departmentReceipts.receipt}, '$.logo') else null end else null end = ${current.filename}`;
  if (pixelsChanged) {
    const users = await tx
      .select({ id: departmentReceipts.departmentId })
      .from(departmentReceipts)
      .where(logoMatch);
    if (users.length && (!rasters?.["58mm"] || !rasters["80mm"]))
      throw new Error("Receipt logo requires both printable pictures");
    if (users.length)
      await tx
        .update(departmentReceipts)
        .set({ logoRasters: rasters!, updatedAt: nowIso() })
        .where(logoMatch);
  }
  await tx
    .update(mediaImages)
    .set({ ...metadata, updatedAt: new Date() })
    .where(eq(mediaImages.id, id));
  const values = {
    sourceHash: sourceFilename === current.filename ? null : sourceFilename.slice(0, 64),
    focusX: framing.x,
    focusY: framing.y,
    zoom: framing.zoom,
    revision: current.revision + 1,
    originalFilename,
  };
  await tx
    .insert(mediaImageEdits)
    .values({ imageId: id, ...values })
    .onConflictDoUpdate({ target: mediaImageEdits.imageId, set: values });
  return readImage(tx, id);
}

export async function readCurrentImageMetadata(tx: Transaction, reference: string) {
  const [row] = await tx
    .select({ id: mediaImages.id })
    .from(mediaImages)
    .where(eq(mediaImages.filename, reference));
  if (!row) return null;
  const current = await readImage(tx, row.id);
  return {
    imageId: current.id,
    revision: current.revision,
    sourceFilename: current.sourceFilename,
    framing: current.framing,
  };
}

export async function readCurrentImage(tx: Transaction, reference: string) {
  const current = await readCurrentImageMetadata(tx, reference);
  if (!current) return null;
  const source = await readImageBytes(tx, current.sourceFilename);
  return source && { ...current, bytes: source.bytes };
}
