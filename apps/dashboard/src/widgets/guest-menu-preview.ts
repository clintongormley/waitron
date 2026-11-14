import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, leaveCoordinatorFor, type LeaveReason } from "@waitron/ui";
import { languageDisplayName } from "@waitron/shared";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-modal.js";
import type { DashboardApi } from "../api/client.js";
import { currentLocale, t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";

import "./guest-menu-paper.js";

@customElement("dashboard-guest-menu-preview")
export class GuestMenuPreview extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: inline-block;
      }
      a {
        color: var(--wt-color-primary-text);
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
  @state() private source = "";

  @state() private sharing: Awaited<ReturnType<DashboardApi["getGuestMenuSharing"]>> | null = null;
  @state() private sharingBusy = false;
  @state() private sharingError = "";

  async #readSharing() {
    const generation = this.#sharingGeneration;
    this.sharing = null;
    this.sharingError = "";
    try {
      const value = await this.api.getGuestMenuSharing();
      if (generation === this.#sharingGeneration) this.sharing = value;
    } catch (error) {
      if (generation === this.#sharingGeneration) this.sharingError = codeMessage(codeOf(error));
    }
  }
  async #changeSharing() {
    if (!this.sharing || this.sharingBusy) return;
    this.sharingBusy = true;
    this.sharingError = "";
    const generation = this.#sharingGeneration;
    try {
      const value = await this.api.setGuestMenuSharing(
        !this.sharing.enabled,
        this.sharing.revision,
      );
      if (generation === this.#sharingGeneration) this.sharing = value;
    } catch (error) {
      if (generation === this.#sharingGeneration) this.sharingError = codeMessage(codeOf(error));
      if (codeOf(error) === "settings.out_of_date") {
        try {
          const value = await this.api.getGuestMenuSharing();
          if (generation === this.#sharingGeneration) this.sharing = value;
        } catch {
          /* Keep the action's refusal until the next attempt. */
        }
      }
    } finally {
      if (generation === this.#sharingGeneration) this.sharingBusy = false;
    }
  }
  #sharingGeneration = 0;
  readonly #beforeClose = async (reason: LeaveReason) => {
    const leave = leaveCoordinatorFor(this);
    return (
      !leave || (await leave.request({ scopes: [this], reason, proceed() {} })) === "proceeded"
    );
  };
  #generation = 0;
  #language?: string;
  #clear() {
    URL.revokeObjectURL(this.source);
    this.source = "";
    this.answer = null;
  }
  #close() {
    this.#generation++;
    this.#sharingGeneration++;
    this.sharing = null;
    this.#clear();
    this.opened = false;
    this.loading = false;
    this.sharingBusy = false;
  }
  override disconnectedCallback() {
    super.disconnectedCallback();
    this.#close();
  }
  protected override willUpdate(changed: PropertyValues) {
    if (changed.has("menuId")) this.#close();
  }
  async #load(language?: string) {
    const generation = ++this.#generation;
    this.#language = language;
    URL.revokeObjectURL(this.source);
    this.source = "";
    this.loading = true;
    this.error = "";
    try {
      const answer = await this.api.getGuestMenuPreview(this.menuId, language);
      if (generation !== this.#generation) return;
      this.answer = answer;
      this.#language = answer?.language;
      this.source = answer
        ? URL.createObjectURL(new Blob([answer.html], { type: "text/html" }))
        : "";
    } catch (error) {
      if (generation === this.#generation) this.error = codeMessage(codeOf(error));
    } finally {
      if (generation === this.#generation) this.loading = false;
    }
  }
  override render() {
    return html`<wt-button
        variant="secondary"
        @click=${() => {
          this.opened = true;
          void this.#load().then(() => {
            if (this.opened) void this.#readSharing();
          });
        }}
        >${t("menus.guest_preview")}</wt-button
      >
      <wt-modal
        .open=${this.opened}
        heading=${t("menus.guest_preview")}
        .beforeClose=${this.#beforeClose}
        @wt-close=${() => this.#close()}
      >
        ${
          this.error
            ? html`<p role="alert">${this.error}</p>
                <wt-button variant="secondary" @click=${() => this.#load(this.#language)}
                  >${t("content_languages.retry")}</wt-button
                >`
            : nothing
        }
        ${this.loading ? html`<p role="status">${t("menus.loading")}</p>` : nothing}
        ${
          this.answer
            ? html`<wt-combobox
                  name="guest-language"
                  label=${t("menus.guest_language")}
                  .value=${this.#language ?? this.answer.language}
                  .options=${this.answer.languages.map((value) => ({ value, label: languageDisplayName(value, currentLocale()) }))}
                  @wt-change=${(event: CustomEvent<{ value: string }>) => {
                    event.stopPropagation();
                    void this.#load(event.detail.value);
                  }}
                ></wt-combobox>
                ${this.source ? html`<iframe title=${t("menus.guest_preview")} sandbox="allow-same-origin" .src=${this.source}></iframe>` : nothing}`
            : !this.loading && !this.error
              ? html`<p>${t("menus.guest_unpublished")}</p>`
              : nothing
        }
        ${
          this.answer?.versionId
            ? html`<dashboard-guest-menu-paper
                .api=${this.api}
                .menuId=${this.menuId}
                .versionId=${this.answer.versionId}
                .language=${this.answer.language}
                .members=${this.answer.members}
                .settings=${this.sharing}
                @guest-settings-saved=${(
                  event: CustomEvent<NonNullable<GuestMenuPreview["sharing"]>>,
                ) => {
                  event.stopPropagation();
                  this.sharing = event.detail;
                }}
                .draftParent=${this}
              ></dashboard-guest-menu-paper>`
            : nothing
        }
        ${this.sharing?.available ? html`<a href="/public/menu" target="_blank" rel="noopener">${t("menus.guest_local_link")}</a>` : nothing}
        ${this.sharing ? html`<p>${t(!this.sharing.enabled ? "menus.guest_sharing_off" : this.sharing.available ? "menus.guest_sharing_on" : "menus.guest_sharing_unavailable")}</p>` : nothing}
        ${this.sharingError ? html`<p id="sharing-error" role="alert">${this.sharingError}</p>` : nothing}
        <wt-button
          id="sharing-action"
          variant="secondary"
          .disabled=${!this.sharing || this.sharingBusy}
          @click=${() => this.#changeSharing()}
          >${t(this.sharing?.enabled ? "menus.guest_turn_off" : "menus.guest_turn_on")}</wt-button
        >
        ${!this.sharing && this.sharingError ? html`<wt-button variant="secondary" @click=${() => this.#readSharing()}>${t("content_languages.retry")}</wt-button>` : nothing}
        <wt-button
          slot="footer"
          variant="secondary"
          @click=${() => {
            void this.shadowRoot!.querySelector("wt-modal")!.requestClose("navigation");
          }}
          >${t("action.close")}</wt-button
        >
      </wt-modal>`;
  }
}
