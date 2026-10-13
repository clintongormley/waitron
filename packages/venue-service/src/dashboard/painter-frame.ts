import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import {
  baseStyles,
  saveActionState,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-icon.js";
import { t } from "./strings.js";

/**
 * A painter's full-screen frame: one bar (close, heading, the `picker` and `link`
 * slots, Cancel and Save) over the `row` slot and the default slot, which fills the rest of the
 * screen so what it holds scrolls inside itself and the bar stays put.
 *
 * The host owns the draft: it hands over the scope and coordinator `draftScopeFor` gave it, which
 * the frame asks before Cancel, close or Escape, and `dirty`, which sets Save. It sends
 * `painter-save` when Save is pressed on a changed draft, and `painter-close` once it has closed,
 * however it closed.
 */
@customElement("painter-frame")
export class PainterFrame extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: contents;
      }
      .frame {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
        height: 100%;
      }
      header {
        flex: none;
        container-type: inline-size;
      }
      .bar {
        display: grid;
        grid-template-columns: auto minmax(0, max-content) minmax(0, 1fr) auto auto;
        grid-template-areas: "close title picker link actions";
        align-items: center;
        gap: var(--wt-space-2) var(--wt-space-3);
      }
      @container (width < 720px) {
        .bar {
          grid-template-columns: auto minmax(0, 1fr) auto;
          grid-template-areas:
            "close title actions"
            "picker picker picker"
            "link link link";
          column-gap: var(--wt-space-2);
        }
        /* Room on a phone for the heading beside Cancel and Save. */
        wt-button::part(button) {
          padding-inline: var(--wt-space-2);
        }
      }
      .close {
        grid-area: close;
      }
      h2 {
        grid-area: title;
        margin: 0;
        font-size: var(--wt-font-size-lg);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .picker {
        grid-area: picker;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
        min-width: 0;
      }
      .link {
        grid-area: link;
        justify-self: end;
      }
      .actions {
        grid-area: actions;
        display: flex;
        gap: var(--wt-space-2);
      }
      .refusal {
        margin: var(--wt-space-2) 0 0;
        text-align: end;
        color: var(--wt-color-danger);
      }
      .row {
        flex: none;
      }
      .content {
        flex: 1 1 0;
        min-height: 0;
        display: flex;
        flex-direction: column;
      }
      .content ::slotted(*) {
        flex: 1 1 0;
        min-height: 0;
      }
    `,
  ];

  @property({ type: Boolean }) open = false;
  @property() heading = "";
  /** The host's draft scope, from `draftScopeFor`, which Cancel, close and Escape ask. */
  @property({ attribute: false }) scope?: Pick<DraftScope<unknown>, "id">;
  /** The host's `scope.isDirty()`, passed on each render: the frame cannot see the draft change. */
  @property({ type: Boolean }) dirty = false;
  /** From `draftScopeFor`; without one, leaving never asks. */
  @property({ attribute: false }) coordinator?: LeaveCoordinator;
  /** A save is in flight: Save shows it, and nothing closes the frame. */
  @property({ type: Boolean }) busy = false;
  /** The message shown beside Save: a refused save, or a notice from the host. */
  @property() refusal = "";
  /** Nothing can be changed, so only ✕ is offered. */
  @property({ type: Boolean }) readOnly = false;

  private readonly beforeClose = async (reason: LeaveReason): Promise<boolean> => {
    if (this.busy) return false;
    if (!this.scope || !this.coordinator) return true;
    const outcome = await this.coordinator.request({
      scopes: [this.scope.id],
      reason,
      proceed() {},
    });
    return outcome === "proceeded" && !this.busy;
  };

  private close() {
    if (!this.busy) void this.renderRoot.querySelector("wt-modal")?.requestClose("cancel");
  }

  private save() {
    if (this.busy || saveActionState({ isDirty: () => this.dirty }).unchanged) return;
    this.dispatchEvent(new CustomEvent("painter-save", { bubbles: true, composed: true }));
  }

  override render() {
    const action = saveActionState({ isDirty: () => this.dirty });
    return html`<wt-modal
      size="full"
      .open=${this.open}
      .dismissible=${!this.busy}
      .beforeClose=${this.beforeClose}
      aria-label=${this.heading}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.open = false;
        this.dispatchEvent(new CustomEvent("painter-close", { bubbles: true, composed: true }));
      }}
    >
      <div class="frame">
        <header>
          <div class="bar">
            <wt-button
              class="close"
              data-test="dismiss"
              variant="ghost"
              aria-label=${t("ordinary.close")}
              ?disabled=${this.busy}
              @click=${() => this.close()}
              ><wt-icon name="close"></wt-icon
            ></wt-button>
            <h2>${this.heading}</h2>
            <div class="picker"><slot name="picker"></slot></div>
            <div class="link"><slot name="link"></slot></div>
            ${
              this.readOnly
                ? nothing
                : html`<div class="actions">
                    <wt-button
                      data-test="cancel"
                      variant="secondary"
                      ?disabled=${this.busy}
                      @click=${() => this.close()}
                      >${t("hours.cancel")}</wt-button
                    >
                    <wt-button
                      data-test="save"
                      variant=${action.variant}
                      ?disabled=${action.unchanged}
                      ?loading=${this.busy}
                      @click=${() => this.save()}
                      >${t("hours.save")}</wt-button
                    >
                  </div>`
            }
          </div>
          ${
            this.refusal
              ? html`<p class="refusal" role="alert" data-error>${this.refusal}</p>`
              : nothing
          }
        </header>
        <div class="row"><slot name="row"></slot></div>
        <div class="content"><slot></slot></div>
      </div>
    </wt-modal>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "painter-frame": PainterFrame;
  }
}
