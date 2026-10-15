import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import {
  baseStyles,
  disabledStyles,
  isHexColor,
  visuallyHiddenStyles,
  uniqueId,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-icon.js";
import { t } from "../i18n/t.js";

@customElement("dashboard-product-appearance")
export class ProductAppearance extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        align-items: center;
        gap: var(--wt-space-3);
        max-width: var(--wt-field-max-width);
      }
      .thumb {
        position: relative;
        width: var(--wt-tap-min);
        height: var(--wt-tap-min);
        padding: 0;
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        cursor: pointer;
      }
      .thumb:disabled {
        ${disabledStyles}
      }
      .thumb[aria-invalid="true"] {
        border-color: var(--wt-color-danger);
      }
      .thumb.inherited {
        border-style: dashed;
        border-color: var(--wt-color-text-muted);
      }
      .thumb img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: inherit;
      }
      .pencil {
        position: absolute;
        inset-inline-end: calc(-1 * var(--wt-space-1));
        inset-block-end: calc(-1 * var(--wt-space-1));
        display: grid;
        place-items: center;
        width: var(--wt-space-5);
        height: var(--wt-space-5);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-full);
        color: var(--wt-color-text-muted);
        background: var(--wt-color-surface);
      }
      .pencil wt-icon {
        width: var(--wt-space-3);
        height: var(--wt-space-3);
      }
      .caption {
        ${visuallyHiddenStyles}
      }
      [popover] {
        position: fixed;
        margin: 0;
        width: min(var(--wt-form-max-width), calc(100vw - 2 * var(--wt-space-4)));
        max-height: calc(100dvh - 2 * var(--wt-space-4));
        overflow: auto;
        padding: var(--wt-space-4);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-lg);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        box-shadow: var(--wt-shadow-2);
      }
      [popover]:popover-open {
        display: grid;
        gap: var(--wt-space-4);
      }
    `,
  ];
  @property() image: string | null = null;
  @property() inheritedImage: string | null = null;
  @property() color: string | null = null;
  @property({ type: Boolean }) disabled = false;
  @property({ type: Boolean }) invalid = false;
  readonly #captionId = uniqueId("product-appearance-caption");

  override updated(changed: PropertyValues<this>): void {
    if (changed.has("disabled") && this.disabled) this.closePanel();
  }

  openPanel(): void {
    if (this.disabled) return;
    const panel = this.shadowRoot!.querySelector<HTMLElement>("[popover]")!;
    if (panel.matches(":popover-open")) return;
    panel.showPopover();
    const anchor = this.shadowRoot!.querySelector(".thumb")!.getBoundingClientRect();
    const box = panel.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(this).getPropertyValue("--wt-space-2"));
    panel.style.left = `${Math.max(gap, Math.min(anchor.left, window.innerWidth - box.width - gap))}px`;
    panel.style.top = `${Math.max(gap, Math.min(anchor.bottom + gap, window.innerHeight - box.height - gap))}px`;
    panel.focus();
  }

  closePanel(): void {
    this.shadowRoot!.querySelector<HTMLElement>("[popover]")!.hidePopover();
  }

  async focusImage(): Promise<void> {
    await this.updateComplete;
    this.openPanel();
    const upload = this.querySelector("dashboard-image-upload");
    await upload?.updateComplete;
    upload?.shadowRoot!.querySelector<HTMLElement>("[data-test=choose-image]")?.focus();
  }

  async focusColor(): Promise<void> {
    await this.updateComplete;
    this.openPanel();
    this.querySelector<HTMLInputElement>('[name="product-color"]')?.focus();
  }

  override render() {
    const shown = this.image ?? this.inheritedImage;
    return html`<button
        type="button"
        class=${!this.image && this.inheritedImage ? "thumb inherited" : "thumb"}
        style=${isHexColor(this.color ?? "") ? `background:${this.color}` : nothing}
        aria-label=${`${t("image.label")} · ${t("editor.color")}`}
        aria-describedby=${!this.image && this.inheritedImage ? this.#captionId : nothing}
        aria-invalid=${this.invalid ? "true" : nothing}
        aria-haspopup="dialog"
        ?disabled=${this.disabled}
        @click=${(event: Event) => {
          event.stopPropagation();
          this.openPanel();
        }}
      >
        ${shown ? html`<img src=${`/media/${encodeURIComponent(shown)}`} alt="" />` : nothing}
        <span class="pencil"><wt-icon name="pencil"></wt-icon></span></button
      ><slot></slot>
      ${!this.image && this.inheritedImage ? html`<span class="caption" data-test="inherited-caption" id=${this.#captionId}>${t("editor.inherited_image_alt")}</span>` : nothing}
      <div
        popover="auto"
        role="dialog"
        aria-label=${`${t("image.label")} · ${t("editor.color")}`}
        tabindex="-1"
        @keydown=${(event: KeyboardEvent) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          event.stopPropagation();
          this.closePanel();
          this.shadowRoot!.querySelector<HTMLButtonElement>(".thumb")!.focus();
        }}
      >
        <slot name="controls"></slot>
      </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-product-appearance": ProductAppearance;
  }
}
