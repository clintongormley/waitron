import { css } from "lit";
import { customElement } from "lit/decorators.js";
import { WtDialog } from "./wt-dialog.js";

@customElement("wt-modal")
export class WtModal extends WtDialog {
  override firstUpdated(): void {
    super.firstUpdated();
    // A text-only modal still needs a keyboard target inside its scrolling body.
    this.renderRoot.querySelector<HTMLElement>(".body")!.tabIndex = 0;
  }

  static override styles = [
    ...WtDialog.styles,
    css`
      dialog {
        margin: auto;
        height: calc(100dvh - 2 * var(--wt-space-5));
        max-height: calc(100dvh - 2 * var(--wt-space-5));
        width: min(
          var(--wt-dialog-max-width),
          calc(100dvw - 2 * var(--wt-space-5)),
          calc((100dvh - 2 * var(--wt-space-5)) * var(--wt-modal-aspect-ratio, 0.8))
        );
        overflow: hidden;
      }

      dialog[open] {
        display: flex;
        flex-direction: column;
      }

      /* The body owns scrolling so the actions remain reachable on long forms. */
      .body {
        flex: 1;
        min-height: 0;
        overflow: auto;
        overscroll-behavior: contain;
      }

      .footer {
        flex-shrink: 0;
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-modal": WtModal;
  }
}
