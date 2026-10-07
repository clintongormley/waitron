import { sql } from "drizzle-orm";
import { check, foreignKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  catalogues,
  count,
  enumCheck,
  enumType,
  flag,
  id,
  json,
  label,
  newId,
  products,
  table,
} from "@waitron/db";
import type { IncludeFolderOverrides, SectionRole } from "../section-types.js";

// Not in section-types.ts: the dashboard imports that file, and
// scripts/dashboard-browser-purity.test.ts refuses a runtime value in it.
const SECTION_ROLES = [
  "section",
  "menu_root",
  "home_layout",
] as const satisfies readonly SectionRole[];
// Fails to compile when SectionRole gains a role this list (and so the column's check) lacks.
const everyRoleListed: SectionRole extends (typeof SECTION_ROLES)[number] ? true : never = true;
void everyRoleListed;
const sectionRole = enumType(SECTION_ROLES);

/** An ordered list of products and other sections. A reporting category is not a section. */
export const sections = table(
  "sections",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    internalName: label("internal_name").notNull(),
    names: json<Record<string, string>>("names").notNull().default({}),
    role: sectionRole("role").notNull().default("section"),
    ownerMenuId: id("owner_menu_id").notNull(),
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
    missingName: label("missing_name"),
    showAsFolder: flag("show_as_folder").notNull().default(true),
    folderOverrides: json<IncludeFolderOverrides>("folder_overrides").notNull().default({}),
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
      sql`(${t.productId} is null or ${t.childSectionId} is null) and ((${t.productId} is null and ${t.childSectionId} is null) = (${t.missingName} is not null))`,
    ),
    uniqueIndex("section_members_product_uq").on(t.sectionId, t.productId),
    uniqueIndex("section_members_child_uq").on(t.sectionId, t.childSectionId),
    index("section_members_order_idx").on(t.sectionId, t.position),
    index("section_members_child_idx").on(t.childSectionId),
    index("section_members_product_idx").on(t.productId),
    // `->>`, not `json_extract(…, …)`: drizzle-kit splits an index expression at its commas. SQLite
    // uses the index only for this exact expression, which the media photo triggers and reads
    // repeat. A drizzle-kit table rebuild writes an expression index back wrongly: take this out for
    // any generation that rebuilds the table and add it back in one of its own (CLAUDE.md §3).
    index("section_members_folder_image_idx")
      .on(sql`${t.folderOverrides} ->> '$.image'`)
      .where(sql`${t.folderOverrides} ->> '$.image' is not null`),
  ],
);
