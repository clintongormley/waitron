import { html, nothing } from "lit";
import type { MenuPreview } from "../api/client.js";
import { fill, t } from "../i18n/t.js";

export interface MenuPublicationHeading {
  scheduleChanged: (available: boolean) => void;
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
  if (previewLiveVersion(preview) !== null) return nothing;
  return html`<wt-button
    variant=${publishing || preview.clashes.length === 0 ? "primary" : "secondary"}
    data-test="publish"
    .loading=${publishing}
    .ariaDescription=${publishing ? fill("menu_preview.publishing", { menu }) : null}
    .disabled=${preview.clashes.length > 0}
    @click=${publish}
    >${t("menu_preview.publish")}</wt-button
  >`;
}
