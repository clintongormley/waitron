import { sql } from "drizzle-orm";
import { check, foreignKey, index, unique } from "drizzle-orm/sqlite-core";
import {
  binary,
  count,
  enumText,
  enumCheck,
  id,
  json,
  label,
  newId,
  now,
  table,
  ts,
} from "../columns.js";

export const mediaImages = table(
  "media_images",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    filename: label("filename").notNull(),
    names: json<Record<string, string>>("names").notNull(),
    createdAt: ts("created_at").notNull().$defaultFn(now),
    updatedAt: ts("updated_at").notNull().$defaultFn(now),
    originalHash: label("original_hash").notNull(),
    sourceHash: label("source_hash"),
    focusX: count("focus_x").notNull().default(5000),
    focusY: count("focus_y").notNull().default(5000),
    zoom: count("zoom").notNull().default(100),
    revision: count("revision").notNull().default(1),
    originalFilename: label("original_filename"),
  },
  (t) => [
    unique("media_images_filename_key").on(t.filename),
    index("media_images_date_idx").on(t.createdAt, t.id),
    check(
      "media_images_filename_ck",
      sql`length(${t.filename}) = length(cast(${t.filename} as blob)) and substr(${t.filename}, 1, 64) not glob '*[^0-9a-f]*' and (substr(${t.filename}, 65) glob '.jpg' or substr(${t.filename}, 65) glob '.png' or substr(${t.filename}, 65) glob '.webp')`,
    ),
    // The column is plain text, so text that is not JSON reaches `json_type`, which raises
    // "malformed JSON" — a SQLITE_ERROR, not a CHECK-constraint failure.
    check("media_images_names_ck", sql`json_type(${t.names}) = 'object'`),
    foreignKey({
      name: "media_images_original_fk",
      columns: [t.originalHash],
      foreignColumns: [mediaBlobs.hash],
    }).onDelete("restrict"),
    foreignKey({
      name: "media_images_source_fk",
      columns: [t.sourceHash],
      foreignColumns: [mediaBlobs.hash],
    }).onDelete("restrict"),
    check("media_images_original_hash_ck", sql`${t.originalHash} = substr(${t.filename}, 1, 64)`),
    check(
      "media_images_focus_x_ck",
      sql`typeof(${t.focusX}) = 'integer' and ${t.focusX} between 0 and 10000`,
    ),
    check(
      "media_images_focus_y_ck",
      sql`typeof(${t.focusY}) = 'integer' and ${t.focusY} between 0 and 10000`,
    ),
    check(
      "media_images_zoom_ck",
      sql`typeof(${t.zoom}) = 'integer' and ${t.zoom} between 100 and 400`,
    ),
    check(
      "media_images_revision_ck",
      sql`typeof(${t.revision}) = 'integer' and ${t.revision} between 1 and 9007199254740991`,
    ),
    check(
      "media_images_original_filename_ck",
      sql`${t.originalFilename} is null or (length(${t.originalFilename}) <= 255 and instr(${t.originalFilename}, char(0)) = 0 and instr(${t.originalFilename}, char(10)) = 0 and instr(${t.originalFilename}, char(13)) = 0)`,
    ),
  ],
);

export const mediaBlobs = table(
  "media_blobs",
  {
    hash: label("hash").primaryKey(),
    format: enumText("format", ["jpg", "png", "webp"]).notNull(),
    bytes: binary("bytes").notNull(),
  },
  (t) => [
    check("media_blobs_format_ck", enumCheck(t.format)),
    check(
      "media_blobs_hash_ck",
      sql`length(${t.hash}) = 64 and ${t.hash} not glob '*[^0-9a-f]*' and instr(${t.hash}, char(0)) = 0`,
    ),
  ],
);
