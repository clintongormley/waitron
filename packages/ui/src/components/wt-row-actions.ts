import { LitElement, css, html } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { baseStyles } from "../base-styles.js";
import { delegatesFocusShadowRootOptions } from "../interactive.js";
import "./wt-icon.js";
import type { WtIconSize } from "./wt-icon.js";

@customElement("wt-row-actions")
export class WtRowActions extends LitElement {
  static override shadowRootOptions = delegatesFocusShadowRootOptions;
  static override styles = [
    baseStyles,
    css`
      :host {
        display: inline-block;
      }
      button {
        min-width: var(--wt-tap-min);
        min-height: var(--wt-tap-min);
        border: 0;
        border-radius: var(--wt-radius-md);
        background: transparent;
        color: var(--wt-color-text);
        font: inherit;
        cursor: pointer;
      }
      [popover] {
        position: fixed;
        margin: 0;
        padding: var(--wt-space-2);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        box-shadow: var(--wt-shadow-2);
      }
      .actions {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
      }
      ::slotted(wt-button) {
        width: 100%;
      }
    `,
  ];

  @property() label = "";
  /** Defaults to the row-actions kebab; a menu anchored elsewhere (e.g. an account menu) passes
   * its own icon name so this stays the one popover-menu primitive instead of a duplicate. */
  @property() icon = "kebab";
  /** wt-icon's own size scale — a per-row kebab wants the default; a banner-level trigger (e.g.
   * the account menu) reads better larger. */
  @property() iconSize: WtIconSize = "md";
  @state() private expanded = false;
  @query("button") private trigger!: HTMLButtonElement;
  @query("[popover]") private popup!: HTMLElement;

  private onToggle(event: ToggleEvent): void {
    this.expanded = event.newState === "open";
  }

  private onTriggerClick(event: MouseEvent): void {
    event.preventDefault();
    if (this.popup.matches(":popover-open")) {
      this.popup.hidePopover();
    } else {
      // Opening synchronously makes its dimensions available before the first paint.
      this.popup.showPopover();
      this.positionPopup();
    }
  }

  private positionPopup(): void {
    const anchor = this.trigger.getBoundingClientRect();
    const popup = this.popup.getBoundingClientRect();
    this.popup.style.left = `${Math.max(8, Math.min(anchor.right - popup.width, innerWidth - popup.width - 8))}px`;
    this.popup.style.top = `${Math.max(8, Math.min(anchor.bottom, innerHeight - popup.height - 8))}px`;
  }

  private onAction(event: MouseEvent): void {
    if (
      event
        .composedPath()
        .some(
          (node) =>
            node instanceof HTMLElement &&
            this.contains(node) &&
            node.hasAttribute("data-keep-open"),
        )
    )
      return;
    const action = event
      .composedPath()
      .find(
        (node): node is HTMLElement =>
          node instanceof HTMLElement && node.matches("button, a[href], wt-button"),
      );
    if (
      !action ||
      action.hasAttribute("disabled") ||
      action.getAttribute("aria-disabled") === "true"
    )
      return;
    if (this.popup.matches(":popover-open")) this.popup.hidePopover();
  }

  private onKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || event.defaultPrevented || !this.popup.matches(":popover-open"))
      return;
    event.preventDefault();
    event.stopPropagation();
    this.popup.hidePopover();
    this.trigger.focus();
  }

  override render() {
    return html`
      <button
        type="button"
        aria-label=${this.label}
        aria-expanded=${this.expanded}
        popovertarget="actions"
        @click=${this.onTriggerClick}
        @keydown=${this.onKeydown}
      >
        <wt-icon name=${this.icon} size=${this.iconSize}></wt-icon>
      </button>
      <div id="actions" popover @toggle=${this.onToggle} @keydown=${this.onKeydown}>
        <div class="actions"><slot @click=${this.onAction}></slot></div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-row-actions": WtRowActions;
  }
}
