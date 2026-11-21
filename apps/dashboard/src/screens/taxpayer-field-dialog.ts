import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  FormFeedback,
  saveActionState,
  submitOnEnter,
  type AddressChosenDetail,
  type AddressLookupProvider,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
  type WtAddressLookup,
  type WtDialog,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-address-lookup.js";
import { getCountryPack, oneLineAddress } from "@waitron/country-packs";
import type { DashboardApi, VenueDetailsModel } from "../api/client.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";

export interface VenueIdentityChanged {
  model: VenueDetailsModel;
}

export type TaxpayerField = "legalName" | "taxpayerDomicile";

export interface TaxpayerFieldSettings {
  field: TaxpayerField;
  /** Names the dialog's `data-test` hooks: `<dataTest>-dialog`, `save-<dataTest>`, `cancel-<dataTest>`. */
  dataTest: string;
  heading: StringKey;
  label: StringKey;
  hint?: StringKey;
  /** Offers the address search above the field, which a chosen address fills as one line. */
  addressSearch?: true;
  note: StringKey;
  changedElsewhere: StringKey;
  /** Reported when a save is refused after its dialog has closed. */
  notSaved: StringKey;
  /** This field's own refusal reasons; `required` is common to every field. */
  refusals: Record<string, StringKey>;
  send(api: DashboardApi, value: string, expected: string): Promise<{ model: VenueDetailsModel }>;
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
function normalized(value: string): string {
  return value.normalize("NFC").trim();
}

/** Changes one taxpayer field. On success it sends a bubbling, composed `venue-identity-changed`
 *  carrying the answered model, so the panel and the dashboard banner can show the new value.
 *  A `venue.detail_changed` refusal sends a bubbling, composed `venue-identity-stale`, so both
 *  read the stored value again. */
export abstract class TaxpayerFieldDialog<Draft = string> extends LitElement {
  protected abstract readonly settings: TaxpayerFieldSettings;

  /** What the stored value, or an address chosen in the search, opens as. */
  protected draftFor(stored: string): Draft {
    return stored as Draft;
  }

  /** The value the fields make, which is sent and which the draft scope compares. */
  protected valueFor(draft: Draft): string {
    return draft as string;
  }

  /** The fields' own errors by field name, in the order the fields are drawn; shown once Save
   *  is pressed. */
  protected fieldErrors(draft: Draft): Record<string, string> {
    return this.valueFor(draft).trim() === ""
      ? { [this.settings.field]: t("venue_details.required") }
      : {};
  }

  /** The fields a `venue.detail_invalid` refusal for this field is shown under. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- named for the subclasses that read them
  protected refusedFields(_reason: string, _draft: Draft): string[] {
    return [this.settings.field];
  }

  /** Draws the fields. */
  protected renderFields(view: TaxpayerFieldsView<Draft>): TemplateResult {
    const settings = this.settings;
    return html`<wt-input
      name=${settings.field}
      required
      label=${t(settings.label)}
      hint=${settings.hint === undefined ? "" : t(settings.hint)}
      .value=${view.draft as string}
      .error=${view.errors[settings.field] ?? ""}
      ?disabled=${view.busy}
      @keydown=${view.submitOnEnter}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        view.change(event.detail.value as Draft);
      }}
    ></wt-input>`;
  }

  static override styles = [
    baseStyles,
    css`
      :host {
        display: contents;
      }
      wt-address-lookup {
        margin-block-end: var(--wt-space-3);
      }
      .note {
        margin: var(--wt-space-3) 0 0;
        color: var(--wt-color-text-muted);
      }
    `,
  ];

  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) lateRefusalFor?: (key: StringKey) => () => void;
  @property({ attribute: false }) addressProvider?: AddressLookupProvider;
  /** The business's country: the search looks there, and an address elsewhere fills nothing. */
  @property({ attribute: false }) countryCode = "";

  /** The stored spelling the dialog opened with, sent as `expected`; null while it is shut. */
  @state() private opened: string | null = null;
  @state() private draft!: Draft;
  @state() private busy = false;
  /** A refusal's sentence by field name, kept until a field changes or Save is pressed again. */
  @state() private refusal: Record<string, string> = {};
  @state() private bottom = "";
  @state() private foreignAddress = false;

