import { css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { WtDialog } from "./wt-dialog.js";

@customElement("wt-modal")
export class WtModal extends WtDialog {
  /** Unset, or any other value, is wide. */
  @property({ reflect: true }) size?: "compact" | "standard" | "wide";

  protected override readonly bodyTabStop = "always";

  static override styles = [
    ...WtDialog.styles,
    css`
      dialog {
        margin: auto;
        height: calc(100dvh - 2 * var(--wt-space-5));
        max-height: calc(100dvh - 2 * var(--wt-space-5));
        width: min(var(--wt-modal-max-width), calc(100dvw - 2 * var(--wt-modal-inline-margin)));
        max-width: none;
      }

      /* Set on this modal's own dialog rather than passed down as a custom property, which a modal
         slotted inside this one would inherit. */
      :host([size="compact"]) dialog {
        height: fit-content;
        width: min(var(--wt-modal-compact-width), calc(100dvw - 2 * var(--wt-modal-inline-margin)));
      }

      :host([size="standard"]) dialog {
        width: min(
          var(--wt-modal-standard-width),
          calc(100dvw - 2 * var(--wt-modal-inline-margin))
        );
      }

      .body {
        --wt-field-max-width: var(--wt-form-max-width);
        padding-inline: var(--wt-modal-inline-padding);
        flex: 1;
      }

      .footer.has-content {
        padding-inline: var(--wt-modal-inline-padding);
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-modal": WtModal;
  }
}
