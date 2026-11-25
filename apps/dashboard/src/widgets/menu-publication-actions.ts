import { html, nothing } from "lit";
import type { MenuPreview } from "../api/client.js";
import { fill, t } from "../i18n/t.js";

export interface MenuPublicationHeading {
  scheduleChanged: (available: boolean) => void;
  focusFallback: () => HTMLElement | null;
}

export function publicationBlockerCount(preview: MenuPreview): number {
  return preview.clashes.length + preview.setMenuProblems.length;
}

export function scheduleAction(preview: MenuPreview, open: (event: Event) => void) {
  const blocked = publicationBlockerCount(preview) > 0;
  return html`<wt-button
    variant="secondary"
    data-test="schedule-open"
    .disabled=${blocked}
    .ariaDescription=${blocked ? t("menu_preview.see_blockers") : null}
    @click=${open}
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
  const blocked = publicationBlockerCount(preview) > 0;
  if (!blocked && previewLiveVersion(preview) !== null) return nothing;
  return html`<wt-button
    variant=${publishing || !blocked ? "primary" : "secondary"}
    data-test="publish"
    .loading=${publishing}
    .ariaDescription=${
      publishing
        ? fill("menu_preview.publishing", { menu })
        : blocked
          ? t("menu_preview.see_blockers")
          : null
    }
    .disabled=${blocked}
    @click=${publish}
    >${t("menu_preview.publish")}</wt-button
  >`;
}
