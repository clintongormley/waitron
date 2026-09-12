import type { TemplateResult } from "lit";
import type { DashboardRequest } from "./request.js";

/**
 * The browser twin of a card provider's server seat (`@waitron/payments`'s `CardProviderContribution`):
 * one provider's UI for the generic Payments screen — its connect form and its add-reader dialog, plus
 * the `en`/`es` strings those two register. The generic screen (`apps/dashboard`) mounts a panel without
 * naming a provider, exactly as it mounts module screens through `@waitron/dashboard-modules`.
 *
 * A panel is BROWSER-SAFE: it and everything it imports must never reach `@waitron/db`, the server, or
 * the provider's own server seat (which imports db). Each render function is handed the dashboard's
 * request primitive (`ctx.request`) and talks only to the payments HTTP routes through it.
 */
export interface CardProviderPanel {
  /** The `provider` token the routes key on — `"sumup"`, `"stripe"`. Matches the server seat's id. */
  providerId: string;
  /** The i18n key for the provider's display name (registered by the panel's own strings). */
  displayNameKey: string;
  /** The panel's own UI strings, merged into the shared catalogue when the screen mounts it. */
  strings: { en: Record<string, string>; es: Record<string, string> };
  /** The connect form. On a successful connect it calls `onConnected` so the screen refreshes. */
  renderConnectForm(ctx: { request: DashboardRequest; onConnected: () => void }): TemplateResult;
  /** The add-reader dialog — SumUp shows the pairing countdown, Stripe a reference field. `onAdded`
   * fires once the reader is saved; `onClose` when the operator dismisses the dialog. */
  renderAddReader(ctx: {
    request: DashboardRequest;
    onAdded: () => void;
    onClose: () => void;
  }): TemplateResult;
}
