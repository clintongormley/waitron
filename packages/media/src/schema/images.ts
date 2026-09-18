import { sql } from "drizzle-orm";
import { check, foreignKey, index, primaryKey, unique } from "drizzle-orm/pg-core";
import { binary, id, json, label, table, ts } from "@waitron/db";

export const mediaImages = table(
  "media_images",
  {
    id: id("id").primaryKey().defaultRandom(),
    filename: label("filename").notNull(),
    names: json<Record<string, string>>("names").notNull(),
    altText: json<Record<string, string>>("alt_text").notNull(),
    labels: label("labels")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("media_images_filename_key").on(t.filename),
    index("media_images_date_idx").on(t.createdAt, t.id),
    check("media_images_filename_ck", sql`${t.filename} ~ '^[a-f0-9]{64}[.](jpg|png|webp)$'`),
    check(
      "media_images_names_ck",
      sql`jsonb_typeof(${t.names}) = 'object' and jsonb_typeof(${t.altText}) = 'object'`,
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
