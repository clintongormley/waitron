import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { fieldLabel, fieldStyles } from "@waitron/ui-core/field-styles";
import { baseStyles } from "../base-styles.js";
import { delegatesFocusShadowRootOptions, dispatchWtChange, uniqueId } from "../interactive.js";

export interface FileInputCopy {
  drop: string;
  choose: string;
  replace: string;
  previewAlt: string;
}

@customElement("wt-file-input")
export class WtFileInput extends LitElement {
  static override shadowRootOptions = delegatesFocusShadowRootOptions;
  static override styles = [
    baseStyles,
    fieldStyles,
    css`
      :host {
        display: block;
        max-width: var(--wt-field-max-width);
      }
      .field {
        border: 1px dashed var(--wt-color-border);
        border-radius: var(--wt-radius-md);
      }
      .field[data-dragging] {
        border-color: var(--wt-color-primary);
        background: var(--wt-color-surface-lifted);
      }
      .field-control {
        position: absolute;
        inset: 0;
        height: 100%;
        opacity: 0;
        cursor: pointer;
      }
      .field[data-disabled] .field-control {
        cursor: not-allowed;
      }
      .content {
        width: 100%;
        padding: var(--wt-space-6) var(--wt-space-3) var(--wt-space-3);
        text-align: center;
        overflow-wrap: anywhere;
      }
      .choose {
        color: var(--wt-color-primary-text);
        font-weight: var(--wt-font-weight-bold);
      }
      .guidance,
      .size {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .selected {
        display: flex;
        align-items: center;
        gap: var(--wt-space-3);
        text-align: start;
      }
      img {
        width: calc(var(--wt-tap-min) * 2);
        height: calc(var(--wt-tap-min) * 2);
        object-fit: contain;
        border-radius: var(--wt-radius-sm);
      }
      .details {
        min-width: 0;
      }
      :host([compact]) .content {
        padding: var(--wt-space-3);
      }
      :host([compact]) .field-label {
        position: static;
      }
      :host([compact]) .field {
        display: block;
      }
      :host([compact]) .field-label {
        margin: var(--wt-space-2) var(--wt-space-3) 0;
      }
    `,
  ];
  @property() name = "";
  @property() label = "";
  @property() hint = "";
  @property() accept = "";
  @property() error = "";
  @property() locale = "en";
  @property({ type: Boolean, reflect: true }) required = false;
  @property({ type: Boolean, reflect: true }) invalid = false;
  @property({ type: Boolean, reflect: true }) disabled = false;
  @property({ type: Boolean, reflect: true }) multiple = false;
  @property({ type: Boolean, reflect: true }) compact = false;
  @property({ attribute: false }) files: File[] = [];
  @property({ attribute: false }) copy: FileInputCopy = {
    drop: "Drop a file here",
    choose: "Choose a file",
    replace: "Choose another",
    previewAlt: "Selected file preview",
  };
  @state() private dragging = false;
  #depth = 0;
  #previews = new Map<File, string>();
  readonly #id = uniqueId("wt-file-input");
  readonly #hintId = uniqueId("wt-file-input-hint");
  readonly #errorId = uniqueId("wt-file-input-error");

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate("files");
  }
  override disconnectedCallback(): void {
    this.#previews.forEach((url) => URL.revokeObjectURL(url));
    this.#previews.clear();
    this.#depth = 0;
    this.dragging = false;
    super.disconnectedCallback();
  }
  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("files") && this.isConnected) {
      for (const [file, url] of this.#previews) {
        if (!this.files.includes(file)) {
          URL.revokeObjectURL(url);
          this.#previews.delete(file);
        }
      }
      for (const file of this.files) {
        if (file.type.startsWith("image/") && !this.#previews.has(file))
          this.#previews.set(file, URL.createObjectURL(file));
      }
    }
    if (this.disabled) {
      this.#depth = 0;
      this.dragging = false;
    }
  }
  #change(event: Event, files: File[]): void {
    event.stopPropagation();
    if (this.disabled) return;
    this.files = this.multiple ? files : files.slice(0, 1);
    dispatchWtChange(this, event, { files: this.files });
  }
  #fileDrag(event: DragEvent): boolean {
    return event.dataTransfer?.types.includes("Files") ?? false;
  }
  #enter(event: DragEvent): void {
    if (!this.#fileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!this.disabled) {
      this.#depth++;
      this.dragging = true;
    }
  }
  #leave(event: DragEvent): void {
    event.stopPropagation();
    this.#depth = Math.max(0, this.#depth - 1);
    this.dragging = this.#depth > 0;
  }
  #over(event: DragEvent): void {
    if (!this.#fileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = this.disabled ? "none" : "copy";
  }
  #drop(event: DragEvent): void {
    this.#depth = 0;
    this.dragging = false;
    if (!this.#fileDrag(event)) return;
    event.preventDefault();
    this.#change(event, [...event.dataTransfer!.files]);
  }
  #size(file: File): string {
    const unit = Math.round(file.size / 100) / 10 >= 1_000 ? "MB" : file.size >= 1_000 ? "kB" : "B";
    const divisor = unit === "MB" ? 1_000_000 : unit === "kB" ? 1_000 : 1;
    return `${new Intl.NumberFormat(this.locale, { maximumFractionDigits: 1 }).format(file.size / divisor)} ${unit}`;
  }
  override render() {
    const id = this.name || this.#id;
    const described = [this.hint ? this.#hintId : "", this.error ? this.#errorId : ""]
      .filter(Boolean)
      .join(" ");
    return html`<div class="row">
        <div
          class="field"
          part="field"
          data-label="float"
          ?data-invalid=${this.invalid || Boolean(this.error)}
          ?data-disabled=${this.disabled}
          ?data-dragging=${this.dragging}
          @dragenter=${this.#enter}
          @dragleave=${this.#leave}
          @dragover=${this.#over}
          @drop=${this.#drop}
        >
          ${this.label ? fieldLabel(id, this.label, this.required) : nothing}
          <div class="content">
            ${
              !this.compact && this.files.length
                ? this.files.map(
                    (file) =>
                      html`<div class="selected">
                        ${this.#previews.has(file) ? html`<img src=${this.#previews.get(file)!} alt=${this.copy.previewAlt} />` : nothing}
                        <div class="details">
                          <strong>${file.name}</strong>
                          <div class="size">${this.#size(file)}</div>
                          <span class="choose">${this.copy.replace}</span>
                        </div>
                      </div>`,
                  )
                : html`<span>${this.copy.drop}</span>
                    <span class="choose">${this.copy.choose}</span>`
            }
            ${this.hint ? html`<div class="guidance" id=${this.#hintId}>${this.hint}</div>` : nothing}
          </div>
          <input
            class="field-control"
            id=${id}
            name=${this.name || nothing}
            type="file"
            accept=${this.accept || nothing}
            ?multiple=${this.multiple}
            ?required=${this.required}
            ?disabled=${this.disabled}
            aria-label=${this.label ? nothing : this.copy.choose}
            aria-invalid=${this.invalid || Boolean(this.error)}
            aria-describedby=${described || nothing}
            @input=${(event: Event) => event.stopPropagation()}
            @cancel=${(event: Event) => event.stopPropagation()}
            @change=${(event: Event) => {
              const input = event.target as HTMLInputElement;
              const files = [...(input.files ?? [])];
              input.value = "";
              this.#change(event, files);
            }}
          />
        </div>
        <slot name="help"></slot>
      </div>
      ${this.error ? html`<p class="error" data-error id=${this.#errorId}>${this.error}</p>` : nothing}`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "wt-file-input": WtFileInput;
  }
}
