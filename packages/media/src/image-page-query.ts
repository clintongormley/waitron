import type { Transaction } from "@waitron/db";
import { asc, desc, inArray, sql } from "drizzle-orm";
import { mediaImages } from "./schema/images.js";

export const IMAGE_LIST_COLUMNS = {
  id: mediaImages.id,
  filename: mediaImages.filename,
  names: mediaImages.names,
  altText: mediaImages.altText,
  labels: mediaImages.labels,
  createdAt: mediaImages.createdAt,
  updatedAt: mediaImages.updatedAt,
};

// null leaves the list unfiltered; [] matches no image. Other values are stored label spellings.
export function imageLabelCondition(labels: string[] | null) {
  if (labels === null) return undefined;
  if (labels.length === 0) return sql`false`;
  return sql`exists (select 1 from json_each(${mediaImages.labels}) as image_label where ${inArray(sql<string>`image_label.value`, labels)})`;
}

export function datedImagePageQuery(
  tx: Transaction,
  labels: string[] | null,
  direction: "asc" | "desc",
  offset: number,
  limit: number,
) {
  return tx
    .select(IMAGE_LIST_COLUMNS)
    .from(mediaImages)
    .where(imageLabelCondition(labels))
    .orderBy(
      direction === "asc" ? asc(mediaImages.createdAt) : desc(mediaImages.createdAt),
      asc(mediaImages.id),
    )
    .limit(limit)
    .offset(offset);
}
