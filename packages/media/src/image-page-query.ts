import type { Transaction } from "@waitron/db";
import { asc, desc, eq, sql } from "drizzle-orm";
import { mediaImageEdits, mediaImages } from "./schema/images.js";

export const IMAGE_LIST_COLUMNS = {
  id: mediaImages.id,
  filename: mediaImages.filename,
  names: mediaImages.names,
  createdAt: mediaImages.createdAt,
  updatedAt: mediaImages.updatedAt,
  framing: {
    x: sql<number>`coalesce(${mediaImageEdits.focusX}, 5000)`,
    y: sql<number>`coalesce(${mediaImageEdits.focusY}, 5000)`,
    zoom: sql<number>`coalesce(${mediaImageEdits.zoom}, 100)`,
  },
  revision: sql<number>`coalesce(${mediaImageEdits.revision}, 0)`,
  sourceFilename: sql<string>`coalesce(${mediaImageEdits.sourceHash} || '.webp', ${mediaImages.filename})`,
  originalFilename: mediaImageEdits.originalFilename,
};

export function datedImagePageQuery(
  tx: Transaction,
  direction: "asc" | "desc",
  offset: number,
  limit: number,
) {
  return tx
    .select(IMAGE_LIST_COLUMNS)
    .from(mediaImages)
    .leftJoin(mediaImageEdits, eq(mediaImageEdits.imageId, mediaImages.id))
    .orderBy(
      direction === "asc" ? asc(mediaImages.createdAt) : desc(mediaImages.createdAt),
      asc(mediaImages.id),
    )
    .limit(limit)
    .offset(offset);
}
