import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, draftScopeFor, type DraftScope } from "@waitron/ui";
import { cropRect, DEFAULT_FRAMING, rasterCrop, type ImageFraming } from "../framing.js";
import { t } from "./strings.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-slider.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";

export function sameFraming(a: ImageFraming, b: ImageFraming): boolean {
  return a.x === b.x && a.y === b.y && a.zoom === b.zoom;
}

@customElement("media-photo-preview")
export class PhotoPreview extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      canvas {
        display: block;
        width: 100%;
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
      }
    `,
  ];
  @property() source = "";
  @property({ attribute: false }) framing: ImageFraming = { ...DEFAULT_FRAMING };
  @property({ type: Number }) ratio = 1;
  @property() label = "";
  @state() private loaded = false;
  #generation = 0;
  #image?: HTMLImageElement;
  override connectedCallback(): void {
    super.connectedCallback();
    if (this.hasUpdated) this.#load();
  }
  override disconnectedCallback(): void {
    this.#generation++;
    this.#image = undefined;
    this.loaded = false;
    super.disconnectedCallback();
  }
  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("source")) this.#load();
  }
  #load(): void {
    const generation = ++this.#generation;
    this.loaded = false;
    this.#image = undefined;
    const image = new Image();
    image.onload = () => {
      if (generation !== this.#generation || !this.isConnected) return;
      this.#image = image;
      this.loaded = true;
      this.dispatchEvent(
        new CustomEvent("photo-load", {
          detail: { width: image.naturalWidth, height: image.naturalHeight },
          bubbles: true,
          composed: true,
        }),
      );
    };
    image.onerror = () => {
      if (generation !== this.#generation || !this.isConnected) return;
      this.dispatchEvent(new CustomEvent("photo-error", { bubbles: true, composed: true }));
    };
    image.src = this.source;
  }
  override updated(): void {
    const canvas = this.shadowRoot!.querySelector("canvas")!;
    const context = canvas.getContext("2d")!;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const image = this.#image;
    if (!image || !this.loaded) return;
    const crop = rasterCrop(image.naturalWidth, image.naturalHeight, this.ratio, this.framing);
    // Centre the outward-rounded extraction just as the server's final cover resize does.
    const width = Math.min(crop.width, crop.height * this.ratio);
    const height = Math.min(crop.height, crop.width / this.ratio);
    context.drawImage(
      image,
      crop.left + (crop.width - width) / 2,
      crop.top + (crop.height - height) / 2,
      width,
      height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
  }
  override render() {
    return html`<canvas
      width="480"
      height=${Math.round(480 / this.ratio)}
      role="img"
      aria-label=${this.label}
      data-loaded=${String(this.loaded)}
    ></canvas>`;
  }
}

@customElement("media-photo-framing-dialog")
export class PhotoFramingDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .content {
        display: grid;
        gap: var(--wt-space-4);
        max-width: var(--wt-form-max-width);
        margin-inline: auto;
      }
      .frame {
        width: min(100%, 45dvh);
        justify-self: center;
        touch-action: none;
        cursor: grab;
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        overflow: hidden;
      }
      .frame[data-dragging] {
        cursor: grabbing;
      }
      .frame:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      .previews {
        display: flex;
        gap: var(--wt-space-4);
        flex-wrap: wrap;
      }
      figure {
        margin: 0;
        width: calc(var(--wt-tap-min) * 3);
        max-width: 40%;
      }
      figcaption,
      .instruction {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .instruction {
        margin: 0;
      }
      .error {
        color: var(--wt-color-danger);
      }
    `,
  ];
  @property() source = "";
  @property({ attribute: false }) framing: ImageFraming = { ...DEFAULT_FRAMING };
  @property({ attribute: false }) draftParent?: object;
  @property({ attribute: false }) opener: HTMLElement | null = null;
  @state() private draft: ImageFraming = { ...DEFAULT_FRAMING };
  @state() private dimensions?: { width: number; height: number };
  @state() private failed = false;
  #pointer?: { id: number; x: number; y: number };
  @state() private dragging = false;
  #scope?: DraftScope<ImageFraming>;
  #baseline: ImageFraming = { ...DEFAULT_FRAMING };
  override connectedCallback(): void {
    super.connectedCallback();
    const { scope } = draftScopeFor(this, {
      id: this,
      parent: this.draftParent,
      current: () => this.draft,
      snapshot: (v: ImageFraming) => ({ ...v }),
      equal: sameFraming,
      restore: (v) => {
        this.draft = { ...v };
      },
    });
    this.#scope = scope;
    this.#scope.commit(this.#baseline);
  }
  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#pointer = undefined;
    this.dragging = false;
    super.disconnectedCallback();
  }
  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("framing")) {
      this.draft = { ...this.framing };
      this.#baseline = { ...this.framing };
      this.#scope?.commit(this.draft);
    }
    if (changed.has("source")) {
      this.dimensions = undefined;
      this.failed = false;
      this.#end();
    }
  }
  #change(framing: ImageFraming): void {
    this.draft = framing;
    this.#scope?.changed();
  }
  #key(event: KeyboardEvent): void {
    const direction = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }[event.key];
    if (!direction || !this.dimensions) return;
    event.preventDefault();
    event.stopPropagation();
    const step = event.shiftKey ? 1000 : 100;
    this.#change({
      ...this.draft,
      x: Math.max(0, Math.min(10000, this.draft.x + direction[0]! * step)),
      y: Math.max(0, Math.min(10000, this.draft.y + direction[1]! * step)),
    });
  }
  #start(event: PointerEvent): void {
    if (event.button !== 0 || this.#pointer || !this.dimensions) return;
    event.preventDefault();
    event.stopPropagation();
    const frame = event.currentTarget as HTMLElement;
    frame.focus();
    frame.setPointerCapture(event.pointerId);
    this.#pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    this.dragging = true;
  }
  #move(event: PointerEvent): void {
    const pointer = this.#pointer;
    const size = this.dimensions;
    if (!pointer || pointer.id !== event.pointerId || !size) return;
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
    if (!box.width || !box.height) return;
    const crop = cropRect(size.width, size.height, 1, this.draft);
    this.#change({
      ...this.draft,
      x: Math.max(
        0,
        Math.min(
          10000,
          Math.round(
            this.draft.x -
              (((event.clientX - pointer.x) * crop.width) / box.width / size.width) * 10000,
          ),
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          10000,
          Math.round(
            this.draft.y -
              (((event.clientY - pointer.y) * crop.height) / box.height / size.height) * 10000,
          ),
        ),
      ),
    });
    pointer.x = event.clientX;
    pointer.y = event.clientY;
  }
  #end(event?: PointerEvent): void {
    if (event && this.#pointer?.id !== event.pointerId) return;
    const frame = this.shadowRoot?.querySelector<HTMLElement>("[data-test=frame]");
    const id = this.#pointer?.id;
    this.#pointer = undefined;
    this.dragging = false;
    if (id !== undefined && frame?.hasPointerCapture(id)) frame.releasePointerCapture(id);
  }
  #close(): void {
    this.dispatchEvent(new CustomEvent("close", { bubbles: true, composed: true }));
  }
  #backdrop(event: MouseEvent): void {
    const target = event.composedPath()[0];
    if (!(target instanceof HTMLDialogElement)) return;
    const box = target.getBoundingClientRect();
    if (
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom
    )
      void this.shadowRoot!.querySelector("wt-modal")!.requestClose("cancel");
  }
  #preview(name: "lists" | "till", ratio: number) {
    return html`<figure>
      <media-photo-preview
        data-test=${name}
        .source=${this.source}
        .framing=${this.draft}
        .ratio=${ratio}
        .label=${t(name === "lists" ? "image.lists" : "image.till_buttons")}
      ></media-photo-preview>
      <figcaption>${t(name === "lists" ? "image.lists" : "image.till_buttons")}</figcaption>
    </figure>`;
  }
  override render() {
    return html`<wt-modal
      size="standard"
      open
      heading=${t("image.adjust_framing")}
      .opener=${this.opener}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.#close();
      }}
      @click=${this.#backdrop}
      @keydown=${(event: KeyboardEvent) => {
        if (event.key === "Enter") event.stopPropagation();
      }}
    >
      <div class="content">
        <div
          class="frame"
          data-test="frame"
          role="group"
          tabindex="0"
          aria-label=${t("image.photo_position")}
          aria-describedby="framing-instruction"
          ?data-dragging=${this.dragging}
          @keydown=${this.#key}
          @pointerdown=${this.#start}
          @pointermove=${this.#move}
          @pointerup=${(e: PointerEvent) => {
            this.#move(e);
            this.#end(e);
          }}
          @pointercancel=${this.#end}
          @lostpointercapture=${this.#end}
        >
          <media-photo-preview
            data-test="frame-image"
            data-zoom=${this.draft.zoom}
            .source=${this.source}
            .framing=${this.draft}
            .label=${t("image.preview")}
            @photo-load=${(event: CustomEvent<{ width: number; height: number }>) => {
              event.stopPropagation();
              this.dimensions = event.detail;
              this.failed = false;
            }}
            @photo-error=${(event: Event) => {
              event.stopPropagation();
              this.dimensions = undefined;
              this.failed = true;
            }}
          ></media-photo-preview>
        </div>
        <p class="instruction" id="framing-instruction">${t("image.framing_instruction")}</p>
        ${
          this.failed
            ? html`<p class="error" role="alert">
                ${t("image.photo_load_error")}
                <wt-button
                  variant="secondary"
                  @click=${() => {
                    this.failed = false;
                    this.shadowRoot!.querySelector<PhotoPreview>(
                      "[data-test=frame-image]",
                    )!.requestUpdate("source");
                  }}
                  >${t("image.retry")}</wt-button
                >
              </p>`
            : !this.dimensions
              ? html`<p role="status">${t("image.photo_loading")}</p>`
              : nothing
        }
        <wt-slider
          name="photo-zoom"
          label=${t("image.zoom")}
          .min=${100}
          .max=${400}
          .step=${1}
          .value=${this.draft.zoom}
          .continuous=${true}
          ?disabled=${!this.dimensions}
          @wt-change=${(event: CustomEvent<{ value: number }>) => {
            event.stopPropagation();
            this.#change({ ...this.draft, zoom: event.detail.value });
          }}
        ></wt-slider>
        <div class="previews">${this.#preview("lists", 1)} ${this.#preview("till", 4 / 3)}</div>
      </div>
      <wt-form-actions slot="footer"
        ><wt-button
          slot="cancel"
          data-test="reset"
          variant="secondary"
          ?disabled=${sameFraming(this.draft, DEFAULT_FRAMING)}
          @click=${() => this.#change({ ...DEFAULT_FRAMING })}
          >${t("image.reset")}</wt-button
        >
        <wt-button
          data-test="done"
          variant="primary"
          @click=${() => {
            this.#baseline = { ...this.draft };
            this.#scope?.commit(this.draft);
            this.dispatchEvent(
              new CustomEvent("done", {
                detail: { framing: { ...this.draft } },
                bubbles: true,
                composed: true,
              }),
            );
          }}
          >${t("image.done")}</wt-button
        ></wt-form-actions
      >
    </wt-modal>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "media-photo-framing-dialog": PhotoFramingDialog;
    "media-photo-preview": PhotoPreview;
  }
}
