import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, focusFirstInvalid, selectStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { actionsStyles, errorStyles, fieldStyles } from "../form-styles.js";
import {
  type BucketRestoreRequestDetail,
  dispatchBucketRestoreRequested,
  dispatchSetupGoto,
} from "../events.js";
import { t, format } from "../i18n/t.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";
import { oldBoxQuestion } from "./old-box-question.js";

/** The restored copy's names, from `restore.stream_venue_unconfirmed` (#646). */
export interface RestoredVenue {
  legalName: string;
  taxId: string;
  locationName: string;
}

export type BucketField = "kit" | "environment" | "oldBoxGone" | "venueConfirmed";

/**
 * Rebuild this server from the owner's bucket. It asks for the recovery kit and
 * the environment, which the restore's compatibility check compares with the copy's own. The shell
 * sets `liveSince`/`liveUnknown` and `venue` from the server's refusals, and hands back the request
 * it last sent as `request`, so answering a refusal never means pasting the kit again.
 */
@customElement("setup-restore-bucket-screen")
export class SetupRestoreBucketScreen extends LitElement {
  static override styles = [
    baseStyles,
    selectStyles,
    fieldStyles,
    errorStyles,
    actionsStyles,
    css`
      :host {
        display: block;
      }
      .sensitive {
        font-weight: var(--wt-font-weight-bold);
      }
      textarea,
      select,
      input[type="file"] {
        display: block;
        margin-top: var(--wt-space-2);
      }
      textarea {
        width: 100%;
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font-family: var(--wt-font-family-mono);
        font-size: var(--wt-font-size-sm);
        overflow-wrap: anywhere;
        resize: vertical;
      }
      input[type="file"] {
        max-width: 100%;
      }
    `,
  ];

