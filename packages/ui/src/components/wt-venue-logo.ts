import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";
import { baseStyles } from "../base-styles.js";
import { ColorSchemeController } from "../color-scheme.js";

export type WtVenueLogoSize = "banner" | "bar" | "sign-in";

/**
 * A venue's logo in a box of fixed height. It draws `dark` on a dark screen when there is one,
 * else `light`, on a white plate when the screen is dark. The image keeps its own shape: it is
 * drawn as large as the box's height and width allow, and the box keeps its height while the image
 * loads or when there is none.
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

      img {
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

  readonly #scheme = new ColorSchemeController(this);
  #drawn!: string;

  get #src(): string {
    return this.#scheme.dark && this.dark ? this.dark : this.light;
  }

  // Not willUpdate: Lit runs that before the controller's hostUpdate reads the scheme.
  protected override update(changed: PropertyValues<this>): void {
    const src = this.#src;
    if (src !== this.#drawn) {
      this.#drawn = src;
      this.ratio = 0;
    }
    super.update(changed);
  }

  readonly #onLoad = (event: Event): void => {
    event.stopPropagation();
    const image = event.currentTarget as HTMLImageElement;
    this.ratio = image.naturalWidth / image.naturalHeight;
    this.#emit("wt-logo-load");
  };

  readonly #onError = (event: Event): void => {
    event.stopPropagation();
    this.#emit("wt-logo-error");
  };

  #emit(type: string): void {
    this.dispatchEvent(
      new CustomEvent(type, { detail: { src: this.#drawn }, bubbles: true, composed: true }),
    );
  }

  override render() {
    const src = this.#drawn;
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
