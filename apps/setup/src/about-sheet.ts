import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import { baseStyles, type WtModal } from "@waitron/ui";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-button.js";
import { t } from "./i18n/t.js";
import { LocaleChangeController } from "./i18n/locale-controller.js";

/** The box's declaration page in a full-screen sheet, open while `open` is set. Closing
 * it dispatches `about-close`; the owner clears `open`. */
@customElement("setup-about-sheet")
export class SetupAboutSheet extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }

  static override styles = [
    baseStyles,
    css`
      .frame {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
        height: 100%;
      }

      h2 {
        margin: 0;
        font-size: var(--wt-font-size-lg);
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

  @property({ type: Boolean }) open = false;

  /** Where focus returns on close. */
  @property({ attribute: false }) opener: HTMLElement | null = null;

  @query("wt-modal") private modal!: WtModal;

  override render() {
    const title = t("shell.about.title");
    return html`<wt-modal
      size="full"
      aria-label=${title}
      .open=${this.open}
      .opener=${this.opener}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.dispatchEvent(new CustomEvent("about-close", { bubbles: true, composed: true }));
      }}
    >
      <div class="frame">
        <h2>${title}</h2>
        ${this.open ? html`<iframe src="/legal/declaration" title=${title}></iframe>` : nothing}
      </div>
      <wt-button slot="footer" @click=${() => void this.modal.requestClose("cancel")}
        >${t("shell.about.close")}</wt-button
      >
    </wt-modal>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-about-sheet": SetupAboutSheet;
  }
}
