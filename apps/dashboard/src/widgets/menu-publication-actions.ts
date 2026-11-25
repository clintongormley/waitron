import { html } from "lit";
import type { MenuPreview } from "../api/client.js";
import { fill, t } from "../i18n/t.js";

export interface MenuPublicationHeading {
  scheduleChanged: (preview: MenuPreview | null) => void;
  focusFallback: () => HTMLElement | null;
}

export function scheduleAction(open: (event: Event) => void) {
  return html`<wt-button variant="secondary" data-test="schedule-open" @click=${open}
    >${t("menu_publications.schedule")}</wt-button
  >`;
}

/** The live version's number when the working menu is exactly that version, else null. Read
 * from the state that came with the preview, so both describe the same moment. */
export function previewLiveVersion(preview: MenuPreview): number | null {
  const { status } = preview;
  return status.state !== "unpublished" && status.hash === preview.hash ? status.version : null;
}

export function publishAction(
  preview: MenuPreview,
  publishing: boolean,
  menu: string,
  publish: (event: Event) => void,
) {
  return html`<wt-button
    variant=${publishing || preview.clashes.length === 0 ? "primary" : "secondary"}
    data-test="publish"
    .loading=${publishing}
    .disabled=${preview.clashes.length > 0}
    @click=${publish}
    >${fill(publishing ? "menu_preview.publishing" : "menu_preview.publish", { menu })}</wt-button
  >`;
}
