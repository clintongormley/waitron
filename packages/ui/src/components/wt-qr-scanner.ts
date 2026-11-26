import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type jsQR from "jsqr";
import { baseStyles } from "../base-styles.js";

/** How often a frame is read from the camera. */
const FRAME_MS = 250;
/** Frames wider than this are scaled down before decoding, which a label held up to the camera
 * survives and which keeps each read short on a handheld. */
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
    `,
  ];

  /** The video's accessible name. */
  @property() label = "";
  /** Shown while no `message` is set. */
  @property() hint = "";
  /** The caller's line about the latest code; empty shows `hint`. */
  @property() message = "";
  /** Shown in place of everything else once the camera cannot start or stops by itself. */
  @property() unavailable = "";
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
    // `ended` fires only when the camera stops by itself, never for this element's own `stop()`.
    this.#watch = new AbortController();
    for (const track of stream.getTracks())
      track.addEventListener("ended", () => this.#fail("failed"), { signal: this.#watch.signal });
    this.phase = "filming";
    // Loaded only once a camera answers, so a page that never films never downloads it.
    const decoding = import("jsqr").then(
      (module) => module.default,
      () => undefined,
    );
    await this.updateComplete;
    if (session !== this.#session) return;
    const video = this.video!;
    video.srcObject = stream;
    void video.play().catch(() => {
      if (session === this.#session) this.#fail("failed");
    });
    const decode = await decoding;
    if (session !== this.#session) return;
    if (decode === undefined) {
      this.#fail("unsupported");
      return;
    }
    this.#timer = setInterval(() => this.#read(decode), FRAME_MS);
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
    if (decoded === null) return;
    this.onRead(decoded.data);
  }

  /** Hands a read code to the caller; a subclass that judges codes itself overrides it. */
  protected onRead(text: string): void {
    this.dispatchEvent(
      new CustomEvent<{ text: string }>("wt-qr-read", {
        detail: { text },
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    return html`${
        this.phase === "filming"
          ? html`<video muted playsinline aria-label=${this.label}></video>`
          : nothing
      }
      <p class="message" data-scanner-message role="status">
        ${this.phase === "failed" ? this.unavailable : this.message || this.hint}
      </p>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-qr-scanner": WtQrScanner;
  }
}
