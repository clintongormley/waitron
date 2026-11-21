import { css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { WtDialog } from "./wt-dialog.js";

@customElement("wt-modal")
export class WtModal extends WtDialog {
  /** Unset, or any other value, is wide. */
  @property({ reflect: true }) size?: "compact" | "standard" | "wide" | "full";
  /** Unset, or any other value, keeps the height the size gives. */
  @property({ reflect: true }) height?: "medium";

  protected override readonly bodyTabStop = "always";

  static override styles = [
    ...WtDialog.styles,
    css`
      dialog {
        height: calc(var(--wt-dialog-band) - 2 * var(--wt-dialog-margin));
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

      :host([size="full"]) dialog {
        --wt-dialog-margin: min(
          var(--wt-modal-inline-margin),
          max(var(--wt-space-2), var(--wt-space-5) - var(--wt-keyboard-inset))
        );
        width: calc(100dvw - 2 * var(--wt-modal-inline-margin));
        height: calc(var(--wt-dialog-band) - 2 * var(--wt-dialog-margin));
      }

      /* After the size rules, which it overrides; each size's max-height still bounds it. */
      :host([height="medium"]) dialog {
        height: var(--wt-modal-medium-height);
      }

      .header {
        padding-inline: max(var(--wt-modal-inline-padding), calc(var(--wt-help-badge-target) / 2));
      }

      .body {
        --wt-field-max-width: var(--wt-form-max-width);
        /* At least half a help badge's target, so a badge hanging off a full-width field stays inside. */
        padding-inline: max(var(--wt-modal-inline-padding), calc(var(--wt-help-badge-target) / 2));
        /* Not the flex shorthand, which would also put back the shrink factor wt-dialog gives the
           body. */
        flex-grow: 1;
      }

      .footer {
        --wt-field-max-width: var(--wt-form-max-width);
      }

      .footer.has-content {
        padding-inline: max(var(--wt-modal-inline-padding), calc(var(--wt-help-badge-target) / 2));
      }
    `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "wt-modal": WtModal;
  }
}
