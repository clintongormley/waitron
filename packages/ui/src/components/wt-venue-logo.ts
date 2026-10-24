import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { styleMap } from "lit/directives/style-map.js";
import { baseStyles } from "../base-styles.js";
import { ColorSchemeController } from "../color-scheme.js";

export type WtVenueLogoSize = "banner" | "bar" | "sign-in";

export const VENUE_LOGO_RETRY_MS = 60_000;

/**
 * A venue's logo in a box of fixed height. It draws `dark` on a dark screen when there is one,
 * else `light`, which once loaded sits on a white plate on a dark screen. The image keeps its own
 * shape: it is drawn as large as the box's height and width allow, and the box keeps its height
 * while the image loads or when there is none. While the image fails it shows only its `fallback`
 * slot and asks for the same address again every `VENUE_LOGO_RETRY_MS`.
 */
@customElement("wt-venue-logo")
export class WtVenueLogo extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        --wt-venue-logo-ratio: 0;
        display: inline-flex;
        min-inline-size: 0;
        max-inline-size: 100%;
        vertical-align: middle;
      }

      .box {
        --wt-venue-logo-height: calc(var(--wt-space-6) + var(--wt-space-2));
        --wt-venue-logo-width: calc(var(--wt-space-6) * 5);
        --wt-venue-logo-inset: 0px;
        display: inline-flex;
        align-items: center;
        block-size: var(--wt-venue-logo-height);
        min-inline-size: 0;
        max-inline-size: 100%;
        padding: var(--wt-venue-logo-inset);
      }

      :host([size="bar"]) .box {
        --wt-venue-logo-height: var(--wt-space-6);
        --wt-venue-logo-width: calc(var(--wt-space-6) * 4);
      }

      :host([size="sign-in"]) .box {
        --wt-venue-logo-height: calc(var(--wt-space-6) * 3);
        --wt-venue-logo-width: calc(var(--wt-space-6) * 10);
      }

      .box[data-plate] {
        --wt-venue-logo-inset: var(--wt-space-1);
        background: var(--wt-color-logo-plate);
        border-radius: var(--wt-radius-sm);
      }

      .box img {
        display: block;
        inline-size: min(
          calc(var(--wt-venue-logo-width) - 2 * var(--wt-venue-logo-inset)),
          calc(
            (var(--wt-venue-logo-height) - 2 * var(--wt-venue-logo-inset)) *
              var(--wt-venue-logo-ratio)
          )
        );
        max-inline-size: 100%;
        block-size: auto;
        aspect-ratio: var(--wt-venue-logo-ratio);
      }
    `,
  ];

  @property() light = "";
  @property() dark = "";
  @property() alt = "";
  @property({ reflect: true }) size: WtVenueLogoSize = "banner";

  @state() private ratio = 0;
  @state() private broken = false;
  @state() private attempt = 0;

  /** Reflected as the `failed` attribute; set by the box alone. */
  get failed(): boolean {
    return this.broken;
  }

  readonly #scheme = new ColorSchemeController(this);
  #drawn!: string;
  #timer: ReturnType<typeof setTimeout> | undefined;

  get #src(): string {
    return this.#scheme.dark && this.dark ? this.dark : this.light;
  }

  // Not willUpdate: Lit runs that before the controller's hostUpdate reads the scheme.
  protected override update(changed: PropertyValues<this>): void {
    const src = this.#src;
    if (src !== this.#drawn) {
      this.#drawn = src;
      this.ratio = 0;
      this.broken = false;
      this.attempt = 0;
      this.#stopTimer();
    }
    this.toggleAttribute("failed", this.broken);
    super.update(changed);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.broken) this.#startTimer();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#stopTimer();
  }

  #startTimer(): void {
    this.#stopTimer();
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.attempt++;
    }, VENUE_LOGO_RETRY_MS);
  }

  #stopTimer(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  readonly #onLoad = (event: Event): void => {
    event.stopPropagation();
    this.#loaded(event.currentTarget as HTMLImageElement);
  };

  #loaded(image: HTMLImageElement): void {
    const announced = this.ratio > 0;
    this.ratio = image.naturalWidth / image.naturalHeight;
    // A retry's hidden image has already said so for the image drawn after it.
    if (!announced) this.#emit("wt-logo-load");
  }

  readonly #onError = (event: Event): void => {
    event.stopPropagation();
    this.broken = true;
    this.ratio = 0;
    this.#emit("wt-logo-error");
    if (this.isConnected) this.#startTimer();
  };

  // A hidden image removed by an address change can still answer; it no longer speaks for the box.
  #stale(event: Event): boolean {
    return !(event.currentTarget as HTMLImageElement).isConnected;
  }

  readonly #onRetryLoad = (event: Event): void => {
    event.stopPropagation();
    if (this.#stale(event)) return;
    this.broken = false;
    this.attempt = 0;
    this.#loaded(event.currentTarget as HTMLImageElement);
  };

  readonly #onRetryError = (event: Event): void => {
    event.stopPropagation();
    if (this.#stale(event)) return;
    this.#startTimer();
  };

  #emit(type: string): void {
    this.dispatchEvent(
      new CustomEvent(type, { detail: { src: this.#drawn }, bubbles: true, composed: true }),
    );
  }

  override render() {
    const src = this.#drawn;
    if (this.broken) {
      return html`<slot name="fallback"></slot>${
          this.attempt > 0
            ? keyed(
                this.attempt,
                html`<img
                  hidden
                  src=${src}
                  alt=""
                  @load=${this.#onRetryLoad}
                  @error=${this.#onRetryError}
                />`,
              )
            : nothing
        }`;
    }
    const plate = this.#scheme.dark && !this.dark && this.ratio > 0;
    return html`<span
      class="box"
      part="box"
      ?data-plate=${plate}
      style=${styleMap({ "--wt-venue-logo-ratio": String(this.ratio) })}
      >${
        src
          ? html`<img
              part="image"
              src=${src}
              alt=${this.alt}
              @load=${this.#onLoad}
              @error=${this.#onError}
            />`
          : nothing
      }</span
    >`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-venue-logo": WtVenueLogo;
  }
}
