import { validateMediaConfiguration } from "./configuration-transfer.js";
import { MEDIA_ROUTES } from "./routes.js";
import { listImageTranslationGaps } from "./images.js";
import type { ModulePermission, WaitronModule } from "@waitron/module";
import type { ChangeSource } from "@waitron/shared";
import { MEDIA_CLASSIFICATION } from "./classification.js";
import { MEDIA_BACKUP_VERIFICATION } from "./backup-verification.js";
export { MEDIA_CLASSIFICATION } from "./classification.js";

export const MEDIA_CHANGE_SOURCES: readonly ChangeSource[] = [
  { table: "media_images", type: "media_images" },
];
export const MEDIA_CONFIGURATION_TRANSFER = {
  kind: "tables",
  validate: validateMediaConfiguration,
  tables: [
    {
      name: "media_images",
      before: ["media_image_edits", "products", "sections", "section_members"],
    },
    { name: "media_image_data", before: ["products", "sections", "section_members"] },
    { name: "media_image_blobs", before: ["media_image_edits"] },
    { name: "media_image_edits", before: ["products", "sections", "section_members"] },
  ],
} as const;
export const MEDIA_PERMISSIONS: readonly ModulePermission[] = [
  { permission: "image.manage", grantedFrom: "manager" },
];
export const MEDIA_MODULE: WaitronModule = {
  name: "media",
  version: "0.0.0",
  tier: "mandatory",
  requires: { core: "*", modules: { catalogue: "*", "venue-service": "*" } },
  migrations: { name: "media", table: "__drizzle_migrations_media", from: "../media/drizzle" },
  classification: MEDIA_CLASSIFICATION,
  backup: { verification: MEDIA_BACKUP_VERIFICATION },
  changes: MEDIA_CHANGE_SOURCES,
  configurationTransfer: MEDIA_CONFIGURATION_TRANSFER,
  permissions: MEDIA_PERMISSIONS,
  routes: MEDIA_ROUTES,
  contentTranslations: { gaps: listImageTranslationGaps },
};
