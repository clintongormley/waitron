import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type jsQR from "jsqr";
import { baseStyles } from "../base-styles.js";

/** How often a frame is read from the camera. */
export const QR_FRAME_MS = 250;
const DECODE_WIDTH = 640;

/** `failed`: the camera answered, then gave no picture or stopped by itself. */
export type QrScannerUnavailableReason = "unsupported" | "refused" | "failed";

/** Whether this browser offers a camera at all; it says nothing about permission. */
export function canFilm(): boolean {
  return (navigator.mediaDevices as MediaDevices | undefined)?.getUserMedia !== undefined;
}

/**
 * Films with the rear camera and emits `wt-qr-read` for every QR code it reads, until `stop()`,
 * until it leaves the page, or until the camera fails and it emits `wt-qr-unavailable`. The caller
 * judges each code: it calls `stop()` on one it keeps, or sets `message` and lets scanning go on.
 */
@customElement("wt-qr-scanner")
export class WtQrScanner extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-2);
      }

      video {
        width: 100%;
        max-height: 50vh;
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface-raised);
        object-fit: cover;
      }

      .message {
        margin: 0;
        color: var(--wt-color-text);
      }

      .camera {
        position: relative;
        height: var(--wt-camera-height);
        border-radius: calc(var(--wt-radius-md) + var(--wt-space-1));
        background: var(--wt-color-camera);
        overflow: hidden;
      }

      .camera video {
        height: 100%;
        max-height: none;
        border-radius: 0;
        background: none;
      }

      .bracket {
        position: absolute;
        width: var(--wt-camera-bracket-size);
        height: var(--wt-camera-bracket-size);
        border: var(--wt-camera-bracket-line) solid var(--wt-color-on-camera);
      }

      .bracket.top {
        inset-block-start: var(--wt-camera-bracket-inset-block);
        border-block-end: 0;
      }

      .bracket.bottom {
        inset-block-end: var(--wt-camera-bracket-inset-block);
        border-block-start: 0;
      }

      .bracket.start {
        inset-inline-start: var(--wt-camera-bracket-inset-inline);
        border-inline-end: 0;
      }

      .bracket.end {
        inset-inline-end: var(--wt-camera-bracket-inset-inline);
        border-inline-start: 0;
      }

      .bracket.top.start {
        border-start-start-radius: var(--wt-radius-md);
      }

      .bracket.top.end {
        border-start-end-radius: var(--wt-radius-md);
      }

      .bracket.bottom.start {
        border-end-start-radius: var(--wt-radius-md);
      }

      .bracket.bottom.end {
        border-end-end-radius: var(--wt-radius-md);
      }

      /* Its own strip, so the words read whatever the camera shows. */
      .caption {
        position: absolute;
        inset-inline: 0;
        inset-block-end: 0;
        margin: 0;
        padding: var(--wt-space-2);
        text-align: center;
        color: var(--wt-color-on-camera);
        background: var(--wt-color-camera);
        font-size: var(--wt-font-size-sm);
      }

      @media (forced-colors: active) {
        .camera {
          border: var(--wt-field-line-width) solid CanvasText;
        }
      }

      .refusal {
        color: var(--wt-color-danger);
        font-size: var(--wt-font-size-lg);
        font-weight: var(--wt-font-weight-bold);
      }
    `,
  ];

  /** The video's accessible name. */
  @property() label = "";
  /** Unframed, the line under the video while no `message` is set; framed, the caption's fallback. */
  @property() hint = "";
  /** The caller's refusal of the latest code, drawn under the video or box as an alert. */
  @property() message = "";
  /** Shown in place of everything else once the scanner fires `wt-qr-unavailable`. */
  @property() unavailable = "";
  /** Films inside a fixed dark camera box with corner brackets and `caption` along its foot. */
  @property({ type: Boolean, reflect: true }) framed = false;
  /** The framed look's fixed words along the foot of the box; empty draws `hint` there. */
  @property() caption = "";
  @state() private phase: "starting" | "filming" | "failed" = "starting";
  @query("video") private video?: HTMLVideoElement;

  #stream?: MediaStream;
  #timer?: ReturnType<typeof setInterval>;
  #frame?: CanvasRenderingContext2D;
  #watch?: AbortController;
  /** Moved on whenever the camera stops, so a camera that answers afterwards is stopped at once. */
  #session = 0;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#start();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.stop();
  }

  /** Stops the camera and reads no more frames. */
  stop(): void {
    this.#session++;
    clearInterval(this.#timer);
    this.#timer = undefined;
    this.#watch?.abort();
    this.#watch = undefined;
    for (const track of this.#stream?.getTracks() ?? []) track.stop();
    this.#stream = undefined;
  }

  async #start(): Promise<void> {
    const session = ++this.#session;
    if (!canFilm()) {
      this.#fail("unsupported");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    } catch {
      if (session === this.#session) this.#fail("refused");
      return;
    }
    if (session !== this.#session) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    this.#stream = stream;
    this.#watch = new AbortController();
    for (const track of stream.getTracks())
      track.addEventListener("ended", () => this.#fail("failed"), { signal: this.#watch.signal });
    this.phase = "filming";
    // A scanner put back on the page is already filming, so the phase alone redraws nothing.
    this.requestUpdate();
    // Loaded only once a camera answers, so a page that never films never downloads it.
    const decode = await import("jsqr").then(
      (module) => module.default,
      () => undefined,
    );
    if (session !== this.#session) return;
    if (decode === undefined) {
      this.#fail("unsupported");
      return;
    }
    this.#timer = setInterval(() => this.#read(decode), QR_FRAME_MS);
  }

  #fail(reason: QrScannerUnavailableReason): void {
    this.stop();
    this.phase = "failed";
    this.dispatchEvent(
      new CustomEvent<{ reason: QrScannerUnavailableReason }>("wt-qr-unavailable", {
        detail: { reason },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #read(decode: typeof jsQR): void {
    const video = this.video;
    if (video === undefined || video.videoWidth === 0) return;
    const scale = Math.min(1, DECODE_WIDTH / video.videoWidth);
    const width = Math.round(video.videoWidth * scale);
    const height = Math.round(video.videoHeight * scale);
    if (this.#frame === undefined) {
      this.#frame = document
        .createElement("canvas")
        .getContext("2d", { willReadFrequently: true })!;
    }
    // Setting a canvas's size clears it, even to the size it already has.
    const canvas = this.#frame.canvas;
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    this.#frame.drawImage(video, 0, 0, width, height);
    const decoded = decode(this.#frame.getImageData(0, 0, width, height).data, width, height);
    this.onFrame(decoded?.data ?? null);
  }

  /**
   * Hands each frame read to the caller: its code, or `null` when it holds none. A subclass that
   * judges codes itself overrides it.
   */
  protected onFrame(text: string | null): void {
    if (text === null) return;
    this.dispatchEvent(
      new CustomEvent<{ text: string }>("wt-qr-read", {
        detail: { text },
        bubbles: true,
        composed: true,
      }),
    );
  }

  protected override updated(changed: PropertyValues<this>): void {
    super.updated(changed);
    // The only place a video gets the camera: a new camera, or a new video drawn by a change of look.
    const video = this.video;
    const stream = this.#stream;
    if (video === undefined || stream === undefined || video.srcObject === stream) return;
    video.srcObject = stream;
    const session = this.#session;
    void video.play().catch(() => {
      if (session === this.#session && this.video === video) this.#fail("failed");
    });
  }

  override render() {
    const failed = this.phase === "failed";
    const video =
      this.phase === "filming"
        ? html`<video muted playsinline aria-label=${this.label}></video>`
        : nothing;
    const framed = this.framed && !failed;
    const bracket = (top: string, side: string) =>
      html`<span
        class="bracket ${top} ${side}"
        data-scanner-bracket="${top}-${side}"
        aria-hidden="true"
      ></span>`;
    return html`${
      framed
        ? html`<div class="camera" data-scanner-camera>
            ${video}${bracket("top", "start")}${bracket("top", "end")}${bracket("bottom", "start")}${bracket("bottom", "end")}
            <p class="caption" data-scanner-caption>${this.caption || this.hint}</p>
          </div>`
        : video
    }
    ${
      !failed && this.message
        ? html`<p class="message refusal" data-scanner-message role="alert">${this.message}</p>`
        : framed
          ? nothing
          : html`<p class="message" data-scanner-message role="status">
              ${failed ? this.unavailable : this.hint}
            </p>`
    }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-qr-scanner": WtQrScanner;
  }
}
