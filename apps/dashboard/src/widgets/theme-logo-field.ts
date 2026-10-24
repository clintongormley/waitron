import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import type { ThemeLogo } from "@waitron/ui-core/theme";
import type { DashboardApi } from "../api/client.js";
import { t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { withDarkLogo, withLightLogo } from "./look-draft.js";
import "./image-upload.js";

/** The theme's logo: a main image and, once there is one, an optional version for dark screens. */
@customElement("dashboard-theme-logo-field")
export class ThemeLogoField extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      fieldset {
        display: grid;
        gap: var(--wt-space-2);
        margin: 0;
        padding: 0;
        border: none;
        min-inline-size: 0;
      }
      legend {
        padding: 0;
        margin-block-end: var(--wt-space-2);
        font: inherit;
        font-weight: var(--wt-font-weight-medium);
      }
      fieldset.dark {
        margin-block-start: var(--wt-space-3);
      }
      .hint {
        margin: 0;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .error {
        margin: 0;
        color: var(--wt-color-danger);
        font-size: var(--wt-font-size-sm);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) logo: ThemeLogo | null = null;
  @property({ type: Boolean }) busy = false;
  @property({ attribute: false }) errors: { light?: string; dark?: string } = {};
  @property({ attribute: false }) draftParent?: object;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  #send(logo: ThemeLogo | null): void {
    this.dispatchEvent(
      new CustomEvent("logo-change", { detail: { logo }, bubbles: true, composed: true }),
    );
  }

  #picked(event: CustomEvent<{ image: string | null }>, which: "light" | "dark"): void {
    event.stopPropagation();
    const name = event.detail.image;
    this.#send(which === "light" ? withLightLogo(this.logo, name) : withDarkLogo(this.logo, name));
  }

  #error(message: string | undefined) {
    return message ? html`<p class="error">${message}</p>` : nothing;
  }

  override render() {
    const logo = this.logo;
    return html`<fieldset>
      <legend>${t("appearance.logo")}</legend>
      <dashboard-image-upload
        venue-logo
        name="logo.light"
        .api=${this.api}
        .draftParent=${this.draftParent}
        .image=${logo?.light ?? null}
        replaceName=${t("appearance.logo_replace_name")}
        removeName=${t("appearance.logo_remove_name")}
        ?invalid=${Boolean(this.errors.light)}
        ?disabled=${this.busy}
        @image-changed=${(event: CustomEvent<{ image: string | null }>) =>
          this.#picked(event, "light")}
      ></dashboard-image-upload>
      ${this.#error(this.errors.light)}
      <p class="hint" data-test="logo-hint">${t("appearance.logo_hint")}</p>
      ${
        logo
          ? html`<fieldset class="dark" data-test="logo-dark">
              <legend>${t("appearance.logo_dark")}</legend>
              <dashboard-image-upload
                venue-logo
                name="logo.dark"
                .api=${this.api}
                .draftParent=${this.draftParent}
                .image=${logo.dark ?? null}
                addLabel=${t("appearance.logo_dark_add")}
                replaceName=${t("appearance.logo_dark_replace_name")}
                removeName=${t("appearance.logo_dark_remove_name")}
                ?invalid=${Boolean(this.errors.dark)}
                ?disabled=${this.busy}
                @image-changed=${(event: CustomEvent<{ image: string | null }>) =>
                  this.#picked(event, "dark")}
              ></dashboard-image-upload>
              ${this.#error(this.errors.dark)}
              ${
                logo.dark === undefined
                  ? html`<p class="hint" data-test="logo-dark-hint">
                      ${t("appearance.logo_dark_hint")}
                    </p>`
                  : nothing
              }
            </fieldset>`
          : nothing
      }
    </fieldset>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-theme-logo-field": ThemeLogoField;
  }
}
