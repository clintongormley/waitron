import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, draftScopeFor, saveActionState, type DraftScope } from "@waitron/ui";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-button.js";
import type {
  DashboardApi,
  DailyReportSettingsDraft,
  DailyReportSettingsView,
} from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";

@customElement("dashboard-daily-report-mail-form")
export class DailyReportMailForm extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        margin-top: var(--wt-space-6);
      }
      h3 {
        font-size: var(--wt-font-size-md);
      }
      fieldset {
        border: 0;
        padding: 0;
        margin: var(--wt-space-2) 0;
        min-inline-size: 0;
      }
      fieldset wt-switch {
        display: flex;
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @state() private draft?: DailyReportSettingsDraft;
  @state() private recipients: DailyReportSettingsView["recipients"] = [];
  @state() private error?: string;
  @state() private saving = false;
  #scope?: DraftScope<DailyReportSettingsDraft>;
  #generation = 0;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  override disconnectedCallback(): void {
    ++this.#generation;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.draft = undefined;
    this.saving = false;
    super.disconnectedCallback();
  }

  async #load(): Promise<void> {
    this.error = undefined;
    const generation = ++this.#generation;
    try {
      const { recipients, recipientIds, enabled, revision } = await (
        this.api.background ?? this.api
      ).getDailyReportSettings();
      if (generation !== this.#generation) return;
      this.recipients = recipients;
      this.draft = {
        enabled,
        revision,
        recipientIds: recipients.map(({ id }) => id).filter((id) => recipientIds.includes(id)),
      };
      this.#scope = draftScopeFor(this, {
        id: this,
        current: () => this.draft!,
        snapshot: (value) => value,
        equal: (a, b) =>
          a.enabled === b.enabled &&
          a.recipientIds.length === b.recipientIds.length &&
          a.recipientIds.every((id) => b.recipientIds.includes(id)),
        restore: (value) => {
          this.draft = value;
          this.error = undefined;
        },
      }).scope;
    } catch (error) {
      if (generation === this.#generation) this.error = codeOf(error);
    }
  }

  #edit(change: Partial<DailyReportSettingsDraft>): void {
    if (!this.draft || this.saving) return;
    this.draft = { ...this.draft, ...change };
    this.#scope?.changed();
    this.error = undefined;
  }

  async #save(): Promise<void> {
    const draft = this.draft;
    if (
      !draft ||
      this.saving ||
      saveActionState(this.#scope).unchanged ||
      (draft.enabled && draft.recipientIds.length === 0)
    )
      return;
    const generation = this.#generation;
    this.saving = true;
    this.error = undefined;
    try {
      const saved = await this.api.saveDailyReportSettings(draft);
      if (generation !== this.#generation) return;
      this.draft = saved;
      this.#scope?.commit(saved);
    } catch (error) {
      if (generation === this.#generation) this.error = codeOf(error);
    } finally {
      if (generation === this.#generation) this.saving = false;
    }
  }

  override render() {
    const draft = this.draft;
    const save = saveActionState(this.#scope);
    const needsRecipient = draft?.enabled && draft.recipientIds.length === 0;
    const message =
      this.error === "settings.out_of_date"
        ? t("email.daily_report.stale")
        : this.error
          ? codeMessage(this.error)
          : "";
    return html`<h3>${t("email.daily_report.heading")}</h3>
      <p>${t("email.daily_report.hint")}</p>
      ${
        draft
          ? html`
              <wt-switch
                name="daily-report-enabled"
                data-test="daily-report-enabled"
                .label=${t("email.daily_report.enabled")}
                .checked=${draft.enabled}
                .disabled=${this.saving}
                @wt-change=${(event: CustomEvent<{ checked: boolean }>) => this.#edit({ enabled: event.detail.checked })}
              ></wt-switch>
              ${
                draft.enabled
                  ? html`
                      <fieldset>
                        <legend>${t("email.daily_report.recipients")}</legend>
                        ${this.recipients.map(
                          ({ id, name }) =>
                            html` <wt-switch
                              name="daily-report-recipient"
                              data-test="daily-report-recipient"
                              .label=${name}
                              .checked=${draft.recipientIds.includes(id)}
                              .disabled=${this.saving}
                              @wt-change=${(event: CustomEvent<{ checked: boolean }>) =>
                                this.#edit({
                                  recipientIds: event.detail.checked
                                    ? [...draft.recipientIds, id]
                                    : draft.recipientIds.filter((selected) => selected !== id),
                                })}
                            ></wt-switch>`,
                        )}
                      </fieldset>
                      ${needsRecipient ? html`<p>${t("email.daily_report.pick_recipient")}</p>` : nothing}
                    `
                  : nothing
              }
              <wt-form-actions .error=${message}>
                <wt-button
                  data-test="daily-report-save"
                  variant=${needsRecipient ? "secondary" : save.variant}
                  .disabled=${save.unchanged || this.saving || !!needsRecipient}
                  @click=${() => void this.#save()}
                  >${t("action.save")}</wt-button
                >
              </wt-form-actions>
            `
          : this.error
            ? html`
                <p role="alert">${message}</p>
                <wt-button variant="secondary" @click=${() => void this.#load()}
                  >${t("email.settings.retry")}</wt-button
                >
              `
            : nothing
      }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-daily-report-mail-form": DailyReportMailForm;
  }
}
