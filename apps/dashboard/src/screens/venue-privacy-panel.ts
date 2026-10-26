import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  PRIVACY_CONTACT_FIELDS,
  PRIVACY_CONTACT_MAX_LENGTH,
  privacyContactProblem,
  privacyContactValue,
  type PrivacyContactField,
  type PrivacyContactProblem,
} from "@waitron/shared";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  saveActionState,
  submitOnEnter,
  type DraftScope,
  type LeaveCoordinator,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-help-tooltip.js";
import "@waitron/ui/src/components/wt-input.js";
import { QueryController } from "@waitron/dashboard-kit";
import type { DashboardApi, VenuePrivacy } from "../api/client.js";
import { dashboardQuery } from "../api/live-queries.js";
import { guideHref } from "../help-guide.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import { fill, t } from "../i18n/t.js";
import { settingsCard, settingsCardStyles, settingsRows } from "../widgets/settings-card.js";

type Field = PrivacyContactField;
type Draft = Record<Field, string>;
type Errors = Partial<Record<Field, string>>;

function draftOf(model: VenuePrivacy): Draft {
  return { privacyNoticeUrl: model.privacyNoticeUrl ?? "", privacyEmail: model.privacyEmail ?? "" };
}

function changes(expected: Draft, draft: Draft): Partial<Draft> {
  return Object.fromEntries(
    PRIVACY_CONTACT_FIELDS.filter(
      (key) => privacyContactValue(draft[key]) !== privacyContactValue(expected[key]),
    ).map((key) => [key, draft[key]]),
  );
}

function problemText(field: Field, problem: PrivacyContactProblem): string {
  if (problem === "length")
    return fill("venue_privacy.too_long", { max: String(PRIVACY_CONTACT_MAX_LENGTH[field]) });
  return t(
    problem === "email" ? "venue_privacy.email_invalid" : "venue_privacy.web_address_invalid",
  );
}

function ownErrors(draft: Draft): Errors {
  const errors: Errors = {};
  for (const field of PRIVACY_CONTACT_FIELDS) {
    const problem = privacyContactProblem(field, privacyContactValue(draft[field]));
    if (problem) errors[field] = problemText(field, problem);
  }
  return errors;
}

