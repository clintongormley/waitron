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
    // SQLite has no regex operator, so the PostgreSQL `~ '^[a-f0-9]{64}[.](jpg|png|webp)$'` is
    // composed from GLOB, which is case-sensitive, and substr. The extension test pins the total
    // length, so the 64-character hex prefix needs no separate length check. Measured 2026-09-21,
    // fifteen values inserted into a real PGlite table carrying the regex and a real `node:sqlite`
    // table carrying this: the two engines agreed on every one — three good filenames (one per
    // extension) accepted, and an upper-case hex prefix, an upper-case extension, a 63-character
    // and a 65-character prefix, a non-hex `z`, a non-hex `]`, a `.gif`, a bare hex name, a
    // dotless `xjpg` suffix, a trailing newline, a leading newline and the empty string all
    // refused.
    check(
      "media_images_filename_ck",
      sql`substr(${t.filename}, 1, 64) not glob '*[^0-9a-f]*' and (substr(${t.filename}, 65) glob '.jpg' or substr(${t.filename}, 65) glob '.png' or substr(${t.filename}, 65) glob '.webp')`,
    ),
    // `json_type` in place of `jsonb_typeof`. Measured 2026-09-21, the same seven values inserted
    // into a real PGlite table (a `jsonb` column under `jsonb_typeof(...) = 'object'`) and a real
    // `node:sqlite` table (this): the two agreed on every one — an object and an empty object
    // accepted, an array, a string, a number, `{not json` and the empty string refused. What
    // differs is WHICH layer refuses bytes that are not JSON and what it says. On PostgreSQL the
    // `jsonb` column type refused them before the constraint ran (22P02, "invalid input syntax for
    // type json"); here the column is plain text, so they reach `json_type`, which raises
    // "malformed JSON" — a SQLITE_ERROR, not a CHECK-constraint failure. Code matching on the
    // refusal rather than just catching it sees a different error for that one class.
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
