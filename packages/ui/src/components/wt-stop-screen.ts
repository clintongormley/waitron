import { css } from "lit";
import { customElement } from "lit/decorators.js";
import { WtDialog } from "./wt-dialog.js";

@customElement("wt-stop-screen")
export class WtStopScreen extends WtDialog {
  constructor() {
    super();
    this.dismissible = false;
  }

  keepAbove(dialog: WtDialog): void {
    if (dialog !== this) this.raiseModal();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.open) this.refocus();
  }

  static override styles = [
    ...WtDialog.styles,
    css`
      dialog {
        inset: 0;
        width: 100%;
        height: 100%;
        max-width: none;
        max-height: none;
        margin: 0;
        border: 0;
        border-radius: 0;
        background: var(--wt-color-danger);
        color: var(--wt-color-on-danger);
      }

      .body {
        width: 100%;
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: safe center;
        gap: var(--wt-space-2);
        text-align: center;
      }

      .heading-row {
        margin: 0;
      }

      h2 {
        font-size: var(--wt-font-size-xl);
      }

      .description {
        margin: 0;
        font-size: var(--wt-font-size-lg);
      }

      ::slotted(wt-button) {
        width: 100%;
        max-width: var(--wt-till-form-column-width);
        --wt-action-background: var(--wt-color-on-danger);
        --wt-action-hover: var(--wt-color-on-danger);
        --wt-action-text: var(--wt-color-danger);
        --wt-action-border-color: var(--wt-color-on-danger);
        margin-block-start: var(--wt-space-2);
      }

      ::slotted(p) {
        margin: var(--wt-space-2) 0 0;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-stop-screen": WtStopScreen;
  }
}
