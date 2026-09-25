import { sql } from "drizzle-orm";
import { check, foreignKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  catalogues,
  count,
  enumCheck,
  enumType,
  id,
  json,
  label,
  newId,
  products,
  table,
} from "@waitron/db";
import type { SectionRole } from "../section-types.js";

// Kept out of section-types.ts, which the dashboard imports and so must hold types alone.
const SECTION_ROLES = [
  "library",
  "menu_root",
  "home_layout",
] as const satisfies readonly SectionRole[];
const sectionRole = enumType(SECTION_ROLES);

/** An ordered list of products and other sections. A reporting category is not a section. */
export const sections = table(
  "sections",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    internalName: label("internal_name").notNull(),
    names: json<Record<string, string>>("names").notNull().default({}),
    role: sectionRole("role").notNull().default("library"),
    ownerMenuId: id("owner_menu_id"),
    image: label("image"),
    color: label("color"),
  },
  (t) => [
    foreignKey({
      columns: [t.ownerMenuId],
      foreignColumns: [catalogues.id],
      name: "sections_owner_menu_fk",
    }),
    check("sections_role_ck", enumCheck(t.role)),
    check("sections_owner_ck", sql`(${t.role} = 'library') = (${t.ownerMenuId} is null)`),
    index("sections_owner_menu_idx").on(t.ownerMenuId),
  ],
);

/** One place in one list. Positions are not unique; a tie sorts by `id`. */
export const sectionMembers = table(
  "section_members",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    sectionId: id("section_id").notNull(),
    position: count("position").notNull(),
    productId: id("product_id"),
    childSectionId: id("child_section_id"),
  },
  (t) => [
    foreignKey({
      columns: [t.sectionId],
      foreignColumns: [sections.id],
      name: "section_members_section_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.productId],
      foreignColumns: [products.id],
      name: "section_members_product_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.childSectionId],
      foreignColumns: [sections.id],
      name: "section_members_child_fk",
    }).onDelete("cascade"),
    check(
      "section_members_one_ref_ck",
      sql`(${t.productId} is null) <> (${t.childSectionId} is null)`,
    ),
    uniqueIndex("section_members_product_uq").on(t.sectionId, t.productId),
    uniqueIndex("section_members_child_uq").on(t.sectionId, t.childSectionId),
    index("section_members_order_idx").on(t.sectionId, t.position),
    index("section_members_child_idx").on(t.childSectionId),
    index("section_members_product_idx").on(t.productId),
  ],
);
