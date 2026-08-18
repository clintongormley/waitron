import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { t } from "../i18n/t.js";
import { codeMessage, codeOf } from "../i18n/codes.js";

/**
 * The `uploadImage` seam this control needs — the whole `DashboardApi` satisfies it structurally, and
 * a test stubs just this method. Kept minimal (rather than depending on the whole class) so the widget
 * declares exactly the surface it uses.
 */
export interface ImageUploader {
  uploadImage(file: File): Promise<{ image: string }>;
}

/**
 * The management dashboard's PRODUCT IMAGE control: a token-styled native `<input type="file">` (there
 * is no `wt-file` primitive) that, on a pick, calls `api.uploadImage(file)` and — on success — emits a
 * bubbling, composed `image-changed { image }` carrying the stored `<sha256>.<ext>` reference and shows
 * a preview served from `/media/<image>`. The parent product form owns the value; this widget only
 * uploads and announces, exactly as the pure-display staff list only emits `edit-person`.
 *
 * `image` is a `@property` so the form can PRE-SET it (edit mode: a product already carrying a picture
 * shows its preview immediately, no upload). A rejected upload sets `errorKey` from the thrown
 * `{ code }` (falling back to `server.internal`); the raw code stays in `errorKey` and `codeMessage`
 * maps it to localised copy in the `role="alert"` banner at the render edge — the exact errorKey
 * contract `login-screen`/`staff-screen` use, so the `media.*` codes surface as Spanish copy, never
 * the raw wire code. A single-flight guard drops a re-fired pick while one upload is in flight
 * (`uploadImage` is not server-idempotent), mirroring the staff screen's create guard.
 */
@customElement("dashboard-image-upload")
export class ImageUpload extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .field {
        display: block;
        margin-bottom: var(--wt-space-2);
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }
      input[type="file"] {
        display: block;
        margin-top: var(--wt-space-1);
        font: inherit;
        color: var(--wt-color-text);
        padding: var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        width: 100%;
      }
      input[type="file"]:disabled {
        opacity: var(--wt-opacity-disabled);
      }
      .preview {
        display: block;
        margin-top: var(--wt-space-3);
        max-width: 100%;
        height: auto;
        border-radius: var(--wt-radius-md);
      }
      .error {
        color: var(--wt-color-danger);
        margin-top: var(--wt-space-3);
      }
    `,
  ];

  /** The dependency doing the upload (the `DashboardApi`, or any `uploadImage`-shaped stub in tests). */
  @property({ attribute: false }) api!: ImageUploader;

  /** The stored image reference (`<sha256>.<ext>`), or null when there is none. Settable for edit mode. */
  @property() image: string | null = null;

  @state() private errorKey: string | null = null;

  // A re-entrancy guard, NOT @state (nothing renders off it): set synchronously at pick so a
  // double-fired change files one upload. Mirrors the staff screen's `#creating`.
  #uploading = false;

  /**
   * Upload the picked file. Called via `void` from the `@change` handler, so a rejected upload MUST be
   * caught here — otherwise it is an unhandled rejection and the operator gets no feedback. On success
   * the stored reference becomes `image` and the widget emits `image-changed`; on failure the thrown
   * `{ code }` becomes the `errorKey` banner (falling back to `server.internal`), leaving any prior
   * preview in place for a retry.
   */
  async #onFileChange(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || this.#uploading) return;
    this.#uploading = true;
    this.errorKey = null;
    try {
      const { image } = await this.api.uploadImage(file);
      this.image = image;
      this.dispatchEvent(
        new CustomEvent<{ image: string }>("image-changed", {
          detail: { image },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (error) {
      this.errorKey = codeOf(error);
    } finally {
      this.#uploading = false;
    }
  }

  override render() {
    return html`
      <label class="field">
        ${t("image.label")}
        <input
          type="file"
          data-test="file"
          accept="image/png,image/jpeg,image/webp"
          @change=${(e: Event) => void this.#onFileChange(e)}
        />
      </label>
      ${
        this.image
          ? html`<img
              class="preview"
              data-test="preview"
              src=${`/media/${this.image}`}
              alt=${t("image.preview_alt")}
            />`
          : nothing
      }
      ${
        this.errorKey
          ? html`<p class="error" role="alert" data-test="error">${codeMessage(this.errorKey)}</p>`
          : nothing
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-image-upload": ImageUpload;
  }
}
