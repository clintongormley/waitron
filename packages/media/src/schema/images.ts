import { sql } from "drizzle-orm";
import { check, foreignKey, index, primaryKey, unique } from "drizzle-orm/sqlite-core";
import { binary, id, json, label, labelList, newId, now, table, ts } from "@waitron/db";

export const mediaImages = table(
  "media_images",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    filename: label("filename").notNull(),
    names: json<Record<string, string>>("names").notNull(),
    altText: json<Record<string, string>>("alt_text").notNull(),
    labels: labelList("labels").notNull().default([]),
    createdAt: ts("created_at").notNull().$defaultFn(now),
    updatedAt: ts("updated_at").notNull().$defaultFn(now),
  },
  (t) => [
    unique("media_images_filename_key").on(t.filename),
    index("media_images_date_idx").on(t.createdAt, t.id),
    // SQLite's `REGEXP` has no implementation unless the connection registers one, so this is
    // composed from GLOB, which is case-sensitive, and substr. The extension test pins the length
    // up to any embedded NUL, where `substr` stops reading, so the 64-character hex prefix needs no
    // separate length check.
    check(
      "media_images_filename_ck",
      sql`substr(${t.filename}, 1, 64) not glob '*[^0-9a-f]*' and (substr(${t.filename}, 65) glob '.jpg' or substr(${t.filename}, 65) glob '.png' or substr(${t.filename}, 65) glob '.webp')`,
    ),
    // The column is plain text, so text that is not JSON reaches `json_type`, which raises
    // "malformed JSON" — a SQLITE_ERROR, not a CHECK-constraint failure.
    check(
      "media_images_names_ck",
      sql`json_type(${t.names}) = 'object' and json_type(${t.altText}) = 'object'`,
    ),
  ],
);

// Bytes live separately so metadata reads and change subscriptions never select a photo payload.
export const mediaImageData = table(
  "media_image_data",
  {
    imageId: id("image_id").notNull(),
    bytes: binary("bytes").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.imageId] }),
    foreignKey({
      name: "media_image_data_image_fk",
      columns: [t.imageId],
      foreignColumns: [mediaImages.id],
    }).onDelete("cascade"),
  ],
);
