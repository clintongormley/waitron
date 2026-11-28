import { html, nothing } from "lit";
import type { CustomerMenuCloudStatus } from "../api/cloud-api.js";
import { fill } from "../i18n/t.js";

export function customerMenuPublicUrl(
  cloud: CustomerMenuCloudStatus | null,
  address: string | null | undefined,
): string | undefined {
  if (cloud?.status === "ready" && address) return `${cloud.origin}/${address}`;
}

export function customerMenuLink(url: string | undefined, pathOnly = false) {
  if (!url) return nothing;
  const address = pathOnly ? new URL(url).pathname : url;
  return html`<a
    class=${pathOnly ? nothing : "online-live-link"}
    part="online-link"
    href=${url}
    target="_blank"
    rel="noopener"
    aria-label=${fill("customer_menu.link_new_tab", { address })}
    >${address}${pathOnly ? nothing : html`<wt-icon name="open-in-new" size="sm"></wt-icon>`}</a
  >`;
}
