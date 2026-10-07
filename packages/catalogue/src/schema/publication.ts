import { sql } from "drizzle-orm";
import { check, foreignKey, index, primaryKey, unique, uniqueIndex } from "drizzle-orm/sqlite-core";
import {
  catalogues,
  count,
  enumCheck,
  enumType,
  id,
  json,
  label,
  newId,
  table,
  ts,
} from "@waitron/db";
import type { MenuDocument } from "../menu-document-types.js";

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
    publishedAt: ts("published_at").notNull(),
    // The management session's person id, as plain text with no key: persons belong to the
    // identity module, which catalogue does not require.
    publishedBy: id("published_by").notNull(),
  },
  (t) => [
    foreignKey({
      columns: [t.menuId],
      foreignColumns: [catalogues.id],
      name: "menu_versions_menu_fk",
    }),
    uniqueIndex("menu_versions_menu_number_uq").on(t.menuId, t.number),
    // The target of menu_publications_version_fk and menu_scheduled_publications_version_fk: each
    // names a version of its own menu.
    unique("menu_versions_id_menu_key").on(t.id, t.menuId),
    check("menu_versions_number_ck", sql`${t.number} >= 1`),
  ],
);

/**
 * Each published menu's last settled live version; a queued edition whose time has come is live
 * before it lands here.
 */
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

const scheduleState = enumType(["queued", "activated", "cancelled"]);

/**
 * One edition queued to go live at a later time; an immediately published version has none. Its
 * content is the `menu_versions` row, fixed when it was queued.
 */
export const menuScheduledPublications = table(
  "menu_scheduled_publications",
  {
    versionId: id("version_id").primaryKey(),
    menuId: id("menu_id").notNull(),
    activatesAt: ts("activates_at").notNull(),
    queuedAt: ts("queued_at").notNull(),
    // Plain person ids with no key, for the reason menu_versions.published_by gives.
    queuedBy: id("queued_by").notNull(),
    state: scheduleState("state").notNull().default("queued"),
    activatedAt: ts("activated_at"),
    cancelledAt: ts("cancelled_at"),
    cancelledBy: id("cancelled_by"),
  },
  (t) => [
    foreignKey({
      columns: [t.menuId],
      foreignColumns: [catalogues.id],
      name: "menu_scheduled_publications_menu_fk",
    }),
    foreignKey({
      columns: [t.versionId, t.menuId],
      foreignColumns: [menuVersions.id, menuVersions.menuId],
      name: "menu_scheduled_publications_version_fk",
    }),
    check("menu_scheduled_publications_state_ck", enumCheck(t.state)),
    check(
      "menu_scheduled_publications_settled_ck",
      sql`(${t.state} = 'queued' and ${t.activatedAt} is null and ${t.cancelledAt} is null and ${t.cancelledBy} is null) or (${t.state} = 'activated' and ${t.activatedAt} is not null and ${t.cancelledAt} is null and ${t.cancelledBy} is null) or (${t.state} = 'cancelled' and ${t.cancelledAt} is not null and ${t.cancelledBy} is not null and ${t.activatedAt} is null)`,
    ),
    // Text order is time order: every ts column is written as Date.toISOString().
    check("menu_scheduled_publications_after_queue_ck", sql`${t.activatesAt} > ${t.queuedAt}`),
    // Two queued editions at one instant would leave the lower number hidden for ever.
    uniqueIndex("menu_scheduled_publications_queued_time_uq")
      .on(t.menuId, t.activatesAt)
      .where(sql`${t.state} = 'queued'`),
  ],
);
