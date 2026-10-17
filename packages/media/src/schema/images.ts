import { sql } from "drizzle-orm";
import { check, foreignKey, index, primaryKey, unique } from "drizzle-orm/sqlite-core";
import { binary, count, id, json, label, newId, now, table, ts } from "@waitron/db";

export const mediaImages = table(
  "media_images",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    filename: label("filename").notNull(),
    names: json<Record<string, string>>("names").notNull(),
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
    check("media_images_names_ck", sql`json_type(${t.names}) = 'object'`),
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

export const mediaImageBlobs = table(
  "media_image_blobs",
  {
    hash: label("hash").primaryKey(),
    bytes: binary("bytes").notNull(),
  },
  (t) => [
    check(
      "media_image_blobs_hash_ck",
      sql`length(${t.hash}) = 64 and ${t.hash} not glob '*[^0-9a-f]*' and instr(${t.hash}, char(0)) = 0`,
    ),
  ],
);

export const mediaImageEdits = table(
  "media_image_edits",
  {
    imageId: id("image_id").primaryKey(),
    sourceHash: label("source_hash"),
    focusX: count("focus_x").notNull().default(5000),
    focusY: count("focus_y").notNull().default(5000),
    zoom: count("zoom").notNull().default(100),
    revision: count("revision").notNull().default(1),
    originalFilename: label("original_filename"),
  },
  (t) => [
    foreignKey({
      name: "media_image_edits_image_fk",
      columns: [t.imageId],
      foreignColumns: [mediaImages.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "media_image_edits_source_fk",
      columns: [t.sourceHash],
      foreignColumns: [mediaImageBlobs.hash],
    }).onDelete("restrict"),
    check(
      "media_image_edits_focus_x_ck",
      sql`typeof(${t.focusX}) = 'integer' and ${t.focusX} between 0 and 10000`,
    ),
    check(
      "media_image_edits_focus_y_ck",
      sql`typeof(${t.focusY}) = 'integer' and ${t.focusY} between 0 and 10000`,
    ),
    check(
      "media_image_edits_zoom_ck",
      sql`typeof(${t.zoom}) = 'integer' and ${t.zoom} between 100 and 400`,
    ),
    check(
      "media_image_edits_revision_ck",
      sql`typeof(${t.revision}) = 'integer' and ${t.revision} between 1 and 9007199254740991`,
    ),
    check(
      "media_image_edits_filename_ck",
      sql`${t.originalFilename} is null or (length(${t.originalFilename}) <= 255 and instr(${t.originalFilename}, char(0)) = 0 and instr(${t.originalFilename}, char(10)) = 0 and instr(${t.originalFilename}, char(13)) = 0)`,
    ),
  ],
);
