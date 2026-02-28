import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  customType,
  index,
  unique,
} from "drizzle-orm/pg-core";

// Custom type for PostgreSQL tsvector
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export const searchIndex = pgTable(
  "search_index",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull(),
    entityType: varchar("entity_type", { length: 50 }).notNull(), // menu_item, order, booking
    entityId: uuid("entity_id").notNull(),
    content: tsvector("content").notNull(),
    metadata: varchar("metadata", { length: 1000 }), // JSON string of display fields
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("search_index_entity_unique").on(t.entityId, t.entityType),
    index("search_index_content_idx").using("gin", t.content),
    index("search_index_tenant_type_idx").on(t.tenantId, t.entityType),
  ],
);
