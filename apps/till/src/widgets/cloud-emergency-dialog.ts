import { LitElement, css, html } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { baseStyles, type WtDialog } from "@waitron/ui";
import type { TillCloudEmergency } from "../api/device-session-api.js";
import { t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { qrSvg } from "../qr.js";
import { trackDialog } from "./track-dialog.js";

@customElement("till-cloud-emergency-dialog")
export class TillCloudEmergencyDialog extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }
  static override styles = [
    baseStyles,
    css`
      .qr {
        display: flex;
        justify-content: center;
        margin: var(--wt-space-4);
      }
      .qr svg {
        width: var(--wt-authenticator-qr-size);
        max-width: 100%;
        height: auto;
      }
    `,
  ];
  @property({ attribute: false }) entrance!: TillCloudEmergency;
  @query("wt-dialog") private dialog!: WtDialog;
  #emit(name: string): void {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }));
  }
  override render() {
    return html`<wt-dialog
      ${trackDialog()}
      .open=${true}
      .heading=${t("cloud_emergency.start")}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.#emit("close-cloud-emergency");
      }}
    >
      <div class="qr" data-emergency-qr role="img" aria-label=${t("cloud_emergency.qr")}>
        ${unsafeHTML(qrSvg(this.entrance.address))}
      </div>
      <p>${t("cloud_emergency.master_key")}</p>
      <wt-button
        slot="footer"
        variant="secondary"
        data-close
        @click=${() => void this.dialog.requestClose("cancel")}
        >${t("cloud_emergency.close")}</wt-button
      >
      <wt-button slot="footer" data-open-here @click=${() => this.#emit("open-cloud-emergency")}
        >${t("cloud_emergency.open")}</wt-button
      >
    </wt-dialog>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "till-cloud-emergency-dialog": TillCloudEmergencyDialog;
  }
}
