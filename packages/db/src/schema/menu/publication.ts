import { sql } from "drizzle-orm";
import { check, foreignKey, index, primaryKey, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import { persons } from "../identity/persons.js";
import { menus } from "../menus.js";
import { count, enumCheck, enumType, id, json, label, newId, table, ts } from "../columns.js";
import type { MenuDocument } from "@waitron/shared";

/**
 * One fixed version of a menu, published or queued: the whole document, never changed once
 * written.
 */
export const menuVersions = table(
  "menu_versions",
  {
    id: id("id").primaryKey().$defaultFn(newId),
    menuId: id("menu_id").notNull(),
    number: count("number").notNull(),
    document: json<MenuDocument>("document").notNull(),
    contentHash: label("content_hash").notNull(),
    createdAt: ts("created_at").notNull(),
    createdBy: id("created_by").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.menuId],
      foreignColumns: [menus.id],
      name: "menu_versions_menu_fk",
    }),
    foreignKey({
      columns: [t.createdBy],
      foreignColumns: [persons.id],
      name: "menu_versions_created_by_fk",
    }).onDelete("restrict"),
    uniqueIndex("menu_versions_menu_number_uq").on(t.menuId, t.number),
    // A release names a version of its own menu.
    unique("menu_versions_id_menu_key").on(t.id, t.menuId),
    check("menu_versions_number_ck", sql`${t.number} >= 1`),
  ],
);

/**
 * Every photo a version's document names, which media keeps while the version is live or queued.
 */
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

const releaseState = enumType(["queued", "live", "superseded", "cancelled"]);

export const menuReleases = table(
  "menu_releases",
  {
    versionId: id("version_id").primaryKey(),
    menuId: id("menu_id").notNull(),
    state: releaseState("state").notNull(),
    activatesAt: ts("activates_at").notNull(),
    cancelledAt: ts("cancelled_at"),
    cancelledBy: id("cancelled_by"),
  },
  (t) => [
    foreignKey({ columns: [t.menuId], foreignColumns: [menus.id], name: "menu_releases_menu_fk" }),
    foreignKey({
      columns: [t.versionId, t.menuId],
      foreignColumns: [menuVersions.id, menuVersions.menuId],
      name: "menu_releases_version_fk",
    }),
    foreignKey({
      columns: [t.cancelledBy],
      foreignColumns: [persons.id],
      name: "menu_releases_cancelled_by_fk",
    }).onDelete("restrict"),
    check("menu_releases_state_ck", enumCheck(t.state)),
    check(
      "menu_releases_settled_ck",
      sql`(${t.state} = 'cancelled') = (${t.cancelledAt} is not null) and (${t.cancelledAt} is null) = (${t.cancelledBy} is null)`,
    ),
    uniqueIndex("menu_releases_one_live_uq")
      .on(t.menuId)
      .where(sql`${t.state} = 'live'`),
    uniqueIndex("menu_releases_queued_time_uq")
      .on(t.menuId, t.activatesAt)
      .where(sql`${t.state} = 'queued'`),
  ],
);
