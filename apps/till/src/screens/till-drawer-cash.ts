import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  FormFeedback,
  baseStyles,
  draftScopeFor,
  parseDecimalInput,
  saveActionState,
  submitOnEnter,
  type WtDialog,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-price-input.js";
import "@waitron/ui/src/components/wt-segmented-control.js";
import type { DrawerEntryRequest, TillApi } from "../api/client.js";
import { currentLocale, t } from "../i18n/t.js";
import { trackDialog } from "../widgets/track-dialog.js";

type Direction = DrawerEntryRequest["kind"] | "";
type Field = "amount" | "reason";
type Change = CustomEvent<{ value: string }>;

function cashAmount(input: string): string | null {
  const parsed = parseDecimalInput(input);
  return parsed !== null && /^\d{1,12}(?:\.\d{1,2})?$/.test(parsed) && /[1-9]/.test(parsed)
    ? parsed.replace(/^0+(?=\d)/, "")
    : null;
}

@customElement("till-drawer-cash")
export class TillDrawerCash extends LitElement {
  static override styles = [
    baseStyles,
    css`
      form {
        display: grid;
        gap: var(--wt-space-3);
      }
      p {
        margin: 0;
      }
    `,
  ];

  @property({ attribute: false }) api!: Pick<TillApi, "openDrawer" | "saveDrawerEntry">;
  @property({ attribute: false }) opener: HTMLElement | null = null;
  @property() printerId = "";
  @property({ type: Boolean }) opensDrawer = false;
  @state() private draft = { kind: "" as Direction, amount: "", reason: "" };
  @state() private busy = false;
  @state() private saved = false;
  @state() private opened = false;
  @state() private manual = false;
  @state() private switchOperator = false;
  @state() private refusals: Partial<Record<Field | "request", string>> = {};
  readonly #feedback = new FormFeedback(this);
  #leave?: ReturnType<typeof draftScopeFor<typeof this.draft>>;
  #submission?: DrawerEntryRequest;

