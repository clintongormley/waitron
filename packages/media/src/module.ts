import { validateMediaConfiguration } from "./configuration-transfer.js";
import { MEDIA_ROUTES } from "./routes.js";
import { listImageTranslationGaps } from "./images.js";
import type { ModulePermission, WaitronModule } from "@waitron/module";
import type { ChangeSource } from "@waitron/shared";
import { classify, type ClassifiedTable } from "@waitron/sync-enrolment";

export const MEDIA_CLASSIFICATION: readonly ClassifiedTable[] = [
  classify("media_images", "state", "shared image metadata; copied to standbys"),
  classify("media_image_data", "state", "shared image bytes; copied to standbys"),
];
export const MEDIA_CHANGE_SOURCES: readonly ChangeSource[] = [
  { table: "media_images", type: "media_images" },
];
export const MEDIA_CONFIGURATION_TRANSFER = {
  kind: "tables",
  validate: validateMediaConfiguration,
  tables: [
    { name: "media_images", before: ["products"] },
    { name: "media_image_data", before: ["products"] },
  ],
} as const;
export const MEDIA_PERMISSIONS: readonly ModulePermission[] = [
  { permission: "image.manage", grantedFrom: "manager" },
];
export const MEDIA_MODULE: WaitronModule = {
  name: "media",
  version: "0.0.0",
  tier: "mandatory",
  requires: { core: "*", modules: { catalogue: "*" } },
  migrations: { name: "media", table: "__drizzle_migrations_media", from: "../media/drizzle" },
  classification: MEDIA_CLASSIFICATION,
  changes: MEDIA_CHANGE_SOURCES,
  configurationTransfer: MEDIA_CONFIGURATION_TRANSFER,
  permissions: MEDIA_PERMISSIONS,
  routes: MEDIA_ROUTES,
  contentTranslations: { gaps: listImageTranslationGaps },
};
