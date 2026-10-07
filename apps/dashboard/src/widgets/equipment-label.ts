import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { toDataURL } from "qrcode";
import { baseStyles, type WtModal } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-modal.js";
import { formatEquipmentCode, type EquipmentKind } from "@waitron/shared";
import { t } from "../i18n/t.js";

/** What a printed label carries. */
export interface EquipmentLabelContent {
  qr: string;
  code: string;
  name: string;
}

/**
 * Prints the label alone, from a frame of its own: printing the page would print the dashboard
 * around the dialog. The name is set as text, never parsed as markup.
 */
export function printEquipmentLabel(
  label: EquipmentLabelContent,
  printFrame: (view: Window) => void = (view) => view.print(),
): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.position = "fixed";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.addEventListener("load", () => {
    const view = frame.contentWindow!;
    const doc = frame.contentDocument!;
    const style = doc.createElement("style");
    style.textContent =
      "body{margin:0;font-family:sans-serif;text-align:center}" +
      "img{width:40mm;height:40mm}p{margin:2mm 0;overflow-wrap:anywhere}";
    doc.head.append(style);
    const image = doc.createElement("img");
    image.src = label.qr;
    image.alt = "";
    const code = doc.createElement("p");
    code.textContent = label.code;
    const name = doc.createElement("p");
    name.textContent = label.name;
    doc.body.append(image, name, code);
    view.addEventListener("afterprint", () => frame.remove(), { once: true });
    image.decode().then(
      () => printFrame(view),
      () => frame.remove(),
    );
  });
  frame.srcdoc = "<!doctype html><title>Waitron</title>";
  document.body.append(frame);
}

/** A portable printer's or card reader's label: its QR code, the code's text and its name. */
@customElement("dashboard-equipment-label")
export class EquipmentLabel extends LitElement {
  static override styles = [
    baseStyles,
    css`
      figure {
        margin: 0;
        display: grid;
        justify-items: center;
        gap: var(--wt-space-2);
        text-align: center;
      }
      .qr {
        width: calc(var(--wt-space-6) * 6);
        max-width: 100%;
        height: auto;
      }
      .name {
        margin: 0;
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-text);
      }
      code {
        overflow-wrap: anywhere;
        color: var(--wt-color-text);
      }
      .hint {
        margin: 0 0 var(--wt-space-3);
        color: var(--wt-color-text-muted);
      }
    `,
  ];

  @property() kind: EquipmentKind = "printer";
  @property() itemId = "";
  @property() name = "";
  /** Where focus returns when the label closes. */
  @property({ attribute: false }) opener: HTMLElement | null = null;
  /** Replaced in tests, which cannot answer a print dialog. */
  @property({ attribute: false }) print: (label: EquipmentLabelContent) => void = (label) =>
    printEquipmentLabel(label);
  /** Replaced in tests, which hold a drawing back. */
  @property({ attribute: false }) drawQr: (code: string) => Promise<string> = (code) =>
    toDataURL(code, { margin: 2, width: 320 });

  @state() private qr = "";

  #code(): string {
    return formatEquipmentCode(this.kind, this.itemId);
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("kind") || changed.has("itemId")) {
      this.qr = "";
      const code = this.#code();
      void this.drawQr(code).then((qr) => {
        if (this.#code() === code) this.qr = qr;
      });
    }
  }

  /** Closes the dialog; `wt-close` follows once it has. */
  #close(): void {
    this.renderRoot.querySelector<WtModal>("wt-modal")!.open = false;
  }

  override render(): TemplateResult {
    const code = this.#code();
    return html`<wt-modal
      size="compact"
      data-test="equipment-label-modal"
      heading=${t("equipment.label_title").replace("{name}", this.name)}
      .open=${true}
      .opener=${this.opener}
    >
      <p class="hint">${t("equipment.label_hint")}</p>
      <figure>
        ${
          this.qr === ""
            ? nothing
            : html`<img
                class="qr"
                data-test="equipment-label-qr"
                src=${this.qr}
                alt=${t("equipment.label_qr_alt")}
              />`
        }
        <p class="name" data-test="equipment-label-name">${this.name}</p>
        <code data-test="equipment-label-code">${code}</code>
      </figure>
      <wt-form-actions slot="footer">
        <wt-button slot="cancel" data-test="close-equipment-label" @click=${() => this.#close()}
          >${t("action.close")}</wt-button
        >
        <wt-button
          variant="primary"
          data-test="print-equipment-label"
          ?disabled=${this.qr === ""}
          @click=${() => this.print({ qr: this.qr, code, name: this.name })}
          >${t("equipment.print")}</wt-button
        >
      </wt-form-actions>
    </wt-modal>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-equipment-label": EquipmentLabel;
  }
}
