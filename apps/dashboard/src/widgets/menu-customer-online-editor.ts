import { prepareMenuAppearance } from "@waitron/customer-menu/appearance";
import type { MenuStatus } from "@waitron/shared";
import { WAITRON_DEFAULTS } from "@waitron/ui-core/theme/waitron";
import { html } from "lit";
import { keyed } from "lit/directives/keyed.js";
import type { DashboardApi } from "../api/client.js";
import type { CustomerMenuCloudStatus } from "../api/cloud-api.js";
import type { CustomerStyleChange, MenuOnlineSave } from "./menu-online-save.js";
import "./menu-customer-style-dialog.js";
import "./menu-online-preview.js";

export function renderCustomerOnlineEditor({
  api,
  menuId,
  menuName,
  status,
  defaultLanguage,
  previewHref,
  openPreview,
  online,
  busy,
  cloud,
  cloudFailed,
  retryCloud,
}: {
  api: DashboardApi;
  menuId: string;
  menuName: string;
  status: MenuStatus | null;
  defaultLanguage: string;
  previewHref: string;
  openPreview: (event: MouseEvent) => void;
  online: MenuOnlineSave;
  busy: boolean;
  cloud: CustomerMenuCloudStatus | null;
  cloudFailed: boolean;
  retryCloud: () => void;
}) {
  const readApi = api.background ?? api;
  const photos = online.draft?.photos ?? "none";
  return html`${online.viewControl()}
    <div
      class="online-workspace"
      data-view=${online.view}
      @customer-style-change=${(event: CustomEvent<CustomerStyleChange>) => {
        online.styleChanged(event.detail);
        if (event.detail.action === "edit")
          void (event.currentTarget as HTMLElement)
            .querySelector("dashboard-menu-online-preview")
            ?.reload();
      }}
    >
      ${online.settings(
        menuName,
        status,
        previewHref,
        openPreview,
        keyed(
          menuId,
          html`<dashboard-menu-customer-style-dialog
            .api=${api}
            .readApi=${readApi}
            .menuId=${menuId}
            .styleId=${online.draft?.styleId ?? null}
            .disabled=${!online.draft || online.pendingWrite !== undefined}
            .defaultLanguage=${defaultLanguage}
            .photos=${photos}
            .previewHref=${previewHref}
            .openPreview=${openPreview}
          ></dashboard-menu-customer-style-dialog>`,
        ),
        cloud,
        cloudFailed,
        retryCloud,
      )}
      <dashboard-menu-online-preview
        .api=${readApi}
        .menuId=${menuId}
        .status=${status}
        .defaultLanguage=${defaultLanguage}
        .previewHref=${previewHref}
        .openPreview=${openPreview}
        .photos=${photos}
        .waitingForSettings=${online.loading}
        .savedStyleId=${online.savedStyleId}
        .draftAppearance=${prepareMenuAppearance(WAITRON_DEFAULTS, online.draftAppearance)}
      ></dashboard-menu-online-preview>
    </div>
    ${online.actions(busy, status?.state !== "unpublished" && cloud?.status !== "unavailable")}`;
}
