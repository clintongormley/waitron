import { LitElement, type TemplateResult, css, html } from "lit";
import { customElement } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-card.js";
import { actionsStyles } from "../form-styles.js";
import { dispatchSetupGoto } from "../events.js";
import { t } from "../i18n/t.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";

/** Why the mirror card promises so little: `PendingAdoption` in `apps/server/src/finish-adoption.ts`. */
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
        display: grid;
        gap: var(--wt-space-4);
        margin-top: var(--wt-space-4);
      }

      h2 {
        margin: 0 0 var(--wt-space-2);
        font-size: var(--wt-font-size-lg);
      }

      .choice-copy {
        margin: 0 0 var(--wt-space-3);
        color: var(--wt-color-text-muted);
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
        <wt-card raised>
          <h2>${t("role.mirror.heading")}</h2>
          <p class="choice-copy">${t("role.mirror.copy")}</p>
          <wt-button
            variant="primary"
            data-test="choose-mirror"
            @click=${() => dispatchSetupGoto(this, "connect")}
            >${t("role.mirror.button")}</wt-button
          >
        </wt-card>
        <wt-card raised>
          <h2>${t("role.restore.heading")}</h2>
          <p class="choice-copy">${t("role.restore.copy")}</p>
          <wt-button
            variant="secondary"
            data-test="choose-restore"
            @click=${() => dispatchSetupGoto(this, "restore")}
            >${t("role.restore.button")}</wt-button
          >
        </wt-card>
        <wt-card raised>
          <h2>${t("role.bucket.heading")}</h2>
          <p class="choice-copy">${t("role.bucket.copy")}</p>
          <wt-button
            variant="secondary"
            data-test="choose-restore-bucket"
            @click=${() => dispatchSetupGoto(this, "restore-bucket")}
            >${t("role.bucket.button")}</wt-button
          >
        </wt-card>
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
