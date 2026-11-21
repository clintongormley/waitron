import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  saveActionState,
  submitOnEnter,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
  type WtDialog,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-switch.js";
import type { BoxUpgradeSettingsEdit, DashboardApi } from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import type { StringKey } from "../i18n/strings.js";
import { t } from "../i18n/t.js";

type Draft = { automatic: boolean; start: string; end: string };
type HourField = "start" | "end";

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MINUTES_PER_DAY = 24 * 60;

function minutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
}

function timeErrors({ start, end }: Draft): Partial<Record<HourField, StringKey>> {
  if (!start && !end) return {};
  const startError = !start
    ? "box_status.upgrade_settings.start_required"
    : !TIME.test(start)
      ? "box_status.upgrade_settings.invalid_time"
      : undefined;
  const endError = !end
    ? "box_status.upgrade_settings.end_required"
    : !TIME.test(end)
      ? "box_status.upgrade_settings.invalid_time"
      : undefined;
  if (startError || endError) return { start: startError, end: endError };
  const duration = (minutes(end) - minutes(start) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return duration < 60 ? { end: "box_status.upgrade_settings.short_window" } : {};
}

const SAVE_ERRORS: Partial<Record<string, StringKey>> = {
  "upgrade.settings_stale": "box_status.upgrade_settings.save_stale",
  "upgrade.settings_busy": "box_status.upgrade_settings.save_busy",
  "upgrade.settings_unavailable": "box_status.upgrade_settings.save_unavailable",
  "node.read_only": "box_status.upgrade_settings.read_only",
};

@customElement("dashboard-upgrade-settings-dialog")
export class UpgradeSettingsDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .fields {
        width: min(
          var(--wt-form-max-width),
          calc(var(--wt-dialog-max-width) - 2 * var(--wt-space-5))
        );
        max-width: 100%;
        display: grid;
        gap: var(--wt-space-3);
      }
      p {
        margin: 0;
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @state() private opener: HTMLElement | null = null;
  @state() private draft: Draft | null = null;
  @state() private error = "";
  @state() private saving = false;
  @state() private attempted = false;
  #revision = 0;
  #generation = 0;
  #scope?: DraftScope<Draft>;
  #leave?: LeaveCoordinator;

  async show(opener: HTMLElement): Promise<void> {
    if (this.opener) return;
    this.opener = opener;
    const generation = ++this.#generation;
    try {
      const { revision, automatic, start, end } = await this.api.getBoxUpgradeSettings();
      if (generation !== this.#generation) return;
      this.#revision = revision;
      this.draft = { automatic, start: start ?? "", end: end ?? "" };
      const { coordinator, scope } = draftScopeFor(this, {
        id: this,
        current: () => this.draft!,
        snapshot: (draft) => draft,
        equal: (a, b) => a.automatic === b.automatic && a.start === b.start && a.end === b.end,
        restore: (draft) => {
          this.draft = draft;
          this.attempted = false;
          this.error = "";
        },
      });
      this.#scope = scope;
      this.#leave = coordinator;
    } catch {
      if (generation === this.#generation)
        this.error = t("box_status.upgrade_settings.read_failed");
    }
  }

  #close(): void {
    this.#generation++;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    this.opener = null;
    this.draft = null;
    this.error = "";
    this.saving = false;
    this.attempted = false;
  }

  override disconnectedCallback(): void {
    this.#close();
    super.disconnectedCallback();
  }

  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.#leave ||
    (await this.#leave.request({ scopes: [this], reason, proceed() {} })) === "proceeded";

  #edit(patch: Partial<Draft>): void {
    if (!this.draft || this.saving) return;
    this.draft = { ...this.draft, ...patch };
    this.error = "";
    this.#scope?.changed();
  }

  async #save(): Promise<void> {
    const draft = this.draft;
    if (!draft || this.saving || saveActionState(this.#scope).unchanged) return;
    this.error = "";
    this.attempted = true;
    const errors = timeErrors(draft);
    if (errors.start || errors.end) {
      await focusFirstInvalid(this.renderRoot);
      return;
    }

    const edit: BoxUpgradeSettingsEdit = {
      revision: this.#revision,
      automatic: draft.automatic,
      start: draft.start || null,
      end: draft.end || null,
    };
    const generation = this.#generation;
    this.saving = true;
    try {
      await this.api.saveBoxUpgradeSettings(edit);
      if (generation !== this.#generation) return;
      this.#scope?.commit(draft);
      this.renderRoot.querySelector<WtDialog>("wt-dialog")?.closeAfter("saved");
    } catch (error) {
      if (generation !== this.#generation) return;
      this.saving = false;
      const code = codeOf(error);
      const key = SAVE_ERRORS[code];
      this.error = key ? t(key) : codeMessage(code);
    }
  }

  #hour(field: HourField, draft: Draft, error?: StringKey) {
    return html`<wt-input
      name=${field}
      label=${t(field === "start" ? "box_status.upgrade_settings.start" : "box_status.upgrade_settings.end")}
      placeholder="HH:MM"
      .value=${draft[field]}
      .error=${error ? t(error) : ""}
      ?required=${!!(draft.start || draft.end)}
      ?disabled=${this.saving}
      @wt-change=${(event: CustomEvent<{ value: string }>) => this.#edit({ [field]: event.detail.value })}
    ></wt-input>`;
  }

  override render() {
    const draft = this.draft;
    const errors = draft && this.attempted ? timeErrors(draft) : {};
    const invalid = Boolean(errors.start || errors.end);
    const action = saveActionState(this.#scope);
    return html`<wt-dialog
      heading=${t("box_status.upgrade_settings.title")}
      .open=${this.opener !== null}
      .opener=${this.opener}
      .dismissible=${!this.saving}
      .beforeClose=${this.#beforeClose}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.#close();
      }}
    >
      ${
        draft
          ? html`<div
              class="fields"
              @keydown=${(event: KeyboardEvent) =>
                submitOnEnter(
                  event,
                  this.renderRoot.querySelector<HTMLElement>("[data-test=save]"),
                )}
            >
              <wt-switch
                name="automatic"
                label=${t("box_status.upgrade_settings.automatic")}
                .checked=${draft.automatic}
                ?disabled=${this.saving}
                @wt-change=${(event: CustomEvent<{ checked: boolean }>) => this.#edit({ automatic: event.detail.checked })}
              ></wt-switch>
              <p>${t("box_status.upgrade_settings.hours_help")}</p>
              ${this.#hour("start", draft, errors.start)} ${this.#hour("end", draft, errors.end)}
            </div>`
          : this.error
            ? nothing
            : html`<p role="status">${t("box_status.upgrade_settings.loading")}</p>`
      }
      <wt-form-actions slot="footer" .error=${invalid ? t("form.fix_fields") : this.error}>
        <wt-button
          slot="cancel"
          variant="secondary"
          ?disabled=${this.saving}
          @click=${() => void this.renderRoot.querySelector<WtDialog>("wt-dialog")?.requestClose("cancel")}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          data-test="save"
          variant=${action.variant}
          ?disabled=${action.unchanged || this.saving || invalid}
          ?loading=${this.saving}
          @click=${() => void this.#save()}
          >${t("action.save")}</wt-button
        >
      </wt-form-actions>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-upgrade-settings-dialog": UpgradeSettingsDialog;
  }
}
