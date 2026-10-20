import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import { baseStyles, type WtModal } from "@waitron/ui";
import { helpText } from "../i18n/help-strings.js";
import { LocaleChangeController } from "../state/locale-controller.js";

/** A guide page over the till, open while `href` is set. Closing it dispatches `till-guide-close`;
 * the owner clears `href`. */
@customElement("till-guide-sheet")
export class TillGuideSheet extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }

  static override styles = [
    baseStyles,
    css`
      iframe {
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
      }
    `,
  ];

  @property() href = "";

  @query("wt-modal") private modal!: WtModal;

  #onClose(): void {
    this.dispatchEvent(new CustomEvent("till-guide-close", { bubbles: true, composed: true }));
  }

  override render() {
    const title = helpText("help.guide_title");
    return html`<wt-modal
      size="full"
      heading=${title}
      .open=${this.href !== ""}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.#onClose();
      }}
    >
      ${this.href === "" ? nothing : html`<iframe src=${this.href} title=${title}></iframe>`}
      <wt-button slot="footer" @click=${() => void this.modal.requestClose("cancel")}
        >${helpText("help.guide_close")}</wt-button
      >
    </wt-modal>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-guide-sheet": TillGuideSheet;
  }
}
