import { html } from "lit";
import type { DashboardApi } from "../api/client.js";
import { dashboardQuery } from "../api/live-queries.js";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";

export function productsListLoadFeedback(
  error: string | null,
  retrying: boolean,
  retry: () => void,
) {
  if (error === null) return html`<p role="status">${t("products.loading")}</p>`;
  return html`
    <p class="error" role="alert">${codeMessage(error)}</p>
    <wt-button data-test="products-retry" variant="secondary" .loading=${retrying} @click=${retry}
      >${t("menus.retry")}</wt-button
    >
  `;
}

export function focusProductsListFeedback(root: HTMLElement | DocumentFragment): void {
  const target =
    root.querySelector<HTMLElement>('[data-test="products-retry"]') ??
    root.querySelector<HTMLElement>("h1");
  target?.focus();
}

export function restartSharedLanguagesRead(api: DashboardApi): Promise<void> {
  api.liveData?.invalidate(dashboardQuery(api, "getContentLanguages", []).dependencies);
  // Start the scheduled read before a new watch can reuse the shell's failed snapshot.
  return Promise.resolve();
}
