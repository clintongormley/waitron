import { installedContentLanguagePresentation } from "@waitron/country-packs";
import { contentLanguageDisplayName, type CustomerMenuPreview } from "@waitron/shared";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-segmented-control.js";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { MenuApi } from "../api/menu-api.js";
import { currentLocale, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import "./customer-menu-page.js";

@customElement("dashboard-menu-online-preview")
export class MenuOnlinePreview extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        padding-block: var(--wt-space-4);
      }
      p {
        margin: 0 0 var(--wt-space-3);
      }
      .toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
        margin-block: var(--wt-space-4);
      }
      wt-combobox {
        inline-size: min(100%, 16ch);
      }
      .canvas {
        overflow: auto;
      }
      .canvas:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      .phone {
        max-inline-size: 390px;
        margin-inline: auto;
      }
      .computer {
        min-inline-size: 720px;
      }
    `,
  ];

  @property({ attribute: false }) api?: Pick<MenuApi, "getCustomerPreview">;
  @property({ attribute: false }) menuId = "";
  @property({ attribute: false }) changed = false;
  @property({ attribute: false }) defaultLanguage = "en";
  @property({ attribute: false }) previewHref = "";
  @property({ attribute: false }) openPreview?: (event: MouseEvent) => void;

  @state() private answer: CustomerMenuPreview | null = null;
  @state() private failed = false;
  @state() private languages: string[] = [];
  @state() private language = "";
  @state() private size: "phone" | "computer" = matchMedia("(max-width: 760px)").matches
    ? "phone"
    : "computer";
  #request = 0;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("menuId") || changed.has("api")) {
      this.language = "";
      this.languages = [];
      void this.#load();
    }
  }

  async #load(): Promise<void> {
    const request = ++this.#request;
    this.answer = null;
    this.failed = false;
    if (!this.api || !this.menuId) return;
    try {
      const answer = await this.api.getCustomerPreview(this.menuId, this.language);
      if (!this.isConnected || request !== this.#request) return;
      this.answer = answer;
      if (answer.state === "published") {
        this.languages = answer.menu.languages;
        this.language = answer.menu.language;
      } else this.languages = [];
    } catch {
      if (this.isConnected && request === this.#request) this.failed = true;
    }
  }

  #toolbar() {
    return html`<div class="toolbar">
      <wt-segmented-control
        name="customer-preview-size"
        label=${t("customer_menu.preview_size")}
        hide-label
        .options=${[
          { value: "phone", label: t("customer_menu.phone") },
          { value: "computer", label: t("customer_menu.computer") },
        ]}
        .value=${this.size}
        @wt-change=${(event: CustomEvent<{ value: "phone" | "computer" }>) => {
          event.stopPropagation();
          this.size = event.detail.value;
        }}
      ></wt-segmented-control>
      <wt-combobox
        name="customer-preview-language"
        label=${t("content_languages.language")}
        .value=${this.language}
        .options=${this.languages.map((value) => ({
          value,
          label: contentLanguageDisplayName(
            value,
            currentLocale(),
            installedContentLanguagePresentation(),
          ),
        }))}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          if (event.detail.value === this.language) return;
          this.language = event.detail.value;
          void this.#load();
        }}
      ></wt-combobox>
    </div>`;
  }

  #page() {
    if (this.failed)
      return html`<p role="alert">${t("customer_menu.load_error")}</p>
        <wt-button variant="secondary" @click=${() => void this.#load()}
          >${t("menus.retry")}</wt-button
        >`;
    if (this.answer === null) return html`<p role="status">${t("customer_menu.loading")}</p>`;
    if (this.answer.state === "unpublished")
      return html`<p>${t("customer_menu.unpublished")}</p>
        <a href=${this.previewHref} @click=${this.openPreview}
          >${t("customer_menu.go_to_preview")}</a
        >`;
    return html`<div
      class="canvas"
      role="region"
      aria-label=${t("customer_menu.online_preview")}
      tabindex=${this.size === "computer" ? "0" : nothing}
    >
      <dashboard-customer-menu-page
        class=${this.size}
        .menu=${this.answer.menu}
        .defaultLanguage=${this.defaultLanguage}
      ></dashboard-customer-menu-page>
    </div>`;
  }

  protected override render() {
    return html`
      <p>${t("customer_menu.not_public")}</p>
      ${
        this.changed && this.answer?.state === "published"
          ? html`<p>${t("customer_menu.published_only")}</p>`
          : nothing
      }
      ${this.languages.length ? this.#toolbar() : nothing} ${this.#page()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-menu-online-preview": MenuOnlinePreview;
  }
}
