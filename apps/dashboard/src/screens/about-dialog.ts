import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import { baseStyles, type WtModal } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-modal.js";
import type { LegalAbout } from "@waitron/shared";
import { currentLocale, fill, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";

/** The About Waitron window, open while `open` is set: the release or build, the licence, and the
 * box's declaration framed below. Closing it dispatches `about-close`; the owner clears `open`. */
@customElement("dashboard-about-dialog")
export class AboutDialog extends LitElement {
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

      p {
        margin: 0;
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
  @property({ attribute: false }) about: LegalAbout | null = null;

  @query("wt-modal") private modal!: WtModal;

  #releaseLine() {
    if (this.about === null) return nothing;
    const { release, build } = this.about;
    if (release === null) return html`<p>${fill("about.build", { build })}</p>`;
    // A bare YYYY-MM-DD parses as UTC midnight, so the day is formatted in UTC too.
    const date = new Intl.DateTimeFormat(currentLocale(), {
      dateStyle: "long",
      timeZone: "UTC",
    }).format(new Date(release.releasedOn));
    return html`<p>${fill("about.version", { version: release.version, date })}</p>`;
  }

  override render() {
    const title = t("about.title");
    const spanish = currentLocale().toLowerCase().split("-")[0] === "es";
    return html`<wt-modal
      size="full"
      aria-label=${title}
      .open=${this.open}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.dispatchEvent(new CustomEvent("about-close", { bubbles: true, composed: true }));
      }}
    >
      <div class="frame">
        <h2>${title}</h2>
        ${this.#releaseLine()}
        <p>${t("about.licence")}</p>
        ${spanish ? nothing : html`<p>${t("about.declaration_note")}</p>`}
        ${this.open ? html`<iframe src="/legal/declaration" title=${title}></iframe>` : nothing}
      </div>
      <wt-button slot="footer" @click=${() => void this.modal.requestClose("cancel")}
        >${t("about.close")}</wt-button
      >
    </wt-modal>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-about-dialog": AboutDialog;
  }
}
