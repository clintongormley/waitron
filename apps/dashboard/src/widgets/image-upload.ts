import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, currentContentLanguages, ContentLanguageController } from "@waitron/ui";
import { resolveEnabledContentText } from "@waitron/shared";
import type { DashboardRequest, LiveData } from "@waitron/dashboard-kit";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { t, currentLocale } from "../i18n/t.js";

export interface ImageUploader {
  readonly imageLibraryRequest: DashboardRequest;
  readonly liveData?: LiveData;
}

/** The media module registers the picker; product forms exchange only its stored image reference. */
@customElement("dashboard-image-upload")
export class ImageUpload extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .actions {
        display: flex;
        gap: var(--wt-space-2);
        align-items: center;
      }
      .preview {
        display: block;
        margin-top: var(--wt-space-3);
        max-width: 100%;
        max-height: 16rem;
        border-radius: var(--wt-radius-md);
      }
    `,
  ];
  @property({ attribute: false }) api!: ImageUploader;
  @property() image: string | null = null;
  @state() private pickerOpen = false;
  @state() private altText: Record<string, string> = {};
  #selectedFilename: string | null = null;
  constructor() {
    super();
    new ContentLanguageController(this);
  }
  #setOpen(open: boolean): void {
    this.pickerOpen = open;
    this.dispatchEvent(
      new CustomEvent("image-picker-state", { detail: { open }, bubbles: true, composed: true }),
    );
  }
  #change(image: string | null): void {
    this.image = image;
    this.dispatchEvent(
      new CustomEvent("image-changed", { detail: { image }, bubbles: true, composed: true }),
    );
  }
  override render() {
    return html`<p>${t("image.label")}</p>
      <div class="actions">
        <wt-button data-test="choose-image" variant="secondary" @click=${() => this.#setOpen(true)}
          >${t("image.choose")}</wt-button
        >
        ${
          this.image
            ? html`<wt-button
                data-test="remove-image"
                variant="secondary"
                @click=${() => {
                  this.altText = {};
                  this.#change(null);
                }}
                >${t("image.remove")}</wt-button
              >`
            : nothing
        }
      </div>
      ${this.image ? html`<img class="preview" data-test="preview" src=${`/media/${encodeURIComponent(this.image)}`} alt=${resolveEnabledContentText(this.image === this.#selectedFilename ? this.altText : {}, currentLocale(), currentContentLanguages()) || t("image.preview_alt")} />` : nothing}
      ${
        this.pickerOpen
          ? html`<wt-modal
              open
              heading=${t("image.choose")}
              @wt-close=${(event: Event) => {
                event.stopPropagation();
                this.#setOpen(false);
              }}
              @keydown=${(event: Event) => event.stopPropagation()}
            >
              <media-image-picker
                .request=${this.api?.imageLibraryRequest}
                .liveData=${this.api?.liveData}
                @select-image=${(
                  event: CustomEvent<{ filename: string; altText: Record<string, string> }>,
                ) => {
                  event.stopPropagation();
                  this.#selectedFilename = event.detail.filename;
                  this.altText = event.detail.altText;
                  this.#change(event.detail.filename);
                  this.#setOpen(false);
                }}
              ></media-image-picker>
              <wt-form-actions slot="footer"
                ><wt-button slot="cancel" variant="secondary" @click=${() => this.#setOpen(false)}
                  >${t("action.cancel")}</wt-button
                ></wt-form-actions
              >
            </wt-modal>`
          : nothing
      }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-image-upload": ImageUpload;
  }
}
