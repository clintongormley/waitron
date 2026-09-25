import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "@waitron/ui/src/components/wt-form-error-summary.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { actionsStyles, errorStyles, fieldStyles } from "../form-styles.js";
import {
  type BucketRestoreRequestDetail,
  dispatchBucketRestoreRequested,
  dispatchSetupGoto,
} from "../events.js";
import { OLD_BOX_PROBLEM, oldBoxQuestion } from "./old-box-question.js";

const KIT_PROBLEM = "Upload or paste the recovery kit.";
const ACKNOWLEDGE_PROBLEM = "Confirm that no other running server has newer data.";
const VENUE_PROBLEM = "Confirm that this is your business.";

/** The restored copy's names, from `restore.stream_venue_unconfirmed` (Reconciliation N26). */
export interface RestoredVenue {
  legalName: string;
  taxId: string;
  locationName: string;
}

/**
 * Rebuild this server from the owner's bucket (slice 2 spec §5.1). It asks for the recovery kit and
 * the environment, which the restore's compatibility check compares with the copy's own. The shell
 * sets `liveSince`/`liveUnknown` and `venue` from the server's refusals, and hands back the request
 * it last sent as `request`, so answering a refusal never means pasting the kit again.
 */
@customElement("setup-restore-bucket-screen")
export class SetupRestoreBucketScreen extends LitElement {
  static override styles = [
    baseStyles,
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
        word-break: break-all;
        resize: vertical;
      }
      input[type="file"] {
        max-width: 100%;
      }
    `,
  ];

  @property() errorMessage?: string;
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
  @state() private showError = false;

  override willUpdate(changed: PropertyValues<this>): void {
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

  get #askingOldBox(): boolean {
    return this.liveSince !== undefined || this.liveUnknown;
  }

  get #kitMissing(): boolean {
    return this.kit.trim() === "";
  }

  get #oldBoxUnanswered(): boolean {
    return this.#askingOldBox && !this.oldBoxGone;
  }

  get #venueUnconfirmed(): boolean {
    return this.venue !== undefined && !this.venueConfirmed;
  }

  #problems(): string[] {
    return [
      this.#kitMissing ? KIT_PROBLEM : "",
      !this.acknowledged ? ACKNOWLEDGE_PROBLEM : "",
      this.#oldBoxUnanswered ? OLD_BOX_PROBLEM : "",
      this.#venueUnconfirmed ? VENUE_PROBLEM : "",
    ].filter(Boolean);
  }

  #restore(): void {
    if (this.#problems().length > 0) {
      this.showError = true;
      return;
    }
    this.showError = false;
    dispatchBucketRestoreRequested(this, {
      kit: this.kit,
      environment: this.environment,
      oldBoxGone: this.#askingOldBox && this.oldBoxGone,
      venueConfirmed: this.venue !== undefined && this.venueConfirmed ? this.venue.taxId : null,
    });
  }

  async #readFile(event: Event): Promise<void> {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (file !== undefined) this.kit = await file.text();
  }

  #renderVenue(): TemplateResult | typeof nothing {
    if (this.venue === undefined) return nothing;
    const invalid = this.showError && this.#venueUnconfirmed;
    return html`<p data-test="venue">
        The copy in the bucket belongs to <strong>${this.venue.legalName}</strong> (tax id
        ${this.venue.taxId}), location ${this.venue.locationName}.
      </p>
      <label class="field">
        <input
          name="venue-confirmed"
          type="checkbox"
          required
          data-test="venue-confirmed"
          aria-invalid=${invalid ? "true" : "false"}
          aria-describedby=${invalid ? "venue-confirmed-error" : nothing}
          .checked=${this.venueConfirmed}
          @change=${(e: Event) => {
            this.venueConfirmed = (e.currentTarget as HTMLInputElement).checked;
          }}
        />
        This is my business. Restore it onto this server.
      </label>
      ${invalid ? html`<p class="error" id="venue-confirmed-error">${VENUE_PROBLEM}</p>` : nothing}`;
  }

  override render(): TemplateResult {
    const kitInvalid = this.showError && this.#kitMissing;
    const acknowledgeInvalid = this.showError && !this.acknowledged;
    return html`
      <h1>Restore from my bucket</h1>
      <p>
        Rebuild this server from the copy the old server kept in your storage bucket. Use this only
        when the old server is gone. You need the recovery kit, and nothing else.
      </p>
      <p class="sensitive" data-test="kit-sensitive">
        The recovery kit is as sensitive as the recovery key: anyone holding it can read every sale
        and every stored credential in the bucket copy. Enter it only here.
      </p>
      <label class="field">
        Recovery kit file
        <input
          name="recovery-kit-file"
          type="file"
          data-test="kit-file"
          @change=${(e: Event) => void this.#readFile(e)}
        />
      </label>
      <label class="field">
        Recovery kit <span aria-hidden="true">*</span>
        <wt-help-tooltip aria-label="Help with the recovery kit"
          >Choose the kit file above, or paste the kit here: one long line starting with
          WAITRON-RECOVERY-KIT-1.</wt-help-tooltip
        >
        <textarea
          name="recovery-kit"
          required
          rows="6"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          data-test="kit"
          aria-invalid=${kitInvalid ? "true" : "false"}
          aria-describedby=${kitInvalid ? "kit-error" : nothing}
          .value=${this.kit}
          @input=${(e: Event) => {
            this.kit = (e.currentTarget as HTMLTextAreaElement).value;
          }}
        ></textarea>
      </label>
      ${kitInvalid ? html`<p class="error" id="kit-error">${KIT_PROBLEM}</p>` : nothing}
      <label class="field">
        Environment <span aria-hidden="true">*</span>
        <wt-help-tooltip aria-label="Help with environment"
          >Choose the environment the old server ran in. A preparation or demo copy cannot become a
          Live database.</wt-help-tooltip
        >
        <select
          name="environment"
          required
          data-test="environment"
          @change=${(e: Event) => {
            this.environment = (e.currentTarget as HTMLSelectElement).value as
              "production" | "preproduction";
          }}
        >
          <option value="production" .selected=${this.environment === "production"}>Live</option>
          <option value="preproduction" .selected=${this.environment === "preproduction"}>
            Preparation or demo
          </option>
        </select>
      </label>
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
        I confirm no other running server has newer restaurant data.
      </label>
      ${acknowledgeInvalid ? html`<p class="error" id="acknowledge-error">${ACKNOWLEDGE_PROBLEM}</p>` : nothing}
      ${oldBoxQuestion({
        liveSince: this.liveSince,
        liveUnknown: this.liveUnknown,
        checked: this.oldBoxGone,
        invalid: this.showError && this.#oldBoxUnanswered,
        onChange: (checked) => {
          this.oldBoxGone = checked;
        },
      })}
      ${this.#renderVenue()}
      ${
        this.showError
          ? html`<wt-form-error-summary
              data-test="error"
              heading="There is a problem with this form"
              .errors=${this.#problems()}
            ></wt-form-error-summary>`
          : this.errorMessage === undefined
            ? nothing
            : html`<p class="error" role="alert" data-test="server-error">${this.errorMessage}</p>`
      }
      <wt-form-actions>
        <wt-button
          variant="ghost"
          slot="cancel"
          data-test="back"
          @click=${() => dispatchSetupGoto(this, "role")}
          >Back</wt-button
        >
        <wt-button variant="primary" data-test="restore" @click=${() => this.#restore()}
          >Restore from my bucket</wt-button
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