  readonly #feedback = new FormFeedback(this);
  #scope?: DraftScope<Draft>;
  #leave?: LeaveCoordinator;
  #opening = 0;

  show(stored: string): void {
    if (this.opened !== null) return;
    this.#opening += 1;
    this.opened = stored;
    const draft = this.draftFor(stored);
    this.draft = draft;
    this.busy = false;
    this.#feedback.reset();
    this.refusal = {};
    this.bottom = "";
    this.foreignAddress = false;
    const { coordinator, scope } = draftScopeFor<Draft>(this, {
      id: {},
      current: () => this.draft,
      snapshot: (value) => value,
      equal: (a, b) => normalized(this.valueFor(a)) === normalized(this.valueFor(b)),
      restore: (value) => {
        this.draft = value;
        this.refusal = {};
        this.bottom = "";
        this.foreignAddress = false;
        this.#feedback.reset();
        this.#cancelAddressSearch();
      },
    });
    this.#leave = coordinator;
    this.#scope = scope;
    scope.commit(draft);
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

  #change(draft: Draft): void {
    if (this.#replace(draft)) this.#cancelAddressSearch();
  }

  #replace(draft: Draft): boolean {
    if (this.opened === null || this.busy) return false;
    this.draft = draft;
    this.refusal = {};
    this.bottom = "";
    this.#scope?.changed();
    return true;
  }

  /** So an address still on its way cannot overwrite what the person typed or restored. */
  #cancelAddressSearch(): void {
    this.renderRoot.querySelector<WtAddressLookup>("wt-address-lookup")?.cancelSearch();
  }

  #addressChosen(event: CustomEvent<AddressChosenDetail>): void {
    event.stopPropagation();
    if (this.opened === null || this.busy) return;
    const address = event.detail.address;
    const pack = getCountryPack(this.countryCode);
    this.foreignAddress = pack === undefined || address.countryCode !== pack.countryCode;
    if (pack !== undefined && !this.foreignAddress)
      this.#replace(this.draftFor(oneLineAddress(pack, address)));
  }

  #addressSearch(): TemplateResult {
    return html`<wt-address-lookup
      name="domicile-search"
      .provider=${this.addressProvider}
      country-code=${this.countryCode}
      label=${t("venue_details.address_lookup.label")}
      placeholder=${t("venue_details.address_lookup.placeholder")}
      no-results-label=${t("venue_details.address_lookup.no_results")}
      unavailable-label=${t("venue_details.address_lookup.unavailable")}
      .message=${
        this.foreignAddress
          ? fill("venue_details.address_lookup.other_country", {
              country: new Intl.DisplayNames([currentLocale()], { type: "region" }).of(
                this.countryCode,
              )!,
            })
          : ""
      }
      ?disabled=${this.busy}
      @wt-address-chosen=${(event: CustomEvent<AddressChosenDetail>) => this.#addressChosen(event)}
    ></wt-address-lookup>`;
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
    const value = normalized(this.valueFor(draft));
    const opening = this.#opening;
    const reportLateRefusal = this.lateRefusalFor?.(this.settings.notSaved);
    this.busy = true;
    try {
      const { model } = await this.settings.send(this.api, value, expected);
      const current = opening === this.#opening;
      if (current) this.#scope?.commit(draft);
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
        const message = t(refusals[reason] ?? "venue_details.invalid");
        const fields = this.refusedFields(reason, draft);
        this.refusal = Object.fromEntries(fields.map((name) => [name, message]));
        await this.#focusField(fields[0]!);
      } else {
        this.bottom =
          code === "venue.detail_changed" ? t(this.settings.changedElsewhere) : codeMessage(code);
      }
    }
  }

  async #focusField(name: string): Promise<void> {
    await this.updateComplete;
    this.#dialog()?.querySelector<HTMLElement>(`:is(wt-input,wt-combobox)[name=${name}]`)?.focus();
  }

  override render(): TemplateResult {
    const open = this.opened !== null;
    const own = open ? this.#ownErrors() : {};
    const errors = { ...own, ...this.refusal };
    const bottom = this.#feedback.message(
      { request: this.bottom, ...errors },
      new Set(Object.keys(errors)),
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
          ? html`${settings.addressSearch ? this.#addressSearch() : nothing}${this.renderFields({
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
