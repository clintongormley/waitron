import { LitElement, type PropertyValues, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { live } from "lit/directives/live.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { trackDialog } from "./track-dialog.js";
import { t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import type { ProfileChoice } from "../api/client.js";

/** Refusals about the profile chosen, shown under it rather than at the bottom. */
const ABOUT_CHOICE = new Set(["device_profile.not_approved", "device_profile.not_admitted"]);

/**
 * Lets a signed-in person switch the device to another profile it is approved for. The dialog only
 * reports the choice; the app owns the request and says why a switch was refused.
 */
@customElement("till-profile-dialog")
export class TillProfileDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .fields {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
      }
    `,
  ];

  @property({ type: Boolean }) open = false;
  @property({ attribute: false }) profiles: ProfileChoice[] = [];
  @property() activeProfileId = "";
  /** The server's refusal of the last switch. */
  @property({ attribute: false }) error: { code: string } | null = null;
  /** An order is in progress on this device, so the switch waits until it is held or cleared. */
  @property({ type: Boolean }) orderOpen = false;
  /** The open order's last change could not be saved, so the switch waits until it is. */
  @property({ type: Boolean }) draftUnsaved = false;
  @property({ type: Boolean }) busy = false;

  @state() private chosen = "";
  /** Cleared when the person changes the choice the refusal was about. */
  @state() private refusalShown = true;

  protected override willUpdate(changed: PropertyValues<this>): void {
    if ((changed.has("open") || changed.has("activeProfileId")) && this.open)
      this.chosen = this.activeProfileId;
    if (changed.has("error")) this.refusalShown = true;
  }

  #emit<T>(type: string, detail?: T): void {
    this.dispatchEvent(new CustomEvent<T>(type, { detail, bubbles: true, composed: true }));
  }

  #fieldError(): string {
    const code = this.error?.code;
    return code !== undefined && ABOUT_CHOICE.has(code) && this.refusalShown
      ? codeMessage(code)
      : "";
  }

  #bottomMessage(): string {
    if (this.orderOpen) return t("profile.order_open");
    if (this.draftUnsaved) return t("profile.draft_unsaved");
    if (this.error === null) return "";
    if (ABOUT_CHOICE.has(this.error.code)) return this.refusalShown ? t("form.fix_fields") : "";
    return codeMessage(this.error.code);
  }

  override render() {
    if (!this.open) return nothing;
    const fieldError = this.#fieldError();
    return html`<wt-dialog
      ${trackDialog()}
      .open=${true}
      .heading=${t("profile.title")}
      @wt-close=${() => this.#emit("close")}
    >
      <div class="fields">
        <wt-combobox
          name="profileId"
          search="auto"
          label=${t("profile.label")}
          searchPlaceholder=${t("form.combobox_search")}
          noResultsLabel=${t("form.combobox_no_results")}
          .options=${this.profiles.map((profile) => ({ value: profile.id, label: profile.name }))}
          .value=${live(this.chosen)}
          ?disabled=${this.busy}
          .error=${fieldError}
          .invalid=${fieldError !== ""}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.chosen = event.detail.value;
            this.refusalShown = false;
          }}
        ></wt-combobox>
      </div>
      <wt-form-actions slot="footer" .error=${this.#bottomMessage()}>
        <wt-button
          slot="cancel"
          data-test="profile-cancel"
          variant="secondary"
          ?disabled=${this.busy}
          @click=${() => this.#emit("close")}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          data-test="profile-switch"
          variant="primary"
          ?loading=${this.busy}
          @click=${() => this.#emit<{ profileId: string }>("profile-switch", { profileId: this.chosen })}
          >${t("profile.switch")}</wt-button
        >
      </wt-form-actions>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-profile-dialog": TillProfileDialog;
  }
}
