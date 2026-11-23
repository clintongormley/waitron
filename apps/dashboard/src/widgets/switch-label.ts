import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { toDataURL } from "qrcode";
import { baseStyles, type WtModal } from "@waitron/ui";
import { printEquipmentLabel } from "@waitron/ui/src/print-label.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-modal.js";
import { fill, t } from "../i18n/t.js";

/** The label for a box's case: scanned when the main server fails, it opens that box's switch page. */
@customElement("dashboard-switch-label")
export class SwitchLabel extends LitElement {
  static override styles = [
    baseStyles,
    css`
      figure {
        margin: 0;
        display: grid;
        justify-items: center;
        gap: var(--wt-space-2);
        text-align: center;
        color: var(--wt-color-text);
      }
      .qr {
        width: calc(var(--wt-space-6) * 6);
        max-width: 100%;
        height: auto;
      }
      p {
        margin: 0;
      }
      .name {
        font-weight: var(--wt-font-weight-bold);
        overflow-wrap: anywhere;
      }
      code {
        overflow-wrap: anywhere;
      }
    `,
  ];

  /** The box's `contactUrl`. */
  @property() address = "";
  /** Where focus returns when the label closes. */
  @property({ attribute: false }) opener: HTMLElement | null = null;
  /** Replaced in tests, which cannot answer a print dialog. */
  @property({ attribute: false }) printFrame: (view: Window) => void = (view) => view.print();
  /** Replaced in tests, which hold a drawing back. */
  @property({ attribute: false }) drawQr: (page: string) => Promise<string> = (page) =>
    toDataURL(page, { margin: 2, width: 320 });

  @state() private qr = "";

  #switchPage(): string {
    return new URL("/handover/emergency", this.address).href;
  }

  #name(): string {
    return new URL(this.address).hostname;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has("address")) return;
    this.qr = "";
    const page = this.#switchPage();
    void this.drawQr(page).then((qr) => {
      if (this.#switchPage() === page) this.qr = qr;
    });
  }

  override render(): TemplateResult {
    const page = this.#switchPage();
    const name = this.#name();
    return html`<wt-modal
      size="compact"
      data-test="switch-label-modal"
      heading=${fill("servers.switch_label_title", { name })}
      .open=${true}
      .opener=${this.opener}
    >
      <figure>
        <p class="name" data-test="switch-label-name">${name}</p>
        ${
          this.qr === ""
            ? nothing
            : html`<img
                class="qr"
                data-test="switch-label-qr"
                src=${this.qr}
                alt=${t("servers.switch_label_qr_alt")}
              />`
        }
        <code data-test="switch-label-address">${page}</code>
        <p data-test="switch-label-words">${t("servers.switch_label_words")}</p>
      </figure>
      <wt-form-actions slot="footer">
        <wt-button
          slot="cancel"
          data-test="close-switch-label"
          @click=${() => {
            this.renderRoot.querySelector<WtModal>("wt-modal")!.open = false;
          }}
          >${t("action.close")}</wt-button
        >
        <wt-button
          variant=${this.qr === "" ? "secondary" : "primary"}
          data-test="print-switch-label"
          ?disabled=${this.qr === ""}
          @click=${() =>
            printEquipmentLabel(
              { qr: this.qr, name, code: page, note: t("servers.switch_label_words") },
              this.printFrame,
            )}
          >${t("equipment.print")}</wt-button
        >
      </wt-form-actions>
    </wt-modal>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-switch-label": SwitchLabel;
  }
}
