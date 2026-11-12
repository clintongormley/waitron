import { LitElement, type TemplateResult, css, html } from "lit";
import { customElement } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-choice-row.js";
import { actionsStyles } from "../form-styles.js";
import { dispatchSetupGoto } from "../events.js";
import { t } from "../i18n/t.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";

@customElement("setup-role-screen")
export class SetupRoleScreen extends LitElement {
  static override styles = [
    baseStyles,
    actionsStyles,
    css`
      :host {
        display: block;
      }

      .intro {
        margin: var(--wt-space-3) 0;
        color: var(--wt-color-text-muted);
      }

      .choices {
        margin-top: var(--wt-space-4);
      }
    `,
  ];

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  override render(): TemplateResult {
    return html`
      <h1>${t("role.heading")}</h1>
      <p class="intro">${t("role.intro")}</p>

      <div class="choices">
        <wt-choice-row
          data-test="choose-mirror"
          heading=${t("role.mirror.heading")}
          @click=${() => dispatchSetupGoto(this, "connect")}
          >${t("role.mirror.copy")}</wt-choice-row
        >
        <wt-choice-row
          data-test="choose-restore"
          heading=${t("role.restore.heading")}
          @click=${() => dispatchSetupGoto(this, "restore")}
          >${t("role.restore.copy")}</wt-choice-row
        >
        <wt-choice-row
          data-test="choose-restore-bucket"
          heading=${t("role.bucket.heading")}
          @click=${() => dispatchSetupGoto(this, "restore-bucket")}
          >${t("role.bucket.copy")}</wt-choice-row
        >
      </div>
      <div class="actions">
        <wt-button variant="ghost" data-test="back" @click=${() => dispatchSetupGoto(this, "mode")}
          >${t("role.back")}</wt-button
        >
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-role-screen": SetupRoleScreen;
  }
}
