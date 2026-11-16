import type { StringKey } from "../i18n/strings.js";

export const PREVIEW_MODULE_LABELS = {
  core: "config_preview.module.core",
  menu: "config_preview.module.menu",
  "venue-service": "config_preview.module.venue-service",
  media: "config_preview.module.media",
  identity: "config_preview.module.identity",
  workforce: "config_preview.module.workforce",
  "workforce-es": "config_preview.module.workforce-es",
  adjustments: "config_preview.module.adjustments",
  staffing: "config_preview.module.staffing",
} as const satisfies Record<string, StringKey>;

export const PREVIEW_RECONNECT_LABELS = {
  core: "config_preview.reconnect.core",
} as const satisfies Record<string, StringKey>;
