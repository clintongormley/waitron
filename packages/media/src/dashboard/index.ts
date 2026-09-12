import { html } from "lit";
import type { DashboardContribution } from "@waitron/dashboard-kit";
import { ImageApi } from "./client.js";
import { MEDIA_STRINGS } from "./strings.js";
import "./image-library.js";
import "./image-picker.js";

export { ImageApi } from "./client.js";
export type { LibraryImage, ImageMetadata, ImageUsage } from "./client.js";
export const MEDIA_DASHBOARD: DashboardContribution = {
  module: "media",
  screen: {
    id: "images",
    navLabelKey: "nav.images",
    group: "menu",
    requiresPermission: "image.manage",
  },
  strings: MEDIA_STRINGS,
  create(ctx) {
    const api = new ImageApi(ctx.request, ctx.liveData);
    return { render: () => html`<dashboard-image-library .api=${api}></dashboard-image-library>` };
  },
};
