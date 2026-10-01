import type { Transaction } from "@waitron/db";
import { asc, desc } from "drizzle-orm";
import { mediaImages } from "./schema/images.js";

export const IMAGE_LIST_COLUMNS = {
  id: mediaImages.id,
  filename: mediaImages.filename,
  names: mediaImages.names,
  createdAt: mediaImages.createdAt,
  updatedAt: mediaImages.updatedAt,
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
