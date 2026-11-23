import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  FormFeedback,
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
import type { DashboardApi, VenueDetailsModel } from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";

export interface VenueIdentityChanged {
  model: VenueDetailsModel;
}

export type TaxpayerField = "legalName" | "taxpayerDomicile" | "bankAccount";

export interface TaxpayerFieldSettings<V = string> {
  /** The field a `venue.detail_invalid` refusal names when it is this dialog's. */
  field: string;
  /** Names the dialog's `data-test` hooks: `<dataTest>-dialog`, `save-<dataTest>`, `cancel-<dataTest>`. */
  dataTest: string;
  heading: StringKey;
  note: StringKey;
  changedElsewhere: StringKey;
  /** Reported when a save is refused after its dialog has closed. */
  notSaved: StringKey;
  /** This field's own refusal reasons; `required` is common to every field. */
  refusals: Record<string, StringKey>;
  send(api: DashboardApi, value: V, expected: V): Promise<{ model: VenueDetailsModel }>;
}

/** A draft and the value it made then, which the draft scope compares. */
interface Snapshot<Draft, V> {
  draft: Draft;
  value: V;
}

/** What a subclass's fields are drawn from. */
export interface TaxpayerFieldsView<Draft> {
  draft: Draft;
  /** Each field's message, by its `name`. */
  errors: Readonly<Record<string, string>>;
  busy: boolean;
  /** Takes what the person typed. */
  change(draft: Draft): void;
  /** For each field's `keydown`, so Enter presses Save. */
  submitOnEnter(event: KeyboardEvent): void;
}

/** The server's own normalisation (`normalizeVenueText`), so a stored spelling it would accept as
 *  unchanged does not count as an edit. */
export function normalizedText(value: string): string {
  return value.normalize("NFC").trim();
}

/** Changes one taxpayer field. On success it sends a bubbling, composed `venue-identity-changed`
 *  carrying the answered model, so the panel and the dashboard banner can show the new value.
 *  A `venue.detail_changed` refusal sends a bubbling, composed `venue-identity-stale`, so both
 *  read the stored value again. */
export abstract class TaxpayerFieldDialog<Draft = string, V = string> extends LitElement {
  protected abstract readonly settings: TaxpayerFieldSettings<V>;

  /** What the stored value opens as. */
  protected draftFor(stored: V): Draft {
    return stored as unknown as Draft;
  }

  /** The value the fields make, which is sent and which the draft scope compares. */
  protected valueFor(draft: Draft): V {
    return draft as unknown as V;
  }

  /** `value` as the server would store it, which is what is sent and compared. Assumes `V` is a
   *  string: a subclass whose value is not one must override it. */
  protected storedForm(value: V): V {
    return normalizedText(value as unknown as string) as unknown as V;
  }

  /** Assumes `V` is a string or other value `===` compares: a subclass whose value is not a
   *  string must override it. */
  protected sameValue(a: V, b: V): boolean {
    return a === b;
  }

  /** The fields' own errors by field name, in the order the fields are drawn; shown once Save
   *  is pressed. */
  protected abstract fieldErrors(draft: Draft): Record<string, string>;

  /** A `venue.detail_invalid` refusal for this field, `message`, by the field it is shown under;
   *  focus goes to the first. */
  protected refusalFor(_reason: string, _draft: Draft, message: string): Record<string, string> {
    return { [this.settings.field]: message };
  }

  /** Errors kept by these names belong to no field: they are the bottom message. */
  protected readonly unplacedErrors: ReadonlySet<string> = new Set();

  /** When the dialog opens and when its draft is restored. */
  protected reset(): void {}

  /** After the person changes a field. */
  protected typed(): void {}

  protected abstract renderFields(view: TaxpayerFieldsView<Draft>): TemplateResult;

