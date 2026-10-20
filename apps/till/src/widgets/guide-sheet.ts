import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import { baseStyles, type WtModal } from "@waitron/ui";
import { helpText } from "../i18n/help-strings.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { trackDialog } from "./track-dialog.js";

/** A guide page over the till, open while `href` is set. Closing it dispatches `guide-close`;
 * the owner clears `href`. A touch or a key inside a same-origin page is dispatched again from
 * this element, so it counts as activity for the till's idle logout, and Escape there closes the
 * sheet. */
@customElement("till-guide-sheet")
export class TillGuideSheet extends LitElement {
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

  #pageListeners?: AbortController;

  override disconnectedCallback(): void {
    this.#unlistenPage();
    super.disconnectedCallback();
  }

  #unlistenPage(): void {
    this.#pageListeners?.abort();
    this.#pageListeners = undefined;
  }

  /** Each page the frame loads is a new document, so its listeners are added on every load. */
  #onFrameLoad(frame: HTMLIFrameElement): void {
    this.#unlistenPage();
    // Null for a page from another origin, which the sheet cannot reach into.
    const page = frame.contentDocument;
    if (page === null) return;
    this.#pageListeners = new AbortController();
    const { signal } = this.#pageListeners;
    // Only the type is copied: no key and no position.
    const relay = (event: Event) =>
      this.dispatchEvent(new Event(event.type, { bubbles: true, composed: true }));
    page.addEventListener("pointerdown", relay, { signal });
    page.addEventListener(
      "keydown",
      (event) => {
        relay(event);
        if (event.key === "Escape") void this.modal.requestClose("escape");
      },
      { signal },
    );
  }

  #onClose(): void {
    this.#unlistenPage();
    this.dispatchEvent(new CustomEvent("guide-close", { bubbles: true, composed: true }));
  }

  override render() {
    const title = helpText("help.guide_title");
    return html`<wt-modal
      ${trackDialog()}
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
        ${
          this.href === ""
            ? nothing
            : html`<iframe
                src=${this.href}
                title=${title}
                @load=${(event: Event) => this.#onFrameLoad(event.target as HTMLIFrameElement)}
              ></iframe>`
        }
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