  @property() errorMessage?: string;
  /** The field `errorMessage` is about; the message then shows under it, not beside Restore. */
  @property() invalidField?: BucketField;
  /** When the old server last wrote to its bucket (`restore.stream_source_live`). */
  @property() liveSince?: string;
  /** Whether the old server is still writing could not be checked (`restore.stream_source_unchecked`). */
  @property({ type: Boolean }) liveUnknown = false;
  @property({ attribute: false }) venue?: RestoredVenue;
  /** The request the shell last sent, returned with a refusal so the owner's entries are kept. */
  @property({ attribute: false }) request?: BucketRestoreRequestDetail;
  @state() private kit = "";
  @state() private environment: "production" | "preproduction" = "production";
  @state() private acknowledged = false;
  @state() private oldBoxGone = false;
  @state() private venueConfirmed = false;
  @state() private attempted = false;
  /** The owner pressed Restore after `errorMessage` arrived, so it no longer applies. */
  @state() private refusalDismissed = false;
  @state() private fieldRefusalDismissed = false;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("errorMessage")) this.refusalDismissed = false;
    if (changed.has("invalidField")) this.fieldRefusalDismissed = false;
    if (changed.has("request") && this.request !== undefined) {
      this.kit = this.request.kit;
      this.environment = this.request.environment;
      // A request is only sent once the owner has ticked this.
      this.acknowledged = true;
      this.oldBoxGone = this.request.oldBoxGone;
    }
    if (changed.has("venue") || changed.has("request")) {
      this.venueConfirmed =
        this.venue !== undefined && this.request?.venueConfirmed === this.venue.taxId;
    }
  }

  override updated(changed: PropertyValues<this>): void {
    if (changed.has("invalidField") && this.#refusalUnder() !== undefined) {
      void focusFirstInvalid(this.shadowRoot!);
    }
  }

  /** The field showing the server's refusal, if any. */
  #refusalUnder(): BucketField | undefined {
    return this.errorMessage === undefined ||
      this.refusalDismissed ||
      this.fieldRefusalDismissed ||
      !this.#shows(this.invalidField)
      ? undefined
      : this.invalidField;
  }

  /** Whether `field` is on the screen: the two tick boxes appear only when the server asks. */
  #shows(field: BucketField | undefined): boolean {
    if (field === "oldBoxGone") return this.#askingOldBox;
    if (field === "venueConfirmed") return this.#venue !== undefined;
    return field !== undefined;
  }

  #edited(field: BucketField): void {
    if (field === this.invalidField) this.fieldRefusalDismissed = true;
  }

  /**
   * The owner has replaced the kit the shell's refusal was about. The server checked the old server
   * and named the copy for THAT kit, so neither its question nor an answer to it applies to this one.
   */
  get #kitReplaced(): boolean {
    return this.request !== undefined && this.kit !== this.request.kit;
  }

  get #askingOldBox(): boolean {
    return !this.#kitReplaced && (this.liveSince !== undefined || this.liveUnknown);
  }

  get #venue(): RestoredVenue | undefined {
    return this.#kitReplaced ? undefined : this.venue;
  }

  #setKit(kit: string): void {
    this.kit = kit;
    this.#edited("kit");
    if (this.#kitReplaced) {
      this.oldBoxGone = false;
      this.venueConfirmed = false;
    }
  }

  get #kitMissing(): boolean {
    return this.kit.trim() === "";
  }

  get #oldBoxUnanswered(): boolean {
    return this.#askingOldBox && !this.oldBoxGone;
  }

  get #venueUnconfirmed(): boolean {
    return this.#venue !== undefined && !this.venueConfirmed;
  }

  get #incomplete(): boolean {
    return (
      this.#kitMissing || !this.acknowledged || this.#oldBoxUnanswered || this.#venueUnconfirmed
    );
  }

  #restore(): void {
    this.attempted = true;
    this.refusalDismissed = true;
    if (this.#incomplete) {
      void this.updateComplete.then(() => focusFirstInvalid(this.shadowRoot!));
      return;
    }
    dispatchBucketRestoreRequested(this, {
      kit: this.kit,
      environment: this.environment,
      oldBoxGone: this.#askingOldBox && this.oldBoxGone,
      venueConfirmed: this.#venue !== undefined && this.venueConfirmed ? this.#venue.taxId : null,
    });
  }

  async #readFile(event: Event): Promise<void> {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (file !== undefined) this.#setKit(await file.text());
  }

  #renderVenue(): TemplateResult | typeof nothing {
    const venue = this.#venue;
    if (venue === undefined) return nothing;
    const error =
      this.attempted && this.#venueUnconfirmed
        ? t("restore_bucket.venue_missing")
        : this.#refusalUnder() === "venueConfirmed"
          ? this.errorMessage
          : undefined;
    return html`<p data-test="venue">
        ${t("restore_bucket.venue_owner")} <strong>${venue.legalName}</strong>
        ${format("restore_bucket.venue_details", { taxId: venue.taxId, location: venue.locationName })}
      </p>
      <label class="field">
        <input
          name="venue-confirmed"
          type="checkbox"
          required
          data-test="venue-confirmed"
          aria-invalid=${error === undefined ? "false" : "true"}
          aria-describedby=${error === undefined ? nothing : "venue-confirmed-error"}
          .checked=${this.venueConfirmed}
          @change=${(e: Event) => {
            this.venueConfirmed = (e.currentTarget as HTMLInputElement).checked;
            this.#edited("venueConfirmed");
          }}
        />
        ${t("restore_bucket.venue_confirm")}
      </label>
      ${error === undefined ? nothing : html`<p class="error" id="venue-confirmed-error">${error}</p>`}`;
  }

  override render(): TemplateResult {
    const refused = this.#refusalUnder();
    const kitError =
      this.attempted && this.#kitMissing
        ? t("restore_bucket.kit_missing")
        : refused === "kit"
          ? this.errorMessage
          : undefined;
    const environmentError = refused === "environment" ? this.errorMessage : undefined;
    const acknowledgeInvalid = this.attempted && !this.acknowledged;
    const fieldsInvalid = this.attempted && this.#incomplete;
    const bottom = [
      ...(this.errorMessage !== undefined &&
      !this.refusalDismissed &&
      !this.#shows(this.invalidField)
        ? [this.errorMessage]
        : []),
      ...(fieldsInvalid || refused !== undefined ? [t("restore_bucket.fix_fields")] : []),
    ].join(" ");
    return html`
      <h1>${t("restore_bucket.heading")}</h1>
      <p>${t("restore_bucket.intro")}</p>
      <p class="sensitive" data-test="kit-sensitive">${t("restore_bucket.sensitive")}</p>
      <label class="field">
        ${t("restore_bucket.kit_file")}
        <input
          name="recovery-kit-file"
          type="file"
          data-test="kit-file"
          @change=${(e: Event) => void this.#readFile(e)}
        />
      </label>
      <label class="field">
        ${t("restore_bucket.kit")} <span aria-hidden="true">*</span>
        <wt-help-tooltip aria-label=${t("restore_bucket.kit_help_label")}
          >${t("restore_bucket.kit_help")}</wt-help-tooltip
        >
        <textarea
          name="recovery-kit"
          required
          rows="6"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          data-test="kit"
          aria-invalid=${kitError === undefined ? "false" : "true"}
          aria-describedby=${kitError === undefined ? nothing : "kit-error"}
          .value=${this.kit}
          @input=${(e: Event) => {
            this.#setKit((e.currentTarget as HTMLTextAreaElement).value);
          }}
        ></textarea>
      </label>
      ${kitError === undefined ? nothing : html`<p class="error" id="kit-error">${kitError}</p>`}
      <label class="field">
        ${t("restore_bucket.environment")} <span aria-hidden="true">*</span>
        <wt-help-tooltip aria-label=${t("restore_bucket.environment_help_label")}
          >${t("restore_bucket.environment_help")}</wt-help-tooltip
        >
        <select
          name="environment"
          required
          data-test="environment"
          aria-invalid=${environmentError === undefined ? "false" : "true"}
          aria-describedby=${environmentError === undefined ? nothing : "environment-error"}
          @change=${(e: Event) => {
            this.environment = (e.currentTarget as HTMLSelectElement).value as
              "production" | "preproduction";
            this.#edited("environment");
          }}
        >
          <option value="production" .selected=${this.environment === "production"}>
            ${t("restore_bucket.environment_live")}
          </option>
          <option value="preproduction" .selected=${this.environment === "preproduction"}>
            ${t("restore_bucket.environment_preproduction")}
          </option>
        </select>
      </label>
      ${environmentError === undefined ? nothing : html`<p class="error" id="environment-error">${environmentError}</p>`}
      <label class="field">
        <input
          name="no-running-server"
          type="checkbox"
          required
          data-test="acknowledge"
          aria-invalid=${acknowledgeInvalid ? "true" : "false"}
          aria-describedby=${acknowledgeInvalid ? "acknowledge-error" : nothing}
          .checked=${this.acknowledged}
          @change=${(e: Event) => {
            this.acknowledged = (e.currentTarget as HTMLInputElement).checked;
          }}
        />
        ${t("restore_bucket.acknowledge")}
      </label>
      ${acknowledgeInvalid ? html`<p class="error" id="acknowledge-error">${t("restore_bucket.acknowledge_missing")}</p>` : nothing}
      ${oldBoxQuestion({
        liveSince: this.#askingOldBox ? this.liveSince : undefined,
        liveUnknown: this.#askingOldBox && this.liveUnknown,
        checked: this.oldBoxGone,
        invalid: this.attempted && this.#oldBoxUnanswered,
        refusal: refused === "oldBoxGone" ? this.errorMessage : undefined,
        onChange: (checked) => {
          this.oldBoxGone = checked;
          this.#edited("oldBoxGone");
        },
      })}
      ${this.#renderVenue()}
      <wt-form-actions .error=${bottom}>
        <wt-button
          variant="ghost"
          slot="cancel"
          data-test="back"
          @click=${() => dispatchSetupGoto(this, "role")}
          >${t("restore_bucket.back")}</wt-button
        >
        <wt-button
          variant="primary"
          data-test="restore"
          ?disabled=${fieldsInvalid}
          @click=${() => this.#restore()}
          >${t("restore_bucket.submit")}</wt-button
        >
      </wt-form-actions>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-restore-bucket-screen": SetupRestoreBucketScreen;
  }
}