  static override styles = [
    baseStyles,
    css`
      :host {
        display: contents;
      }
      .note {
        margin: var(--wt-space-3) 0 0;
        color: var(--wt-color-text-muted);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) lateRefusalFor?: (key: StringKey) => () => void;

  /** The stored spelling the dialog opened with, sent as `expected`; null while it is shut. */
  @state() private opened: V | null = null;
  @state() private draft!: Draft;
  @state() private busy = false;
  /** A refusal's sentence by field name, kept until a field changes or Save is pressed again. */
  @state() private refusal: Record<string, string> = {};
  @state() private bottom = "";

  readonly #feedback = new FormFeedback(this);
  #scope?: DraftScope<Snapshot<Draft, V>>;
  #leave?: LeaveCoordinator;
  #opening = 0;

  show(stored: V): void {
    if (this.opened !== null) return;
    this.#opening += 1;
    this.opened = stored;
    const draft = this.draftFor(stored);
    this.draft = draft;
    this.busy = false;
    this.#feedback.reset();
    this.refusal = {};
    this.bottom = "";
    this.reset();
    const { coordinator, scope } = draftScopeFor<Snapshot<Draft, V>>(this, {
      id: {},
      current: () => this.#snapshot(this.draft),
      snapshot: (value) => value,
      equal: (a, b) => this.sameValue(a.value, b.value),
      restore: (value) => {
        this.draft = value.draft;
        this.refusal = {};
        this.bottom = "";
        this.#feedback.reset();
        this.reset();
      },
    });
    this.#leave = coordinator;
    this.#scope = scope;
    scope.commit(this.#snapshot(draft));
  }

  /** The value is taken when the snapshot is, as `valueFor` can read more than the draft. */
  #snapshot(draft: Draft): Snapshot<Draft, V> {
    return { draft, value: this.storedForm(this.valueFor(draft)) };
  }

  /** Closes without asking. For a page that hides this dialog's host: a native modal left open
   *  out of sight still blocks every click on the page. */
  dismiss(): void {
    if (this.opened !== null) this.#close();
  }

  override disconnectedCallback(): void {
    this.#close();
    super.disconnectedCallback();
  }

  #close(): void {
    this.#opening += 1;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    this.opened = null;
    this.busy = false;
  }

  #dialog(): WtDialog | null {
    return this.renderRoot.querySelector<WtDialog>("wt-dialog");
  }

  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.#leave ||
    !this.#scope ||
    (await this.#leave.request({ scopes: [this.#scope.id], reason, proceed() {} })) === "proceeded";

  #ownErrors(): Record<string, string> {
    return this.#feedback.attempted ? this.fieldErrors(this.draft) : {};
  }

  /** Whether the draft can change now: the dialog is open and no save is on its way. */
  protected get editable(): boolean {
    return this.opened !== null && !this.busy;
  }

  #change(draft: Draft): void {
    if (this.replaceDraft(() => draft)) this.typed();
  }

  /** Replaces the draft, as a person's change does, unless it cannot change now. Any refusal
   *  shown goes, as it was for the line the draft made. */
  protected replaceDraft(update: (draft: Draft) => Draft): boolean {
    if (!this.editable) return false;
    this.draft = update(this.draft);
    this.refusal = {};
    this.bottom = "";
    this.#scope?.changed();
    return true;
  }

  async #save(): Promise<void> {
    const expected = this.opened;
    if (expected === null || this.busy) return;
    if (saveActionState(this.#scope).unchanged) return;
    this.#feedback.press();
    this.refusal = {};
    this.bottom = "";
    const own = Object.keys(this.#ownErrors());
    if (own.length > 0) {
      await this.#focusField(own[0]!);
      return;
    }
    const draft = this.draft;
    const value = this.storedForm(this.valueFor(draft));
    const opening = this.#opening;
    const reportLateRefusal = this.lateRefusalFor?.(this.settings.notSaved);
    this.busy = true;
    try {
      const { model } = await this.settings.send(this.api, value, expected);
      const current = opening === this.#opening;
      if (current) this.#scope?.commit({ draft, value });
      // Announced even after a dismiss: the server has the new value either way.
      this.dispatchEvent(
        new CustomEvent<VenueIdentityChanged>("venue-identity-changed", {
          detail: { model },
          bubbles: true,
          composed: true,
        }),
      );
      if (!current) return;
      this.#dialog()?.closeAfter("saved");
      this.#close();
    } catch (error) {
      const code = codeOf(error);
      if (code === "venue.detail_changed")
        this.dispatchEvent(
          new CustomEvent("venue-identity-stale", { bubbles: true, composed: true }),
        );
      if (opening !== this.#opening) {
        reportLateRefusal?.();
        return;
      }
      this.busy = false;
      const params =
        typeof error === "object" && error !== null
          ? (error as { params?: Record<string, unknown> }).params
          : undefined;
      if (code === "venue.detail_invalid" && params?.field === this.settings.field) {
        const refusals: Record<string, StringKey> = {
          required: "venue_details.required",
          ...this.settings.refusals,
        };
        const reason = String(params.reason);
        this.refusal = this.refusalFor(
          reason,
          draft,
          t(refusals[reason] ?? "venue_details.invalid"),
        );
        await this.#focusField(Object.keys(this.refusal)[0]!);
      } else {
        this.bottom =
          code === "venue.detail_changed" ? t(this.settings.changedElsewhere) : codeMessage(code);
      }
    }
  }

  async #focusField(name: string): Promise<void> {
    await this.updateComplete;
    this.#dialog()
      ?.querySelector<HTMLElement>(`:is(wt-input,wt-combobox,wt-switch)[name=${name}]`)
      ?.focus();
  }

  override render(): TemplateResult {
    const open = this.opened !== null;
    const own = open ? this.#ownErrors() : {};
    const errors = { ...own, ...this.refusal };
    const bottom = this.#feedback.message(
      { request: this.bottom, ...errors },
      new Set(Object.keys(errors).filter((name) => !this.unplacedErrors.has(name))),
      t("form.fix_fields"),
    );
    const action = saveActionState(this.#scope);
    const settings = this.settings;
    return html`<wt-dialog
      data-test="${settings.dataTest}-dialog"
      heading=${t(settings.heading)}
      .open=${open}
      .dismissible=${!this.busy}
      .beforeClose=${this.#beforeClose}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) this.#close();
      }}
    >
      ${
        open
          ? html`${this.renderFields({
                draft: this.draft,
                errors,
                busy: this.busy,
                change: (draft) => this.#change(draft),
                submitOnEnter: (event) =>
                  submitOnEnter(
                    event,
                    this.renderRoot.querySelector<HTMLElement>(
                      `[data-test=save-${settings.dataTest}]`,
                    ),
                  ),
              })}
              <p class="note">${t(settings.note)}</p>`
          : nothing
      }
      <wt-form-actions slot="footer" .error=${bottom}>
        <wt-button
          slot="cancel"
          variant="secondary"
          data-test="cancel-${settings.dataTest}"
          ?disabled=${this.busy}
          @click=${() => void this.#dialog()?.requestClose("cancel")}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          data-test="save-${settings.dataTest}"
          variant=${action.variant}
          ?disabled=${action.unchanged || this.busy || Object.keys(own).length > 0}
          @click=${() => void this.#save()}
          >${t("action.save")}</wt-button
        >
      </wt-form-actions>
    </wt-dialog>`;
  }
}
