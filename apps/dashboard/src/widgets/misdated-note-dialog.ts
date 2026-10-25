import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  saveActionState,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
  type WtDialog,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-textarea.js";
import type { DashboardApi } from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { wholeTimes, wholeTimesStyles } from "./alert-format.js";

const NOTE_LIMIT = 500;

/** Marks one wrongly-dated-sales alert handled with an optional note (`handle`), or adds the one
 *  note a handled alert may take (`note`). Sends a bubbling, composed `saved` once the box has it,
 *  and `note-close` whenever it closes. */
@customElement("dashboard-misdated-note-dialog")
export class MisdatedNoteDialog extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this, () => this.requestUpdate());
  }

  static override styles = [
    baseStyles,
    wholeTimesStyles,
    css`
      :host {
        display: contents;
      }
      .fields {
        display: grid;
        gap: var(--wt-space-3);
        width: var(--wt-form-max-width);
        max-width: 100%;
      }
      p {
        margin: 0;
        overflow-wrap: anywhere;
      }
    `,
  ];

  @property({ type: Boolean }) open = false;
  @property({ attribute: false }) api!: Pick<
    DashboardApi,
    "markIncidentHandled" | "addIncidentNote"
  >;
  @property() mode: "handle" | "note" = "handle";
  @property() incidentId = "";
  /** The alert's own sentence: how many sales, and from when to when. */
  @property() summary = "";

  @state() private note = "";
  @state() private busy = false;
  /** A refusal's string key for the field, kept until the note changes; translated at render so a
   *  language change while it shows follows. */
  @state() private refusal: "" | "misdated_note.required" | "misdated_note.too_long" = "";
  /** The error code of a refusal shown at the bottom, translated at render. */
  @state() private bottom: string | null = null;

  #opened = false;
  #opening = 0;
  #scope?: DraftScope<string>;
  #leave?: LeaveCoordinator;

  override willUpdate(_changed: PropertyValues): void {
    if (!this.isConnected) return;
    if (!this.open) {
      if (this.#opened) this.#release();
      return;
    }
    if (this.#opened) return;
    this.#opened = true;
    this.#opening += 1;
    this.note = "";
    this.busy = false;
    this.refusal = "";
    this.bottom = null;
    const { coordinator, scope } = draftScopeFor<string>(this, {
      id: {},
      current: () => this.note.trim(),
      snapshot: (value) => value,
      equal: (a, b) => a === b,
      restore: (value) => {
        this.note = value;
        this.refusal = "";
        this.bottom = null;
      },
    });
    this.#leave = coordinator;
    this.#scope = scope;
    scope.commit("");
  }

  override disconnectedCallback(): void {
    this.#release();
    this.open = false;
    super.disconnectedCallback();
  }

  #release(): void {
    this.#opening += 1;
    this.#opened = false;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    this.busy = false;
  }

  #close(): void {
    const wasOpen = this.open || this.#opened;
    this.#release();
    this.open = false;
    if (wasOpen)
      this.dispatchEvent(new CustomEvent("note-close", { bubbles: true, composed: true }));
  }

  #dialog(): WtDialog | null {
    return this.renderRoot.querySelector<WtDialog>("wt-dialog");
  }

  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.#leave ||
    !this.#scope ||
    (await this.#leave.request({ scopes: [this.#scope.id], reason, proceed() {} })) === "proceeded";

  #change(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    if (!this.#opened || this.busy) return;
    this.note = event.detail.value;
    this.refusal = "";
    this.bottom = null;
    this.#scope?.changed();
  }

  async #submit(): Promise<void> {
    if (!this.#opened || this.busy) return;
    const note = this.note.trim();
    if (this.mode === "note" && (saveActionState(this.#scope).unchanged || note === "")) return;
    const opening = this.#opening;
    this.refusal = "";
    this.bottom = null;
    this.busy = true;
    try {
      if (this.mode === "handle")
        await this.api.markIncidentHandled(this.incidentId, note || undefined);
      else await this.api.addIncidentNote(this.incidentId, note);
      if (opening !== this.#opening) return;
      this.#scope?.commit(note);
      this.dispatchEvent(new CustomEvent("saved", { bubbles: true, composed: true }));
      this.#dialog()?.closeAfter("saved");
      this.#close();
    } catch (error) {
      if (opening !== this.#opening) return;
      this.busy = false;
      const code = codeOf(error);
      const field =
        typeof error === "object" && error !== null
          ? (error as { params?: { field?: unknown } }).params?.field
          : undefined;
      if (code === "management.request_invalid" && field === "note") {
        this.refusal = note === "" ? "misdated_note.required" : "misdated_note.too_long";
        await this.updateComplete;
        await focusFirstInvalid(this.shadowRoot!);
      } else this.bottom = code;
    }
  }

  override render(): TemplateResult {
    const handle = this.mode === "handle";
    const bottom = [
      this.bottom === null ? "" : codeMessage(this.bottom),
      this.refusal ? t("form.fix_fields") : "",
    ]
      .filter(Boolean)
      .join(" ");
    const action = saveActionState(this.#scope, { savableAtOpen: handle });
    const empty = !handle && this.note.trim() === "";
    return html`<wt-dialog
      heading=${handle ? t("alerts.mark_handled") : t("misdated_note.add_heading")}
      .open=${this.open}
      .dismissible=${!this.busy}
      .beforeClose=${this.#beforeClose}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) this.#close();
      }}
    >
      ${
        this.open
          ? html`<div class="fields">
              ${this.summary ? html`<p data-test="note-summary">${wholeTimes(this.summary)}</p>` : nothing}
              <wt-textarea
                name="note"
                label=${t("misdated_note.label")}
                placeholder=${t(handle ? "misdated_note.placeholder_optional" : "misdated_note.placeholder")}
                maxlength=${NOTE_LIMIT}
                ?required=${!handle}
                .value=${this.note}
                .error=${this.refusal ? t(this.refusal) : ""}
                ?disabled=${this.busy}
                @wt-change=${(event: CustomEvent<{ value: string }>) => this.#change(event)}
              ></wt-textarea>
            </div>`
          : nothing
      }
      <wt-form-actions slot="footer" .error=${bottom}>
        <wt-button
          slot="cancel"
          variant="secondary"
          data-test="note-cancel"
          ?disabled=${this.busy}
          @click=${() => void this.#dialog()?.requestClose("cancel")}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          data-test="note-submit"
          variant=${action.variant}
          ?loading=${this.busy}
          ?disabled=${action.unchanged || empty || this.busy}
          @click=${() => void this.#submit()}
          >${handle ? t("alerts.mark_handled") : t("action.save")}</wt-button
        >
      </wt-form-actions>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-misdated-note-dialog": MisdatedNoteDialog;
  }
}
