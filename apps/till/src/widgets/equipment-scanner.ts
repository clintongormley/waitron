import { LitElement, css, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import jsQR from "jsqr";
import { baseStyles } from "@waitron/ui";
import { parseEquipmentCode, type EquipmentKind } from "@waitron/shared";
import { t } from "../i18n/t.js";

/** How often a frame is read from the camera. */
const FRAME_MS = 250;
/** Frames wider than this are scaled down before decoding, which a label held up to the camera
 * survives and which keeps each read short on a handheld. */
const DECODE_WIDTH = 640;

type Message = "camera_unavailable" | "scan_not_ours" | "scan_not_printer" | "scan_not_reader";

/**
 * Films with the rear camera and reads equipment labels until one of `kind` is seen, then stops
 * the camera and emits `equipment-scanned` with its id. Anything else is said and scanning goes
 * on. The camera stops when the scanner leaves the page.
 */
@customElement("till-equipment-scanner")
export class TillEquipmentScanner extends LitElement {
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
      }
    `,
  ];

  @property() kind: EquipmentKind = "printer";
  @state() private message: Message | null = null;
  @state() private filming = false;
  @query("video") private video?: HTMLVideoElement;

  #stream?: MediaStream;
  #timer?: ReturnType<typeof setInterval>;
  #frame?: CanvasRenderingContext2D;
  /** Moved on whenever the camera stops, so a camera that answers afterwards is stopped at once. */
  #session = 0;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#start();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#stop();
  }

  async #start(): Promise<void> {
    const session = ++this.#session;
    const media = navigator.mediaDevices as MediaDevices | undefined;
    if (media?.getUserMedia === undefined) {
      this.message = "camera_unavailable";
      return;
    }
    let stream: MediaStream;
    try {
      stream = await media.getUserMedia({ video: { facingMode: "environment" } });
    } catch {
      if (session === this.#session) this.message = "camera_unavailable";
      return;
    }
    if (session !== this.#session) {
      for (const track of stream.getTracks()) track.stop();
      return;
    }
    this.#stream = stream;
    this.filming = true;
    await this.updateComplete;
    const video = this.video!;
    video.srcObject = stream;
    void video.play().catch(() => undefined);
    this.#timer = setInterval(() => this.#read(), FRAME_MS);
  }

  #stop(): void {
    this.#session++;
    clearInterval(this.#timer);
    this.#timer = undefined;
    for (const track of this.#stream?.getTracks() ?? []) track.stop();
    this.#stream = undefined;
  }

  #read(): void {
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
    const decoded = jsQR(this.#frame.getImageData(0, 0, width, height).data, width, height);
    if (decoded === null) return;
    const code = parseEquipmentCode(decoded.data);
    if (code === null) {
      this.message = "scan_not_ours";
    } else if (code.kind !== this.kind) {
      this.message = this.kind === "printer" ? "scan_not_printer" : "scan_not_reader";
    } else {
      this.#stop();
      this.dispatchEvent(
        new CustomEvent<{ id: string }>("equipment-scanned", {
          detail: { id: code.id },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  override render() {
    return html`${
        this.filming && this.message !== "camera_unavailable"
          ? html`<video muted playsinline aria-label=${t("equipment.camera_label")}></video>`
          : nothing
      }
      <p class="message" data-scanner-message role="status">
        ${this.message === null ? t("equipment.scan_hint") : t(`equipment.${this.message}`)}
      </p>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-equipment-scanner": TillEquipmentScanner;
  }
}