  override connectedCallback(): void {
    super.connectedCallback();
    this.#leave = draftScopeFor(this, {
      id: this,
      current: () => this.draft,
      snapshot: (draft) => draft,
      equal: (a, b) => a.kind === b.kind && a.amount === b.amount && a.reason === b.reason,
      restore: (draft) => (this.draft = draft),
    });
  }

  override disconnectedCallback(): void {
    this.#leave?.scope.dispose();
    this.#leave = undefined;
    super.disconnectedCallback();
  }

  #change(field: Field | "kind", event: Change): void {
    event.stopPropagation();
    const { value } = event.detail;
    if (field === "kind" && value !== "cash_in" && value !== "cash_out") return;
    this.draft = { ...this.draft, [field]: value };
    this.#leave?.scope.changed();
    this.#feedback.dismiss(field);
  }

  #showRefusal(error: unknown): void {
    const { code, params } = (error ?? {}) as { code?: string; params?: { field?: string } };
    if (
      code === "drawer.entry_invalid_field" &&
      (params?.field === "amount" || params?.field === "reason")
    ) {
      const { field } = params;
      this.refusals = {
        [field]: t(field === "amount" ? "drawer_entry.amount_error" : "drawer_entry.reason_error"),
      };
      void this.#feedback.focus(this.renderRoot);
    } else {
      this.switchOperator = code === "authorization.not_permitted";
      this.refusals = {
        request: t(
          this.switchOperator
            ? "drawer_entry.permission"
            : code === "drawer.assignment_changed" || code === "drawer.no_printer"
              ? "drawer_entry.reopen"
              : code === "submission.id_reused"
                ? "drawer_entry.reused"
                : "drawer_entry.failed",
        ),
      };
    }
    this.#feedback.newRefusal();
  }

  async #openDrawer(): Promise<void> {
    if (!this.opensDrawer || this.opened || this.manual || this.busy) return;
    this.busy = true;
    try {
      await this.api.openDrawer(undefined, this.printerId);
      this.opened = true;
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      if (code === "drawer.assignment_changed" || code === "authorization.not_permitted")
        this.#showRefusal(error);
      else this.manual = true;
    } finally {
      this.busy = false;
    }
  }

  #checks() {
    const amount = cashAmount(this.draft.amount);
    const reason = this.draft.reason.trim();
    const errors = {
      amount: amount === null ? t("drawer_entry.amount_error") : "",
      reason: !reason || reason.length > 500 ? t("drawer_entry.reason_error") : "",
    };
    return { amount, reason, errors };
  }

  async #save(): Promise<void> {
    const { kind } = this.draft;
    if (this.busy || this.saved || !kind || saveActionState(this.#leave?.scope).unchanged) return;
    this.#feedback.press();
    this.refusals = {};
    this.switchOperator = false;
    const { amount, reason, errors } = this.#checks();
    if (amount === null || errors.reason) {
      await this.#feedback.focus(this.renderRoot);
      return;
    }
    const previous = this.#submission;
    const submission =
      previous?.kind === kind && previous.amount === amount && previous.reason === reason
        ? previous
        : { printerId: this.printerId, submissionId: crypto.randomUUID(), kind, amount, reason };
    this.#submission = submission;
    this.busy = true;
    try {
      await this.api.saveDrawerEntry(submission);
      this.saved = true;
      this.#leave?.scope.commit(this.draft);
    } catch (error) {
      this.#showRefusal(error);
    } finally {
      this.busy = false;
    }
    if (this.saved) {
      await this.updateComplete;
      this.renderRoot.querySelector<HTMLElement>('[data-cash-action="done"]')?.focus();
    }
  }

  #close(): void {
    void this.renderRoot.querySelector<WtDialog>("wt-dialog")?.requestClose("cancel");
  }

  readonly #beforeClose: NonNullable<WtDialog["beforeClose"]> = async (reason) =>
    !this.busy &&
    (this.#leave?.coordinator === undefined ||
      (await this.#leave.coordinator.request({ scopes: [this], reason, proceed() {} })) ===
        "proceeded");

  override render() {
    const checks = this.#checks().errors;
    const errors = { ...this.#feedback.remaining(this.refusals) };
    if (this.#feedback.attempted) {
      errors.amount ||= checks.amount;
      errors.reason ||= checks.reason;
    }
    const fields = new Set<Field>();
    if (errors.amount) fields.add("amount");
    if (errors.reason) fields.add("reason");
    const { unchanged } = saveActionState(this.#leave?.scope);
    const available =
      !unchanged &&
      !!this.draft.kind &&
      (!this.#feedback.attempted || (!checks.amount && !checks.reason));
    return html`
      <wt-dialog
        ${trackDialog()}
        .open=${true}
        .heading=${t("drawer_entry.title")}
        .opener=${this.opener}
        .dismissible=${!this.busy}
        .beforeClose=${this.#beforeClose}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          this.dispatchEvent(new CustomEvent("drawer-cash-dismiss"));
        }}
      >
        ${
          this.saved
            ? html`<p role="status">${t("drawer_entry.saved")}</p>`
            : html`<form
                @submit=${(event: Event) => {
                  event.preventDefault();
                  void this.#save();
                }}
                @keydown=${(event: KeyboardEvent) =>
                  submitOnEnter(
                    event,
                    this.renderRoot.querySelector<HTMLElement>('[data-cash-action="save"]'),
                  )}
              >
                ${
                  this.manual || !this.opensDrawer
                    ? html`<p>${t("drawer_close.use_key")}</p>`
                    : this.opened
                      ? html`<p>${t("drawer_close.key_if_needed")}</p>`
                      : html`<wt-button
                          data-cash-action="open"
                          variant="secondary"
                          .disabled=${this.busy}
                          @click=${this.#openDrawer}
                          >${t("action.open_drawer")}</wt-button
                        >`
                }
                <wt-segmented-control
                  name="kind"
                  .label=${t("drawer_entry.direction")}
                  .value=${this.draft.kind}
                  .options=${[
                    { value: "cash_in", label: t("drawer_entry.in") },
                    { value: "cash_out", label: t("drawer_entry.out") },
                  ]}
                  .disabled=${this.busy}
                  @wt-change=${(event: Change) => this.#change("kind", event)}
                ></wt-segmented-control>
                <wt-price-input
                  name="amount"
                  fixed-unit
                  required
                  .label=${t("drawer_entry.amount")}
                  .locale=${currentLocale()}
                  .value=${this.draft.amount}
                  .error=${errors.amount ?? ""}
                  .disabled=${this.busy}
                  @wt-change=${(event: Change) => this.#change("amount", event)}
                ></wt-price-input>
                <wt-input
                  name="reason"
                  required
                  .label=${t("drawer_entry.reason")}
                  .value=${this.draft.reason}
                  .error=${errors.reason ?? ""}
                  .disabled=${this.busy}
                  @wt-change=${(event: Change) => this.#change("reason", event)}
                ></wt-input>
              </form>`
        }
        <wt-form-actions
          slot="footer"
          .error=${this.#feedback.message(errors, fields, t("form.fix_fields"))}
        >
          <wt-button
            slot=${this.saved ? "" : "cancel"}
            data-cash-action=${this.saved ? "done" : "back"}
            variant=${this.saved ? "primary" : "secondary"}
            .disabled=${this.busy}
            @click=${this.#close}
            >${t(this.saved ? "drawer_entry.done" : "action.cancel")}</wt-button
          >
          ${
            this.switchOperator
              ? html`<wt-button
                  slot="secondary"
                  @click=${() => this.dispatchEvent(new CustomEvent("logout", { bubbles: true, composed: true }))}
                  >${t("action.logout")}</wt-button
                >`
              : nothing
          }
          ${
            this.saved
              ? nothing
              : html`<wt-button
                  data-cash-action="save"
                  variant=${available || this.busy ? "primary" : "secondary"}
                  .disabled=${!available || this.busy}
                  .loading=${this.busy}
                  @click=${this.#save}
                  >${t("drawer_entry.save")}</wt-button
                >`
          }
        </wt-form-actions>
      </wt-dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-drawer-cash": TillDrawerCash;
  }
}
