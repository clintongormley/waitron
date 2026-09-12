import { tenants } from "@waitron/db";
import { sql } from "drizzle-orm";
import {
  check,
  customType,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => new Uint8Array(value),
});

export const mediaImages = pgTable(
  "media_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id),
    filename: text("filename").notNull(),
    names: jsonb("names").$type<Record<string, string>>().notNull(),
    altText: jsonb("alt_text").$type<Record<string, string>>().notNull(),
    labels: text("labels")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    unique("media_images_tenant_filename_key").on(t.tenantId, t.filename),
    unique("media_images_tenant_id_key").on(t.tenantId, t.id),
    index("media_images_tenant_date_idx").on(t.tenantId, t.createdAt, t.id),
    check("media_images_filename_ck", sql`${t.filename} ~ '^[a-f0-9]{64}[.](jpg|png|webp)$'`),
    check(
      "media_images_names_ck",
      sql`jsonb_typeof(${t.names}) = 'object' and jsonb_typeof(${t.altText}) = 'object'`,
    ),
  ],
);

// Bytes live separately so metadata reads and change subscriptions never select a photo payload.
export const mediaImageData = pgTable(
  "media_image_data",
  {
    tenantId: uuid("tenant_id").notNull(),
    imageId: uuid("image_id").notNull(),
    bytes: bytea("bytes").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.imageId] }),
    foreignKey({
      name: "media_image_data_image_fk",
      columns: [t.tenantId, t.imageId],
      foreignColumns: [mediaImages.tenantId, mediaImages.id],
    }).onDelete("cascade"),
  ],
);
