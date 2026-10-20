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
      /* The heading and the frame together fill the modal's body exactly. With the modal's own
         heading above a full-height frame the body overflowed by the heading's height, and a page
         opened at a section scrolled the body to bring that section up, taking the heading away. */
      .frame {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
        height: 100%;
      }

      h2 {
        margin: 0;
        font-size: var(--wt-font-size-lg);
        overflow-wrap: anywhere;
      }

      iframe {
        display: block;
        flex: 1;
        min-height: 0;
        width: 100%;
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
      aria-label=${title}
      .open=${this.href !== ""}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.#onClose();
      }}
    >
      <div class="frame">
        <h2>${title}</h2>
        ${this.href === "" ? nothing : html`<iframe src=${this.href} title=${title}></iframe>`}
      </div>
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
