import { sql } from "drizzle-orm";
import { check, foreignKey, index, primaryKey, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { catalogues, count, id, json, label, newId, table, ts } from "@waitron/db";
import type { MenuDocument } from "../menu-document-types.js";

/** One published version of a menu: the whole document, never changed once written. */
export const menuVersions = table(
  "menu_versions",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    menuId: id("menu_id").notNull(),
    number: count("number").notNull(),
    document: json<MenuDocument>("document").notNull(),
    contentHash: label("content_hash").notNull(),
    publishedAt: ts("published_at").notNull(),
    // The management session's person id, as plain text with no key: persons belong to the
    // identity module, which catalogue does not require.
    publishedBy: label("published_by").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.menuId],
      foreignColumns: [catalogues.id],
      name: "menu_versions_menu_fk",
    }),
    uniqueIndex("menu_versions_menu_number_uq").on(t.menuId, t.number),
    // The target of menu_publications_version_fk: a publication names a version of its own menu.
    unique("menu_versions_id_menu_key").on(t.id, t.menuId),
    check("menu_versions_number_ck", sql`${t.number} >= 1`),
  ],
);

/** Each published menu's live version. */
export const menuPublications = table(
  "menu_publications",
  {
    menuId: id("menu_id").primaryKey(),
    versionId: id("version_id").notNull(),
    publishedAt: ts("published_at").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.menuId],
      foreignColumns: [catalogues.id],
      name: "menu_publications_menu_fk",
    }),
    foreignKey({
      columns: [t.versionId, t.menuId],
      foreignColumns: [menuVersions.id, menuVersions.menuId],
      name: "menu_publications_version_fk",
    }),
  ],
);

/** Every photo a version's document names, which media keeps while the version is live. */
export const menuVersionImages = table(
  "menu_version_images",
  {
    versionId: id("version_id").notNull(),
    filename: label("filename").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.versionId, t.filename], name: "menu_version_images_pk" }),
    foreignKey({
      columns: [t.versionId],
      foreignColumns: [menuVersions.id],
      name: "menu_version_images_version_fk",
    }),
    // Media's delete and rename triggers look a photo up by name.
    index("menu_version_images_filename_idx").on(t.filename),
  ],
);
