import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import type { LegalAbout } from "@waitron/shared";
import { t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { aboutHeading, readLegalAbout } from "../legal-about.js";
import "./guide-sheet.js";

/** The ⓘ for a screen drawn outside the shell, opening About Waitron in a sheet of its own. */
@customElement("till-about-button")
export class TillAboutButton extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
  }

  static override styles = [
    baseStyles,
    css`
      :host {
        display: inline-flex;
      }
    `,
  ];

  @state() private href = "";
  /** The release, `null` until it is read or when the read fails. */
  @state() private about: LegalAbout | null = null;
  /** Counts each opening and closing, so a late version read heads only the sheet it was for. */
  #showings = 0;

  #open(): void {
    const showing = ++this.#showings;
    this.href = "/legal/declaration";
    this.about = null;
    void readLegalAbout().then((about) => {
      if (this.#showings === showing) this.about = about;
    });
  }

  #close(): void {
    this.#showings++;
    this.href = "";
    this.about = null;
  }

  override render() {
    return html`<wt-button
        class="about"
        variant="ghost"
        aria-label=${t("about.title")}
        @click=${() => this.#open()}
        ><span aria-hidden="true">ⓘ</span></wt-button
      >
      <till-guide-sheet
        .href=${this.href}
        .heading=${this.href === "" ? "" : aboutHeading(this.about)}
        @guide-close=${() => this.#close()}
      ></till-guide-sheet>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-about-button": TillAboutButton;
  }
}
