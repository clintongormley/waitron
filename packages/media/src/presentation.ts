import { eq, inArray } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError, MEDIA_FILENAME } from "@waitron/shared";
import { IMAGE_LIST_COLUMNS } from "./image-page-query.js";
import { mediaImageEdits, mediaImages } from "./schema/images.js";
import { validateFraming, type ImageFraming } from "./framing.js";
import type { RenditionShape } from "./renditions.js";
import "./errors.js";

export function renditionUrl(
  sourceFilename: string,
  shape: RenditionShape,
  framing: ImageFraming,
): string {
  return `/media/renditions/v1/${sourceFilename}/${shape}/${framing.x}-${framing.y}-${framing.zoom}.webp`;
}
export function parseRendition(version: string, source: string, shape: string, frame: string) {
  if (
    version !== "v1" ||
    !MEDIA_FILENAME.test(source) ||
    !["square", "till", "display"].includes(shape)
  )
    return null;
  const match = /^(0|[1-9]\d*)-(0|[1-9]\d*)-(0|[1-9]\d*)\.webp$/.exec(frame);
  if (!match) return null;
  try {
    const framing = validateFraming({
      x: Number(match[1]),
      y: Number(match[2]),
      zoom: Number(match[3]),
    });
    return { source, shape: shape as RenditionShape, framing };
  } catch {
    return null;
  }
}
export function parsePresentationQuery(query: Record<string, string[]>): string[] {
  if (Object.keys(query).length !== 1 || query.references?.length !== 1)
    throw new AppError("image.invalid_query", {});
  const references = query.references[0]!.split(",");
  if (
    references.length > 100 ||
    new Set(references).size !== references.length ||
    references.some((ref) => !MEDIA_FILENAME.test(ref))
  )
    throw new AppError("image.invalid_query", {});
  return references;
}
export async function readPresentations(tx: Transaction, references: string[]) {
  const rows = await tx
    .select(IMAGE_LIST_COLUMNS)
    .from(mediaImages)
    .leftJoin(mediaImageEdits, eq(mediaImageEdits.imageId, mediaImages.id))
    .where(inArray(mediaImages.filename, references));
  return Object.fromEntries(
    rows.map((row) => [
      row.filename,
      {
        id: row.id,
        revision: row.revision,
        source: `/media/${row.sourceFilename}`,
        square: renditionUrl(row.sourceFilename, "square", row.framing),
        till: renditionUrl(row.sourceFilename, "till", row.framing),
        display: renditionUrl(row.sourceFilename, "display", row.framing),
      },
    ]),
  );
}
