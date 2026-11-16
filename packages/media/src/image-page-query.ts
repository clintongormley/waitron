import type { Transaction } from "@waitron/db";
import { asc, desc, sql } from "drizzle-orm";
import { mediaImages } from "@waitron/db";

export const IMAGE_LIST_COLUMNS = {
  id: mediaImages.id,
  filename: mediaImages.filename,
  names: mediaImages.names,
  createdAt: mediaImages.createdAt,
  updatedAt: mediaImages.updatedAt,
  framing: {
    x: mediaImages.focusX,
    y: mediaImages.focusY,
    zoom: mediaImages.zoom,
  },
  revision: mediaImages.revision,
  sourceFilename: sql<string>`coalesce(${mediaImages.sourceHash} || '.webp', ${mediaImages.filename})`,
  originalFilename: mediaImages.originalFilename,
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
    .orderBy(
      direction === "asc" ? asc(mediaImages.createdAt) : desc(mediaImages.createdAt),
      asc(mediaImages.id),
    )
    .limit(limit)
    .offset(offset);
}
