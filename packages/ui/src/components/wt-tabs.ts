import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { baseStyles } from "../base-styles.js";
import { delegatesFocusShadowRootOptions, uniqueId } from "../interactive.js";

export interface TabItem {
  key: string;
  label: string;
  /** Draws the tab in the primary colour with a "*" after its label; the text is what the star
   * means, and the tab is named "label, text". */
  marked?: string;
}

/** The fade spans this many `--wt-space-6`: wider than the padding and gap between two labels. */
const FADE_SPACES = 2;

@customElement("wt-tabs")
export class WtTabs extends LitElement {
  static override shadowRootOptions = delegatesFocusShadowRootOptions;
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      .tab-row {
        display: flex;
        align-items: center;
        min-width: 0;
        border-bottom: 1px solid var(--wt-color-border);
      }
      [role="tablist"] {
        display: flex;
        flex: 1 1 auto;
        min-width: 0;
        overflow-x: auto;
        gap: var(--wt-space-1);
        padding: var(--wt-space-1);
        --fade-start: 0px;
        --fade-end: 0px;
        --fade-towards: to right;
      }
      [role="tablist"]:dir(rtl) {
        --fade-towards: to left;
      }
      :host([data-overflow="start"]) [role="tablist"],
      :host([data-overflow="both"]) [role="tablist"] {
        --fade-start: var(--fade-width);
      }
      :host([data-overflow="end"]) [role="tablist"],
      :host([data-overflow="both"]) [role="tablist"] {
        --fade-end: var(--fade-width);
      }
      /* A mask reads only alpha, and the background token is opaque in every theme. */
      :host([data-overflow]) [role="tablist"] {
        mask-image: linear-gradient(
          var(--fade-towards),
          transparent 0,
          var(--wt-color-bg) var(--fade-start),
          var(--wt-color-bg) calc(100% - var(--fade-end)),
          transparent 100%
        );
      }
      .tab-actions {
        flex: 0 0 auto;
        max-width: calc(100% - 2 * var(--wt-tap-min));
        min-width: 0;
        overflow-x: auto;
        padding-inline: var(--wt-space-1);
      }
      ::slotted([slot="actions"]) {
        display: flex;
        flex-wrap: nowrap;
        width: max-content;
        gap: var(--wt-space-2);
      }
      button {
        flex: 0 0 auto;
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-4);
        border: 0;
        border-bottom: var(--wt-space-1) solid transparent;
        background: transparent;
        color: var(--wt-color-text-muted);
        font: inherit;
        cursor: pointer;
      }
      button[aria-selected="true"] {
        color: var(--wt-color-text);
        border-bottom-color: var(--wt-color-primary);
        font-weight: var(--wt-font-weight-bold);
      }
      button.marked {
        color: var(--wt-color-primary-text);
      }
      button:hover {
        background: var(--wt-color-surface);
      }
      [role="tabpanel"] {
        padding-block: var(--wt-space-3);
      }
      [hidden] {
        display: none;
      }
    `,
  ];
  @property({ attribute: false }) items: readonly TabItem[] = [];
  @property() value = "";
  @property() label = "";
  readonly #id = uniqueId("wt-tabs");

  get #selected(): string | undefined {
    return this.items.find((item) => item.key === this.value)?.key ?? this.items[0]?.key;
  }

  #select(event: Event, key: string): void {
    if (key === this.#selected) return;
    this.value = key;
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("wt-tab-change", { detail: { value: key }, bubbles: true, composed: true }),
    );
  }

  #keydown(event: KeyboardEvent, index: number): void {
    let next: number;
    switch (event.key) {
      case "ArrowLeft":
        next = (index + this.items.length - 1) % this.items.length;
        break;
      case "ArrowRight":
        next = (index + 1) % this.items.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = this.items.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.#select(event, this.items[next]!.key);
    const button = this.renderRoot.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]!;
    button.focus();
    button.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  // Only scrolls the strip, never resizes what it watches, so it needs no frame delay.
  readonly #stripObserver = new ResizeObserver(([entry]) => {
    const width = entry!.contentRect.width;
    if (width === this.#observedWidth) return;
    this.#observedWidth = width;
    this.#showSelected();
    this.#showOverflow();
  });
  #observedStrip: Element | null = null;
  #observedWidth: number | null = null;

  #observeStrip(): void {
    if (!this.isConnected) return;
    const bar = this.renderRoot.querySelector('[role="tablist"]');
    if (bar === this.#observedStrip) return;
    if (this.#observedStrip) this.#stripObserver.unobserve(this.#observedStrip);
    if (bar) this.#stripObserver.observe(bar);
    this.#observedStrip = bar;
    this.#observedWidth = null;
  }

  #selectedTab(): { tabs: HTMLButtonElement[]; index: number } {
    const tabs = [...this.renderRoot.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    return { tabs, index: tabs.findIndex((button) => button.dataset.key === this.#selected) };
  }

  // Never wider than half the room beside the selected tab, so the tab itself is never faded.
  #fadeWidth(bar: HTMLElement, tab: HTMLElement): number {
    const room = bar.getBoundingClientRect().width - tab.getBoundingClientRect().width;
    const full = parseFloat(getComputedStyle(bar).getPropertyValue("--wt-space-6")) * FADE_SPACES;
    return Math.max(0, Math.min(full, room / 2));
  }

  #showSelected(): void {
    const bar = this.renderRoot.querySelector<HTMLElement>('[role="tablist"]');
    const { tabs, index } = this.#selectedTab();
    const selected = tabs[index];
    if (!bar || !selected) return;

    // Move only the tab strip; scrolling the selected button into view can move the whole page.
    const barBounds = bar.getBoundingClientRect();
    const tabBounds = selected.getBoundingClientRect();
    const rtl = getComputedStyle(bar).direction === "rtl";
    // A tab wider than the strip shows its start, so its label reads from the beginning.
    if (tabBounds.width > barBounds.width) {
      bar.scrollLeft += rtl ? tabBounds.right - barBounds.right : tabBounds.left - barBounds.left;
      return;
    }
    // Stop short of a faded end wherever another tab lies beyond it, so that tab is the faint one.
    const fade = this.#fadeWidth(bar, selected);
    const before = index > 0 ? fade : 0;
    const after = index < tabs.length - 1 ? fade : 0;
    const toLeft = tabBounds.left - barBounds.left - (rtl ? after : before);
    const toRight = tabBounds.right - barBounds.right + (rtl ? before : after);
    if (rtl ? toRight > 0 : toLeft < 0) bar.scrollLeft += rtl ? toRight : toLeft;
    else if (rtl ? toLeft < 0 : toRight > 0) bar.scrollLeft += rtl ? toLeft : toRight;
  }

  // Scroll offsets are negative right to left, so the distance from the start is their size. The
  // strip's own padding hides no tab, so scrolling past only that is no cut.
  #showOverflow(): void {
    const bar = this.renderRoot.querySelector<HTMLElement>('[role="tablist"]');
    if (!bar) {
      delete this.dataset.overflow;
      return;
    }
    const style = getComputedStyle(bar);
    const fromStart = Math.abs(bar.scrollLeft);
    const start = fromStart - parseFloat(style.paddingInlineStart) >= 1;
    const end =
      bar.scrollWidth - bar.clientWidth - fromStart - parseFloat(style.paddingInlineEnd) >= 1;
    const overflow = start && end ? "both" : start ? "start" : end ? "end" : undefined;
    const { tabs, index } = this.#selectedTab();
    bar.style.setProperty("--fade-width", `${this.#fadeWidth(bar, tabs[index]!)}px`);
    if (overflow) this.dataset.overflow = overflow;
    else delete this.dataset.overflow;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.hasUpdated) this.#observeStrip();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#stripObserver.disconnect();
    this.#observedStrip = null;
  }

  override updated(changed: PropertyValues<this>): void {
    this.#observeStrip();
    if (changed.has("items") || changed.has("value")) this.#showSelected();
    this.#showOverflow();
  }

  override render() {
    if (this.items.length === 0) return nothing;
    return html`
      <div class="tab-row" part="tab-row">
        <div
          role="tablist"
          part="tablist"
          aria-label=${this.label}
          @scroll=${() => this.#showOverflow()}
        >
          ${repeat(
            this.items,
            (item) => item.key,
            (item, index) =>
              html`<button
                type="button"
                role="tab"
                class=${item.marked ? "marked" : ""}
                aria-label=${item.marked ? `${item.label}, ${item.marked}` : nothing}
                data-key=${item.key}
                id=${`${this.#id}-tab-${index}`}
                aria-selected=${item.key === this.#selected}
                aria-controls=${`${this.#id}-panel-${index}`}
                tabindex=${item.key === this.#selected ? 0 : -1}
                @click=${(event: MouseEvent) => this.#select(event, item.key)}
                @keydown=${(event: KeyboardEvent) => this.#keydown(event, index)}
              >
                ${item.label}${
                  item.marked ? html`<span class="mark" aria-hidden="true">*</span>` : nothing
                }
              </button>`,
          )}
        </div>
        <div class="tab-actions" part="tab-actions"><slot name="actions"></slot></div>
      </div>
      ${repeat(
        this.items,
        (item) => item.key,
        (item, index) =>
          html`<div
            role="tabpanel"
            id=${`${this.#id}-panel-${index}`}
            aria-labelledby=${`${this.#id}-tab-${index}`}
            tabindex="0"
            ?hidden=${item.key !== this.#selected}
          >
            <slot name=${item.key}></slot>
          </div>`,
      )}
    `;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "wt-tabs": WtTabs;
  }
}
