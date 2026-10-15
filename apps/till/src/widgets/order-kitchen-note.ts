import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, draftScopeFor, focusFirstInvalid, saveActionState } from "@waitron/ui";
import type { DraftScope, LeaveCoordinator, LeaveReason, WtDialog } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-textarea.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { t } from "../i18n/t.js";
import { trackDialog } from "./track-dialog.js";

export interface SaveKitchenNoteDetail {
  scopeKey: string;
  revision: number;
  visit: number;
  note: string | null;
}

const normalise = (value: string | null): string | null =>
  // eslint-disable-next-line no-control-regex -- compare saved instructions without control bytes
  value?.replace(/[\x00-\x1f\x7f-\x9f]+/g, " ").trim() || null;

@customElement("till-order-kitchen-note")
export class TillOrderKitchenNote extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      .heading {
        display: flex;
        min-width: 0;
        margin-block: var(--wt-space-2);
      }
      .heading wt-button {
        min-width: 0;
        max-width: 100%;
      }
      .heading wt-button::part(button) {
        white-space: normal;
        text-align: start;
        overflow-wrap: anywhere;
      }
      .fields {
        display: grid;
        gap: var(--wt-space-3);
        width: var(--wt-form-max-width);
        max-width: 100%;
      }
    `,
  ];
  @property() scopeKey = "";
  @property() note: string | null = null;
  @property({ type: Number }) revision = 0;
  @property({ type: Number }) visit = 0;
  @property({ type: Boolean }) busy = false;
  @property() refusal = "";
  @property() fieldRefusal = "";
  @state() private editing = false;
  @state() private draft = "";
  @state() private attempted = false;
  @state() private pending: SaveKitchenNoteDetail | null = null;
  #opening?: { scopeKey: string; visit: number };
  #baseline: string | null = null;
  #scope?: DraftScope<string | null>;
  #leave?: LeaveCoordinator;
  #focusHeading = false;
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.busy &&
    this.pending === null &&
    (await this.#leave!.request({ scopes: [this], reason, proceed() {} })) === "proceeded";

  override willUpdate(changed: PropertyValues<this>): void {
    if (!this.editing) return;
    if (this.#opening?.scopeKey !== this.scopeKey || this.#opening.visit !== this.visit) {
      this.#close();
      return;
    }
    if (!this.#scope) this.#track();
    if (changed.has("note") || changed.has("revision")) {
      const saved = normalise(this.note);
      if (this.pending !== null && this.pending.note === saved) {
        this.#close();
        return;
      }
      if (normalise(this.draft) === this.#baseline) this.draft = saved ?? "";
      this.#baseline = saved;
      this.#scope!.commit(saved);
    }
    if ((changed.has("refusal") && this.refusal) || (changed.has("busy") && !this.busy))
      this.pending = null;
  }

  override updated(): void {
    if (!this.#focusHeading) return;
    this.#focusHeading = false;
    this.shadowRoot!.querySelector<HTMLElement>("[data-edit]")?.focus();
  }

  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    super.disconnectedCallback();
  }

  #track(): void {
    const { scope, coordinator } = draftScopeFor<string | null>(this, {
      id: this,
      current: () => normalise(this.draft),
      snapshot: (value) => value,
      equal: (a, b) => a === b,
      restore: (value) => (this.draft = value ?? ""),
    });
    this.#scope = scope;
    this.#leave = coordinator;
    scope.commit(this.#baseline);
  }

  #open(): void {
    if (this.busy || this.editing) return;
    this.#opening = { scopeKey: this.scopeKey, visit: this.visit };
    this.#baseline = normalise(this.note);
    this.draft = this.note ?? "";
    this.attempted = false;
    this.refusal = "";
    this.fieldRefusal = "";
    this.pending = null;
    this.editing = true;
  }

  #close(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    this.editing = false;
    this.pending = null;
    this.#focusHeading = true;
  }

  #change(value: string): void {
    if (this.busy || this.pending !== null) return;
    this.draft = value;
    this.fieldRefusal = "";
    this.#scope?.changed();
  }

  #tooLong(): boolean {
    return (normalise(this.draft)?.length ?? 0) > 2000;
  }

  async #save(): Promise<void> {
    if (
      !this.isConnected ||
      !this.editing ||
      this.busy ||
      this.pending !== null ||
      saveActionState(this.#scope).unchanged
    )
      return;
    this.attempted = true;
    this.refusal = "";
    this.fieldRefusal = "";
    if (this.#tooLong()) {
      await this.updateComplete;
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    const detail: SaveKitchenNoteDetail = {
      ...this.#opening!,
      revision: this.revision,
      note: normalise(this.draft),
    };
    this.pending = detail;
    this.dispatchEvent(
      new CustomEvent<SaveKitchenNoteDetail>("save-kitchen-note", {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    const action = saveActionState(this.#scope);
    const fieldError =
      this.attempted && this.#tooLong() ? t("kitchen_note.too_long") : this.fieldRefusal;
    return html`<div class="heading">
        <wt-button
          data-edit
          variant="secondary"
          ?disabled=${this.busy}
          @click=${() => this.#open()}
        >
          ${this.note === null ? t("kitchen_note.add") : `${t("kitchen_note.heading")}: ${this.note}`}
        </wt-button>
      </div>
      ${
        this.editing
          ? html`<wt-dialog
              ${trackDialog()}
              .open=${true}
              .heading=${t("kitchen_note.title")}
              .beforeClose=${this.#beforeClose}
              @wt-close=${(event: Event) => {
                event.stopPropagation();
                if (event.target === event.currentTarget) this.#close();
              }}
            >
              <div class="fields">
                <wt-textarea
                  name="kitchenNote"
                  autocomplete="off"
                  .label=${t("kitchen_note.title")}
                  .placeholder=${t("kitchen_note.placeholder")}
                  .value=${this.draft}
                  .maxlength=${2000}
                  .error=${fieldError}
                  ?disabled=${this.busy || this.pending !== null}
                  @wt-change=${(event: CustomEvent<{ value: string }>) => {
                    event.stopPropagation();
                    this.#change(event.detail.value);
                  }}
                ></wt-textarea>
                <wt-form-actions
                  .error=${[fieldError ? t("form.fix_fields") : "", this.refusal].filter(Boolean).join(" ")}
                >
                  <wt-button
                    slot="cancel"
                    data-cancel
                    variant="secondary"
                    ?disabled=${this.busy || this.pending !== null}
                    @click=${() => void this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.requestClose("cancel")}
                    >${t("kitchen_note.cancel")}</wt-button
                  >
                  <wt-button
                    slot="secondary"
                    data-clear
                    variant="danger"
                    ?disabled=${this.busy || this.pending !== null || normalise(this.draft) === null}
                    @click=${() => this.#change("")}
                    >${t("kitchen_note.clear")}</wt-button
                  >
                  <wt-button
                    data-save
                    variant=${action.variant}
                    ?disabled=${this.busy || this.pending !== null || action.unchanged || (this.attempted && this.#tooLong())}
                    @click=${() => void this.#save()}
                    >${t("kitchen_note.save")}</wt-button
                  >
                </wt-form-actions>
              </div>
            </wt-dialog>`
          : nothing
      }`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-order-kitchen-note": TillOrderKitchenNote;
  }
}
