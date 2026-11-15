import { sql } from "drizzle-orm";
import { check, foreignKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { menus, products } from "../menus.js";
import {
  count,
  jsonShapeCheck,
  enumCheck,
  enumType,
  flag,
  id,
  json,
  label,
  newId,
  table,
} from "../columns.js";
import type { SectionRole } from "@waitron/shared";

// Not in `@waitron/shared`'s menu-document/section-types.ts: the dashboard imports that file, and
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
    internalName: label("internal_name"),
    names: json<Record<string, string>>("names").notNull().default({}),
    role: sectionRole("role").notNull().default("section"),
    ownerMenuId: id("owner_menu_id").notNull(),
    image: label("image"),
    color: label("color"),
  },
  (t) => [
    foreignKey({
      columns: [t.ownerMenuId],
      foreignColumns: [menus.id],
      name: "sections_owner_menu_fk",
    }),
    check("sections_role_ck", enumCheck(t.role)),
    check("sections_root_name_ck", sql`(${t.role} = 'menu_root') = (${t.internalName} is null)`),
    uniqueIndex("sections_one_root_per_menu_uq")
      .on(t.ownerMenuId, t.role)
      .where(sql`${t.role} in ('menu_root','home_layout')`),
    index("sections_owner_menu_idx").on(t.ownerMenuId),
    index("sections_image_idx")
      .on(t.image)
      .where(sql`${t.image} is not null`),
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
    folderNames: json<Record<string, string>>("folder_names"),
    folderImage: label("folder_image"),
    folderImageFixed: flag("folder_image_fixed").notNull().default(false),
    folderColor: label("folder_color"),
    folderColorFixed: flag("folder_color_fixed").notNull().default(false),
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
    check("section_members_folder_names_ck", jsonShapeCheck(t.folderNames, "object")),
    check(
      "section_members_folder_image_ck",
      sql`${t.folderImage} is null or ${t.folderImageFixed} = 1`,
    ),
    check(
      "section_members_folder_color_ck",
      sql`${t.folderColor} is null or ${t.folderColorFixed} = 1`,
    ),
    index("section_members_folder_image_idx")
      .on(t.folderImage)
      .where(sql`${t.folderImage} is not null`),
  ],
);
