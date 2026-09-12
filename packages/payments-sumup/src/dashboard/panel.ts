import { html } from "lit";
import type { CardProviderPanel } from "@waitron/dashboard-kit";
import { SUMUP_STRINGS } from "./strings.js";
import "./sumup-connect-form.js"; // side-effect: defines <sumup-connect-form>
import "./sumup-add-reader.js"; // side-effect: defines <sumup-add-reader>

// Importing `./strings.js` (transitively, through the two elements) runs its module-load
// registerCatalogue, so the SumUp strings resolve by the time this panel is mounted.

/** The SumUp provider's dashboard panel: its connect form and pairing add-reader dialog, plus the
 * strings they use. The generic Payments screen reaches SumUp only through this value (the browser twin
 * of the server's `SUMUP_CARD_PROVIDER` seat), never by importing the element files. */
export const SUMUP_PANEL: CardProviderPanel = {
  providerId: "sumup",
  displayNameKey: "payments.sumup.name",
  strings: SUMUP_STRINGS,
  renderConnectForm(ctx) {
    return html`<sumup-connect-form
      .request=${ctx.request}
      .onConnected=${ctx.onConnected}
    ></sumup-connect-form>`;
  },
  renderAddReader(ctx) {
    return html`<sumup-add-reader
      .request=${ctx.request}
      .onAdded=${ctx.onAdded}
      .onClose=${ctx.onClose}
    ></sumup-add-reader>`;
  },
};
