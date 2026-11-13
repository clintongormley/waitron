import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { languageDisplayName } from "@waitron/shared";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-modal.js";
import type { DashboardApi } from "../api/client.js";
import { currentLocale, t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";

@customElement("dashboard-guest-menu-preview")
export class GuestMenuPreview extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: inline-block;
      }
      iframe {
        display: block;
        width: 100%;
        height: calc(var(--wt-space-6) * 18);
        border: 1px solid var(--wt-color-border);
        margin-top: var(--wt-space-3);
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @property() menuId = "";
  @state() private opened = false;
  @state() private loading = false;
  @state() private answer: Awaited<ReturnType<DashboardApi["getGuestMenuPreview"]>> = null;
  @state() private error = "";

  async #load(language?: string) {
    this.loading = true;
    this.error = "";
    try {
      this.answer = await this.api.getGuestMenuPreview(this.menuId, language);
    } catch (error) {
      this.error = codeMessage(codeOf(error));
    } finally {
      this.loading = false;
    }
  }
  override render() {
    return html`<wt-button
        variant="secondary"
        @click=${() => {
          this.opened = true;
          void this.#load();
        }}
        >${t("menus.guest_preview")}</wt-button
      >
      <wt-modal
        .open=${this.opened}
        heading=${t("menus.guest_preview")}
        @wt-close=${() => {
          this.opened = false;
        }}
      >
        ${
          this.error
            ? html`<p role="alert">${this.error}</p>
                <wt-button variant="secondary" @click=${() => this.#load(this.answer?.language)}
                  >${t("action.retry")}</wt-button
                >`
            : nothing
        }
        ${this.loading ? html`<p role="status">${t("common.loading")}</p>` : nothing}
        ${
          this.answer
            ? html`<wt-combobox
                  name="guest-language"
                  label=${t("menus.guest_language")}
                  .value=${this.answer.language}
                  .disabled=${this.loading}
                  .options=${this.answer.languages.map((value) => ({ value, label: languageDisplayName(value, currentLocale()) }))}
                  @wt-change=${(event: CustomEvent<{ value: string }>) => {
                    event.stopPropagation();
                    void this.#load(event.detail.value);
                  }}
                ></wt-combobox>
                <iframe
                  title=${t("menus.guest_preview")}
                  sandbox="allow-same-origin"
                  .srcdoc=${this.answer.html}
                ></iframe>`
            : !this.loading && !this.error
              ? html`<p>${t("menus.guest_unpublished")}</p>`
              : nothing
        }
        <wt-button
          slot="footer"
          variant="secondary"
          @click=${() => {
            this.opened = false;
          }}
          >${t("action.close")}</wt-button
        >
      </wt-modal>`;
  }
}
