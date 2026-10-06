import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  disabledStyles,
  visuallyHiddenStyles,
  currentContentLanguages,
  ContentLanguageController,
  uniqueId,
  leaveCoordinatorFor,
} from "@waitron/ui";
import type { DraftScope, LeaveCoordinator, LeaveReason } from "@waitron/ui";
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

/**
 * The media module registers the picker; product forms exchange only its stored image reference.
 *
 * As a `thumbnail` it is one small button showing the photo, which opens the picker; the picker's
 * footer then holds Remove. Its default slot holds what sits beside the photo, taking the rest of
 * the row.
 */
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
      wt-button[aria-invalid="true"]::part(button) {
        border-color: var(--wt-color-danger);
      }
      .preview {
        display: block;
        margin-top: var(--wt-space-3);
        max-width: 100%;
        max-height: 16rem;
        border-radius: var(--wt-radius-md);
      }
      :host([thumbnail]) {
        display: grid;
        max-width: var(--wt-field-max-width);
        grid-template-columns: auto minmax(0, 1fr);
        align-items: center;
        column-gap: var(--wt-space-3);
      }
      :host([thumbnail]) slot {
        display: block;
      }
      .thumb {
        display: block;
        width: var(--wt-tap-min);
        height: var(--wt-tap-min);
        padding: 0;
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        overflow: hidden;
        background: var(--wt-color-surface);
        cursor: pointer;
      }
      .thumb:disabled {
        ${disabledStyles}
      }
      .thumb.inherited {
        border-style: dashed;
        border-color: var(--wt-color-text-muted);
      }
      .thumb[aria-invalid="true"] {
        border-color: var(--wt-color-danger);
      }
      .thumb img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .caption {
        ${visuallyHiddenStyles}
      }
    `,
  ];
  @property({ attribute: false }) api!: ImageUploader;
  @property() image: string | null = null;
  @property({ attribute: false }) draftParent?: object;
  /** The heading above the full control; "Image" when empty. */
  @property() label = "";
  /** The photo a blank `image` falls back to — a variant's parent's — is not stored. */
  @property() inheritedImage: string | null = null;
  /** Marks the control's button invalid, so `focusFirstInvalid` lands on it. */
  @property({ type: Boolean }) invalid = false;
  @property({ type: Boolean, reflect: true }) thumbnail = false;
  /** Nothing can be chosen or removed, and a library left open closes. */
  @property({ type: Boolean, reflect: true }) disabled = false;
  @state() private pickerOpen = false;
  @state() private selectedNames: Record<string, string> = {};
  #writeBusy = false;
  #scope?: DraftScope<null>;
  #leave?: LeaveCoordinator;
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.#writeBusy &&
    (await this.#leave!.request({ scopes: [this], reason, proceed() {} })) === "proceeded";
  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    super.disconnectedCallback();
  }
  #selectedFilename: string | null = null;
  readonly #captionId = uniqueId("image-upload-caption");
  constructor() {
    super();
    new ContentLanguageController(this);
  }
  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("disabled") && this.disabled && this.pickerOpen) this.#setOpen(false);
  }
  #setOpen(open: boolean): void {
    if (open && this.disabled) return;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    if (open) {
      this.#leave = leaveCoordinatorFor(this);
      this.#scope = this.#leave?.register<null>({
        id: this,
        parent: this.draftParent,
        current: () => null,
        snapshot: () => null,
        equal: () => true,
        restore() {},
      });
    }
    this.#writeBusy = false;
    this.pickerOpen = open;
    this.dispatchEvent(
      new CustomEvent("image-picker-state", { detail: { open }, bubbles: true, composed: true }),
    );
  }
  #change(image: string | null): void {
    if (this.disabled) return;
    this.image = image;
    this.dispatchEvent(
      new CustomEvent("image-changed", { detail: { image }, bubbles: true, composed: true }),
    );
  }
  #renderThumbnail() {
    const inherited = !this.image && this.inheritedImage ? this.inheritedImage : null;
    const shown = this.image ?? inherited;
    return html`<button
        type="button"
        class=${inherited ? "thumb inherited" : "thumb"}
        data-test="choose-image"
        aria-label=${t(this.image ? "image.change_photo" : "image.add_photo")}
        aria-invalid=${this.invalid ? "true" : nothing}
        aria-describedby=${inherited ? this.#captionId : nothing}
        ?disabled=${this.disabled}
        @click=${() => this.#setOpen(true)}
      >
        ${shown ? html`<img src=${`/media/${encodeURIComponent(shown)}`} alt="" />` : nothing}
      </button>
      <slot></slot>
      ${
        inherited
          ? html`<span id=${this.#captionId} class="caption" data-test="inherited-caption"
              >${t("editor.inherited_image_alt")}</span
            >`
          : nothing
      }`;
  }

  #remove(): void {
    this.selectedNames = {};
    this.#change(null);
  }

  override render() {
    return html`${this.thumbnail ? this.#renderThumbnail() : this.#renderFull()}
    ${this.pickerOpen ? this.#renderPicker() : nothing}`;
  }

  #renderFull() {
    return html`<p>${this.label || t("image.label")}</p>
      <div class="actions">
        <wt-button
          data-test="choose-image"
          variant="secondary"
          aria-invalid=${this.invalid ? "true" : nothing}
          ?disabled=${this.disabled}
          @click=${() => this.#setOpen(true)}
          >${t("image.choose")}</wt-button
        >
        ${
          this.image
            ? html`<wt-button
                data-test="remove-image"
                variant="secondary"
                ?disabled=${this.disabled}
                @click=${() => this.#remove()}
                >${t("image.remove")}</wt-button
              >`
            : nothing
        }
      </div>
      ${this.image ? html`<img class="preview" data-test="preview" src=${`/media/${encodeURIComponent(this.image)}`} alt=${resolveEnabledContentText(this.image === this.#selectedFilename ? this.selectedNames : {}, currentLocale(), currentContentLanguages()) || t("image.preview_alt")} />` : nothing}
      ${
        !this.image && this.inheritedImage
          ? html`<img
              class="preview"
              data-test="inherited-preview"
              src=${`/media/${encodeURIComponent(this.inheritedImage)}`}
              alt=${t("editor.inherited_image_alt")}
            />`
          : nothing
      }`;
  }

  #renderPicker() {
    return html`<wt-modal
      size="wide"
      open
      heading=${t("image.choose")}
      .beforeClose=${this.#scope ? this.#beforeClose : undefined}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.#setOpen(false);
      }}
      @keydown=${(event: Event) => event.stopPropagation()}
    >
      <media-image-picker
        @image-write-state=${(event: CustomEvent<{ busy: boolean }>) => {
          event.stopPropagation();
          this.#writeBusy = event.detail.busy;
        }}
        .draftParent=${this}
        .request=${this.api?.imageLibraryRequest}
        .liveData=${this.api?.liveData}
        @select-image=${(
          event: CustomEvent<{ filename: string; names: Record<string, string> }>,
        ) => {
          event.stopPropagation();
          this.#selectedFilename = event.detail.filename;
          this.selectedNames = event.detail.names;
          this.#change(event.detail.filename);
          this.#setOpen(false);
        }}
      ></media-image-picker>
      <wt-form-actions slot="footer"
        ><wt-button
          slot="cancel"
          variant="secondary"
          @click=${() => {
            if (this.#scope)
              void this.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel");
            else this.#setOpen(false);
          }}
          >${t("action.cancel")}</wt-button
        >${
          this.thumbnail && this.image
            ? html`<wt-button
                slot="secondary"
                variant="secondary"
                data-test="remove-image"
                @click=${() => {
                  this.#remove();
                  this.#setOpen(false);
                }}
                >${t("image.remove")}</wt-button
              >`
            : nothing
        }</wt-form-actions
      >
    </wt-modal>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-image-upload": ImageUpload;
  }
}
