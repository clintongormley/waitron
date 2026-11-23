import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { toDataURL } from "qrcode";
import { baseStyles } from "@waitron/ui";
import { printEquipmentLabel } from "@waitron/ui/src/print-label.js";
import "@waitron/ui/src/components/wt-button.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";
import { t } from "../i18n/t.js";

/** This box's label, as the dashboard's Servers page prints it: scanned when the main box fails, it
 * opens this box's switch page. Anything placed inside sits beside Print label. */
@customElement("setup-box-label")
export class SetupBoxLabel extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      figure {
        margin: var(--wt-space-3) 0 0;
        padding: var(--wt-space-3);
        display: grid;
        justify-items: center;
        gap: var(--wt-space-2);
        text-align: center;
        color: var(--wt-color-text);
        background: var(--wt-color-surface);
        border: 1px dashed var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        max-inline-size: calc(var(--wt-space-6) * 14);
      }
      p {
        margin: 0;
      }
      .name {
        font-weight: var(--wt-font-weight-bold);
        overflow-wrap: anywhere;
      }
      .qr {
        inline-size: calc(var(--wt-space-6) * 4);
        block-size: auto;
      }
      code {
        font-size: var(--wt-font-size-sm);
        overflow-wrap: anywhere;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
        margin-block-start: var(--wt-space-3);
      }
    `,
  ];

  /** This box's own address (`contactUrl`). */
  @property() address = "";
  /** Set in tests, which cannot answer a print dialog; unset prints through the frame's window. */
  @property({ attribute: false }) printFrame?: (view: Window) => void;
  /** Set in tests, which hold a drawing back. */
  @property({ attribute: false }) drawQr?: (page: string) => Promise<string>;

  @state() private qr = "";

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  #switchPage(): string {
    return new URL("/handover/emergency", this.address).href;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has("address")) return;
    this.qr = "";
    const page = this.#switchPage();
    const draw = this.drawQr ?? ((switchPage) => toDataURL(switchPage, { margin: 2, width: 320 }));
    void draw(page).then((qr) => {
      if (this.#switchPage() === page) this.qr = qr;
    });
  }

  override render(): TemplateResult {
    const page = this.#switchPage();
    const name = new URL(this.address).hostname;
    return html`<figure data-test="label-preview">
        <p class="name" data-test="label-name">${name}</p>
        ${
          this.qr === ""
            ? nothing
            : html`<img
                class="qr"
                data-test="label-qr"
                src=${this.qr}
                alt=${t("done.label.qr_alt")}
              />`
        }
        <code data-test="label-address">${page}</code>
        <p data-test="label-words">${t("done.label.words")}</p>
      </figure>
      <div class="actions">
        <wt-button
          variant=${this.qr === "" ? "secondary" : "primary"}
          data-test="print-label"
          ?disabled=${this.qr === ""}
          @click=${() => {
            if (this.qr === "") return;
            printEquipmentLabel(
              { qr: this.qr, name, code: page, note: t("done.label.words") },
              this.printFrame,
            );
          }}
          >${t("done.label.print")}</wt-button
        >
        <slot></slot>
      </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-box-label": SetupBoxLabel;
  }
}
