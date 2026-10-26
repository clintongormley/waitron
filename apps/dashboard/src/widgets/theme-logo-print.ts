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

/** How the theme's logo prints on an 80 mm receipt, redrawn when the library reframes it. */
@customElement("dashboard-theme-logo-print")
export class DashboardThemeLogoPrint extends LitElement {
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
  /** The image's last heard display address; a different one means it was reframed. */
  #address: string | undefined;

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
      this.#address = undefined;
      this.#watch();
      this.#ask();
    }
  }

  /** Holds one watch on the current image while connected, and none otherwise. */
  #watch(): void {
    const wanted = this.isConnected ? this.image : null;
    if (wanted === this.#watched && (wanted === null || this.#stopWatching)) return;
    this.#stopWatching?.();
    this.#stopWatching = undefined;
    this.#watched = wanted;
    if (wanted === null) return;
    this.#stopWatching = watchMediaImage(wanted, "display", (address) => {
      if (address === undefined) return;
      const known = this.#address;
      this.#address = address;
      if (known !== undefined && known !== address) this.#ask();
    });
  }

  #ask(): void {
    const generation = ++this.#generation;
    const image = this.image;
    if (image === null) {
      this.shown = { kind: "none" };
      return;
    }
    this.shown = { kind: "asking" };
    let asked: Promise<ThemeLogoPrint>;
    try {
      asked = this.api.getThemeLogoPrint(image);
    } catch (error) {
      asked = Promise.reject(error);
    }
    asked.then(
      (print) => {
        if (generation !== this.#generation) return;
        this.shown =
          print.picture === null
            ? { kind: "none" }
            : {
                kind: "shown",
                url: rasterUrl(print.picture),
                width: `${(print.picture.widthDots / print.paperDots) * 100}%`,
                blank: print.blackDots === 0,
              };
      },
      () => {
        if (generation === this.#generation) this.shown = { kind: "failed" };
      },
    );
  }

  override render() {
    const shown = this.shown;
    if (shown.kind === "none") return nothing;
    if (shown.kind === "failed")
      return html`<p class="failed" data-test="logo-print-failed">
        <span>${t("appearance.logo_print_failed")}</span>
        <wt-button variant="secondary" @click=${() => this.#ask()}
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
    "dashboard-theme-logo-print": DashboardThemeLogoPrint;
  }
}
