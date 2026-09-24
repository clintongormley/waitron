import { html } from "lit";
import type { CardProviderPanel } from "@waitron/dashboard-kit";
import { STRIPE_STRINGS } from "./strings.js";
import "./stripe-connect-form.js"; // side-effect: defines <stripe-connect-form>
import "./stripe-add-reader.js"; // side-effect: defines <stripe-add-reader>

/** The generic Payments screen reaches Stripe only through this value. */
export const STRIPE_PANEL: CardProviderPanel = {
  providerId: "stripe",
  displayNameKey: "payments.stripe.name",
  strings: STRIPE_STRINGS,
  renderConnectForm(ctx) {
    return html`<stripe-connect-form
      .request=${ctx.request}
      .onConnected=${ctx.onConnected}
    ></stripe-connect-form>`;
  },
  renderAddReader(ctx) {
    return html`<stripe-add-reader
      .request=${ctx.request}
      .onAdded=${ctx.onAdded}
      .onClose=${ctx.onClose}
    ></stripe-add-reader>`;
  },
};