@customElement("dashboard-venue-privacy-panel")
export class VenuePrivacyPanel extends LitElement {
  static override styles = [
    baseStyles,
    settingsCardStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      p {
        margin: var(--wt-space-3) 0 0;
      }
      .error {
        color: var(--wt-color-danger);
      }
      form {
        display: grid;
        gap: var(--wt-space-3);
      }
      form > wt-input {
        max-width: var(--wt-form-max-width);
      }
    `,
  ];
  @property({ attribute: false }) api!: DashboardApi;
  @property({ attribute: false }) readOnly = false;
  @state() private model?: VenuePrivacy;
  @state() private readError = "";
  @state() private draft?: Draft;
  @state() private attempted = false;
  @state() private refusals: Errors = {};
  @state() private actionError = "";
  @state() private submitting = false;
  #expected?: Draft;
  #scope?: DraftScope<Draft>;
  #leave?: LeaveCoordinator;
  #generation = 0;
  /** Each read and each save answer takes the next place when it begins (an answer when it
   * arrives); the card shows a value only if its place is later than the one it shows. */
  #places = 0;
  #shownPlace = 0;
  #loadedBefore = false;
  readonly #queries = new QueryController(
    this,
    () => this.api.liveData,
    (error) => {
      this.readError = codeMessage(codeOf(error));
    },
    () => {
      this.readError = "";
    },
  );

  constructor() {
    super();
    this.addEventListener("venue-settings-hidden", () => {
      if (this.#scope && saveActionState(this.#scope).unchanged) this.#cancel();
    });
  }
  override connectedCallback(): void {
    super.connectedCallback();
    this.#generation++;
    this.#registerDraft();
    void this.#load();
  }
  override disconnectedCallback(): void {
    this.#generation++;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    super.disconnectedCallback();
  }
  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("readOnly") && this.readOnly) this.#cancel();
  }
  #begin(): void {
    const model = this.model;
    if (!model) return;
    this.#expected = draftOf(model);
    this.draft = { ...this.#expected };
    this.#reset();
    this.#registerDraft();
  }
  #reset(): void {
    this.attempted = false;
    this.refusals = {};
    this.actionError = "";
  }
  #registerDraft(): void {
    if (!this.isConnected || !this.draft || !this.#expected || this.#scope) return;
    const { coordinator, scope } = draftScopeFor<Draft>(this, {
      id: this,
      current: () => this.draft!,
      snapshot: (value) => ({ ...value }),
      equal: (a, b) => Object.keys(changes(a, b)).length === 0,
      restore: () => this.#cancel(),
    });
    this.#leave = coordinator;
    this.#scope = scope;
    scope.commit(this.#expected);
  }
  #cancel(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.draft = undefined;
    this.#expected = undefined;
    this.#reset();
  }
  #requestCancel(): void {
    if (this.submitting) return;
    const scope = this.#scope;
    if (!scope || !this.#leave) {
      this.#cancel();
      return;
    }
    void this.#leave.request({
      scopes: [this],
      reason: "cancel",
      proceed: () => {
        if (this.#scope === scope) this.#cancel();
      },
    });
  }
  #adopt(model: VenuePrivacy): void {
    if (!this.draft || !this.#scope) return;
    if (!saveActionState(this.#scope).unchanged) return;
    const expected = draftOf(model);
    if (this.#expected && Object.keys(changes(this.#expected, expected)).length === 0) return;
    this.#expected = expected;
    this.draft = { ...expected };
    this.#scope.commit(expected);
  }
  #errors(): Errors {
    if (!this.draft) return {};
    return { ...this.refusals, ...(this.attempted ? ownErrors(this.draft) : {}) };
  }
  #change(field: Field, event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    if (!this.draft || this.submitting) return;
    this.draft = { ...this.draft, [field]: event.detail.value };
    const refusals = { ...this.refusals };
    delete refusals[field];
    this.refusals = refusals;
    this.actionError = "";
    this.#scope?.changed();
  }
  async #focusInvalid(): Promise<void> {
    await this.updateComplete;
    await focusFirstInvalid(this.shadowRoot!.querySelector("form")!);
  }
  async #save(): Promise<void> {
    if (this.submitting || !this.draft || !this.#expected) return;
    if (saveActionState(this.#scope).unchanged) return;
    this.attempted = true;
    this.refusals = {};
    this.actionError = "";
    if (Object.keys(ownErrors(this.draft)).length > 0) {
      await this.#focusInvalid();
      return;
    }
    const draft = this.draft;
    this.submitting = true;
    try {
      const answer = await this.api.putVenuePrivacy(changes(this.#expected, this.draft));
      this.#shownPlace = ++this.#places;
      this.model = answer;
      if (draft === this.draft) this.#cancel();
      else this.#adopt(answer);
      if (this.isConnected) void this.#reread();
    } catch (error) {
      if (draft !== this.draft) return;
      const code = codeOf(error);
      const params = (error as { params?: { field?: unknown; reason?: unknown } } | null)?.params;
      const field = PRIVACY_CONTACT_FIELDS.find((name) => name === params?.field);
      if (code === "venue.detail_invalid" && field) {
        const reason = params?.reason;
        this.refusals = {
          [field]:
            reason === "web_address" || reason === "email" || reason === "length"
              ? problemText(field, reason)
              : t("venue_details.invalid"),
        };
        this.submitting = false;
        await this.#focusInvalid();
      } else this.actionError = codeMessage(code);
    } finally {
      this.submitting = false;
    }
  }
  #show(place: number, value: VenuePrivacy): void {
    if (place <= this.#shownPlace) return;
    this.#shownPlace = place;
    this.model = value;
    this.readError = "";
    this.#adopt(value);
  }
  async #reread(): Promise<void> {
    const generation = this.#generation;
    const place = ++this.#places;
    try {
      const value = await (this.api.background ?? this.api).getVenuePrivacy();
      if (generation === this.#generation) this.#show(place, value);
    } catch (error) {
      if (generation === this.#generation && place > this.#shownPlace)
        this.readError = codeMessage(codeOf(error));
    }
  }
  #field(field: Field, errors: Errors) {
    const url = field === "privacyNoticeUrl";
    return html`<wt-input
      name=${field}
      type=${url ? "url" : "text"}
      autocomplete=${url ? "" : "off"}
      label=${t(url ? "venue_privacy.notice_url" : "venue_privacy.email")}
      placeholder=${t(url ? "venue_privacy.notice_url_placeholder" : "venue_privacy.email_placeholder")}
      .value=${this.draft![field]}
      .error=${errors[field] ?? ""}
      ?disabled=${this.submitting}
      @wt-change=${(event: CustomEvent<{ value: string }>) => this.#change(field, event)}
      >${
        url
          ? html`<wt-help-tooltip
              slot="help"
              mode="help-mode"
              aria-label=${t("venue_privacy.notice_url_help_label")}
              guide-href=${guideHref("data-protection.staff-notice")}
              guide-label=${t("venue_privacy.notice_url_help_guide")}
              >${t("venue_privacy.notice_url_help")}</wt-help-tooltip
            >`
          : nothing
      }</wt-input
    >`;
  }
  #form() {
    const errors = this.#errors();
    const failsOwnChecks = this.attempted && Object.keys(ownErrors(this.draft!)).length > 0;
    const saveAction = saveActionState(this.#scope);
    return html`<form
      @submit=${(event: Event) => {
        event.preventDefault();
        void this.#save();
      }}
      @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.shadowRoot!.querySelector<HTMLElement>("[data-test=save]"))}
    >
      ${PRIVACY_CONTACT_FIELDS.map((field) => this.#field(field, errors))}
      <wt-form-actions
        .error=${Object.keys(errors).length > 0 ? t("form.fix_fields") : this.actionError}
      >
        <wt-button
          slot="cancel"
          data-test="cancel"
          ?disabled=${this.submitting}
          @click=${() => this.#requestCancel()}
          >${t("action.cancel")}</wt-button
        >
        <wt-button
          data-test="save"
          variant=${saveAction.variant}
          ?loading=${this.submitting}
          ?disabled=${saveAction.unchanged || this.submitting || failsOwnChecks}
          @click=${() => void this.#save()}
          >${t("action.save")}</wt-button
        >
      </wt-form-actions>
    </form>`;
  }
  async #load(): Promise<void> {
    const generation = this.#generation;
    const query = dashboardQuery(
      this.#loadedBefore ? (this.api.background ?? this.api) : this.api,
      "getVenuePrivacy",
      [],
    );
    this.#loadedBefore = true;
    await this.#queries
      .watch(
        "getVenuePrivacy",
        {
          ...query,
          key: `${query.key}:venue-privacy-panel`,
          read: async () => {
            const place = ++this.#places;
            return { place, value: await query.read() };
          },
        },
        ({ place, value }) => {
          if (generation === this.#generation) this.#show(place, value);
        },
      )
      .catch(() => {});
  }
  override render() {
    const model = this.model;
    const editing = Boolean(this.draft);
    return html`${
      this.readError
        ? html`<p class="error" role="alert" data-test="read-error">${this.readError}</p>
            <wt-button data-test="retry" variant="secondary" @click=${() => void this.#load()}
              >${t("location_settings.retry")}</wt-button
            >`
        : nothing
    }
    ${
      model
        ? settingsCard({
            id: "privacy-card",
            heading: t("venue_settings.card.privacy"),
            editing,
            action:
              editing || this.readOnly
                ? nothing
                : html`<wt-button data-test="edit" @click=${() => this.#begin()}
                    >${t("action.edit")}</wt-button
                  >`,
            body: editing
              ? this.#form()
              : settingsRows([
                  {
                    label: t("venue_privacy.notice_url"),
                    value: model.privacyNoticeUrl ?? t("venue_details.unset"),
                    dataTest: "saved-privacyNoticeUrl",
                  },
                  {
                    label: t("venue_privacy.email"),
                    value: model.privacyEmail ?? t("venue_details.unset"),
                    dataTest: "saved-privacyEmail",
                  },
                ]),
          })
        : nothing
    }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-venue-privacy-panel": VenuePrivacyPanel;
  }
}
