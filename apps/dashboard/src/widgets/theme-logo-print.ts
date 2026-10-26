import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import { watchMediaImage } from "@waitron/ui/src/live-media-image.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-icon.js";
import type { DashboardApi, ThemeLogoPrint } from "../api/client.js";
import { t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { fixLineStyles } from "./fix-line-styles.js";
import { paperGround, rasterUrl } from "./print-paper.js";

type Shown =
  | { kind: "asking" }
  | { kind: "failed" }
  | { kind: "none" }
  | { kind: "shown"; url: string; width: string; blank: boolean };

/**
 * How the theme's logo prints on an 80 mm receipt, redrawn when the library reframes it, and not
 * drawn while the library no longer holds it.
 */
@customElement("dashboard-theme-logo-print")
export class ThemeLogoPrintFigure extends LitElement {
  static override styles = [
    baseStyles,
    fixLineStyles,
    css`
      :host {
        display: block;
      }
      figure {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-3);
        margin: 0;
      }
      .paper {
        ${paperGround}
        box-sizing: content-box;
        width: calc(var(--wt-space-6) * 6);
        padding: var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
      }
      .paper img {
        display: block;
        height: auto;
        image-rendering: pixelated;
      }
      figcaption,
      .failed {
        flex: 1 1 calc(var(--wt-space-6) * 5);
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }
      .failed {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
        margin: 0;
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) image: string | null = null;

  @state() private shown: Shown = { kind: "none" };

  #generation = 0;
  #watched: string | null = null;
  #stopWatching: (() => void) | undefined;
  /** The image's `display` address as last heard: `undefined` before the first, `null` once gone. */
  #heard: string | null | undefined;
  /**
   * What was heard when the latest ask began. An answer drawn from another address is asked for
   * again only once something newer than this is heard, so two spellings of one address cannot loop.
   */
  #basis: string | null | undefined;
  /** The address the shown answer was drawn from. */
  #drawnFrom: string | null | undefined;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#watch();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#watch();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("image")) {
      this.#heard = undefined;
      this.#watch();
      void this.#ask();
    }
  }

  /** Holds one watch on the current image while connected, and none otherwise. */
  #watch(): void {
    const wanted = this.isConnected ? this.image : null;
    if (wanted === this.#watched) return;
    this.#stopWatching?.();
    this.#stopWatching = undefined;
    this.#watched = wanted;
    if (wanted !== null)
      this.#stopWatching = watchMediaImage(wanted, "display", (address) => this.#hear(address));
  }

  #hear(address: string | undefined): void {
    const previous = this.#heard;
    if (address === undefined) {
      this.#heard = null;
      this.#generation++;
      this.shown = { kind: "none" };
      return;
    }
    this.#heard = address;
    if (this.shown.kind === "asking") return;
    if (previous === null) void this.#ask();
    else if (this.shown.kind === "failed") {
      if (typeof previous === "string" && previous !== address) void this.#ask();
    } else if (address !== this.#drawnFrom && address !== this.#basis) void this.#ask();
  }

  async #ask(): Promise<void> {
    const generation = ++this.#generation;
    const image = this.image;
    if (image === null) {
      this.shown = { kind: "none" };
      return;
    }
    const basis = this.#heard;
    this.#basis = basis;
    this.shown = { kind: "asking" };
    let print: ThemeLogoPrint;
    try {
      print = await this.api.getThemeLogoPrint(image);
    } catch {
      if (generation === this.#generation) this.shown = { kind: "failed" };
      return;
    }
    if (generation !== this.#generation) return;
    this.#drawnFrom = print.address;
    this.shown =
      print.picture === null
        ? { kind: "none" }
        : {
            kind: "shown",
            url: rasterUrl(print.picture),
            width: `${(print.picture.widthDots / print.paperDots) * 100}%`,
            blank: print.blackDots === 0,
          };
    const heard = this.#heard;
    if (typeof heard === "string" && heard !== print.address && heard !== basis) void this.#ask();
  }

  override render() {
    const shown = this.shown;
    if (shown.kind === "none") return nothing;
    if (shown.kind === "failed")
      return html`<p class="failed" data-test="logo-print-failed">
        <span>${t("appearance.logo_print_failed")}</span>
        <wt-button variant="secondary" @click=${() => void this.#ask()}
          >${t("appearance.logo_print_retry")}</wt-button
        >
      </p>`;
    const picture = shown.kind === "shown" ? shown : undefined;
    return html`<figure data-test="logo-print" aria-busy=${picture ? "false" : "true"}>
        <div class="paper">
          ${
            picture
              ? html`<img src=${picture.url} style=${`width:${picture.width}`} alt="" />`
              : nothing
          }
        </div>
        <figcaption>${t("appearance.logo_print")}</figcaption>
      </figure>
      ${
        picture?.blank
          ? html`<p class="warning" data-test="logo-print-blank">
              <wt-icon name="warning"></wt-icon><span>${t("appearance.logo_print_blank")}</span>
            </p>`
          : nothing
      }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-theme-logo-print": ThemeLogoPrintFigure;
  }
}
