import { LitElement, css, html, nothing } from "lit";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
import { isValidEmail } from "@waitron/shared";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  saveActionState,
  submitOnEnter,
} from "@waitron/ui";
import type { DraftScope, LeaveCoordinator, LeaveReason, WtDialog } from "@waitron/ui";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { trackDialog } from "./track-dialog.js";
import { t } from "../i18n/t.js";
import type { CorrectiveChoice, CorrectiveDelivery } from "../api/give-back-types.js";

/** The way the default stands for, as staff would choose it; null when it is not one to choose. */
function defaultDelivery(choice: CorrectiveChoice): CorrectiveDelivery | null {
  const way = choice.default;
  if (way === null) return null;
  if (way.medium !== "email") return { medium: "print", printerId: way.printerId };
  return way.recipient === null ? null : { medium: "email", recipient: way.recipient };
}

const same = (a: CorrectiveDelivery | null, b: CorrectiveDelivery | null) =>
  JSON.stringify(a) === JSON.stringify(b);

const offered = (choice: CorrectiveChoice, chosen: CorrectiveDelivery) =>
  chosen.medium === "email"
    ? choice.emailAvailable
    : choice.printers.some((printer) => printer.id === chosen.printerId);

/** What the give-back form remembers across previews: each printer it was offered, so a chosen
 * one a later preview no longer offers is still named, and the last address chosen. */
export interface CorrectiveMemory {
  printers: Map<string, CorrectiveChoice["printers"][number]>;
  email: string | null;
}
export const correctiveMemory = (): CorrectiveMemory => ({ printers: new Map(), email: null });

/** What a press sends for staff's choice: nothing when it is the way the invoice goes anyway. A way
 * the latest preview no longer offers is still sent, so the box's refusal is shown. */
export function chosenDelivery(
  choice: CorrectiveChoice | undefined,
  chosen: CorrectiveDelivery | null,
): CorrectiveDelivery | undefined {
  if (choice === undefined || chosen === null || same(chosen, defaultDelivery(choice)))
    return undefined;
  return chosen;
}

/** `request` with staff's choice of way for its corrective full invoice, when they made one. */
export function withCorrective<T extends object>(
  request: T,
  choice: CorrectiveChoice | undefined,
  chosen: CorrectiveDelivery | null,
): T & { correctiveDelivery?: CorrectiveDelivery } {
  const correctiveDelivery = chosenDelivery(choice, chosen);
  return correctiveDelivery === undefined ? request : { ...request, correctiveDelivery };
}

/** A refusal the box gave for the chosen way, worded for the line it stands beside. */
function correctiveRefusal(refusal: { code: string; field?: string } | null): string {
  if (refusal === null || !refusal.field?.startsWith("correctiveDelivery")) return "";
  if (refusal.code === "invoice_delivery.printer_invalid")
    return t("give_back.corrective_printer_invalid");
  if (refusal.code === "invoice_delivery.email_unavailable")
    return t("give_back.corrective_email_unavailable");
  return t("give_back.corrective_invalid");
}

/** What the line says under it: the box's refusal of the chosen way, or that the latest preview no
 * longer offers it, worded as the box's refusal of a press would be. */
export function correctiveError(
  choice: CorrectiveChoice | undefined,
  chosen: CorrectiveDelivery | null,
  refusal: { code: string; field?: string } | null,
): string {
  const refused = correctiveRefusal(refusal);
  const way = chosenDelivery(choice, chosen);
  if (refused !== "" || way === undefined || offered(choice!, way)) return refused;
  return t(
    way.medium === "email"
      ? "give_back.corrective_email_unavailable"
      : "give_back.corrective_printer_invalid",
  );
}

function printedOn(printer: { name: string; kind: "a4" | "receipt" }): string {
  if (printer.kind === "receipt" && printer.name === "")
    return t("give_back.corrective_printed_receipt");
  return t(
    printer.kind === "receipt"
      ? "give_back.corrective_printed_receipt_on"
      : "give_back.corrective_printed_a4",
  ).replace("{printer}", () => printer.name);
}

function wayText(
  choice: CorrectiveChoice,
  chosen: CorrectiveDelivery | null,
  memory: CorrectiveMemory,
): string {
  if (chosen?.medium === "email")
    return t("give_back.corrective_emailed").replace("{address}", () => chosen.recipient);
  if (chosen?.medium === "print") return printedOn(memory.printers.get(chosen.printerId)!);
  const way = choice.default;
  if (way === null) return t("give_back.corrective_not_sent");
  if (way.medium !== "email") return printedOn({ name: way.printerName, kind: way.medium });
  return way.recipient === null
    ? t("give_back.corrective_emailed_customer")
    : t("give_back.corrective_emailed").replace("{address}", () => way.recipient!);
}

/** The give-back form's corrective line, when the give-back files a corrective full invoice. */
export function correctiveLine(
  choice: CorrectiveChoice | undefined,
  chosen: CorrectiveDelivery | null,
  memory: CorrectiveMemory,
  error: string,
  onChoose: (delivery: CorrectiveDelivery) => void,
) {
  if (choice === undefined) return nothing;
  for (const printer of choice.printers) memory.printers.set(printer.id, printer);
  return html`<till-corrective-choice
    .choice=${choice}
    .chosen=${chosenDelivery(choice, chosen) ?? null}
    .memory=${memory}
    .error=${error}
    @corrective-choice=${(event: CustomEvent<{ delivery: CorrectiveDelivery }>) => {
      event.stopPropagation();
      onChoose(event.detail.delivery);
    }}
  ></till-corrective-choice>`;
}

/** The line under the summary saying where the corrective full invoice goes, with Change, which
 * opens the sheet. Sends `corrective-choice` with the way staff chose. */
@customElement("till-corrective-choice")
export class TillCorrectiveChoice extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2) var(--wt-space-3);
      }
      p {
        margin: 0;
        overflow-wrap: anywhere;
      }
      [data-corrective-way] {
        flex: 1 1 0;
        min-width: 0;
      }
      .error {
        flex-basis: 100%;
        color: var(--wt-color-danger);
        font-size: var(--wt-font-size-sm);
      }
    `,
  ];
  @property({ attribute: false }) choice!: CorrectiveChoice;
  @property({ attribute: false }) chosen: CorrectiveDelivery | null = null;
  @property({ attribute: false }) memory: CorrectiveMemory = correctiveMemory();
  /** The box's refusal of the chosen way, or that the latest preview no longer offers it. */
  @property() error = "";
  @state() private open = false;

  #chose(event: CustomEvent<{ delivery: CorrectiveDelivery }>): void {
    event.stopPropagation();
    const { delivery } = event.detail;
    if (delivery.medium === "email") this.memory.email = delivery.recipient;
    void this.#closeSheet();
    this.dispatchEvent(
      new CustomEvent("corrective-choice", { detail: { delivery }, bubbles: true, composed: true }),
    );
  }
  /** Closes the sheet and gives focus back to Change, which opened it. */
  async #closeSheet(): Promise<void> {
    this.open = false;
    await this.updateComplete;
    this.shadowRoot!.querySelector<HTMLElement>("[data-corrective-change]")?.focus();
  }
  override render() {
    const choosable = this.choice.printers.length > 0 || this.choice.emailAvailable;
    return html`<p data-corrective-way>${wayText(this.choice, this.chosen, this.memory)}</p>
      ${
        choosable
          ? html`<wt-button
              variant="secondary"
              data-corrective-change
              @click=${() => (this.open = true)}
              >${t("give_back.corrective_change")}</wt-button
            >`
          : nothing
      }
      ${
        this.error === ""
          ? nothing
          : html`<p class="error" data-corrective-error role="alert">${this.error}</p>`
      }
      ${
        this.open
          ? html`<till-corrective-sheet
              .choice=${this.choice}
              .chosen=${this.chosen}
              .email=${this.memory.email}
              @corrective-sheet-done=${(event: CustomEvent<{ delivery: CorrectiveDelivery }>) =>
                this.#chose(event)}
              @corrective-sheet-cancel=${(event: Event) => {
                event.stopPropagation();
                void this.#closeSheet();
              }}
            ></till-corrective-sheet>`
          : nothing
      }`;
  }
}

interface SheetDraft {
  way: string;
  email: string;
}

/** The sheet Change opens: a printer the device may use, or email to an address. Sends
 * `corrective-sheet-done` with the chosen way, or `corrective-sheet-cancel`. */
@customElement("till-corrective-sheet")
export class TillCorrectiveSheet extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .fields {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
        width: var(--wt-form-max-width);
        max-width: 100%;
      }
    `,
  ];
  @property({ attribute: false }) choice!: CorrectiveChoice;
  /** Staff's earlier choice on this form; null for the default way. */
  @property({ attribute: false }) chosen: CorrectiveDelivery | null = null;
  /** The last address staff chose on this form, if any. */
  @property({ attribute: false }) email: string | null = null;
  @state() private draft: SheetDraft = { way: "", email: "" };
  @state() private attempted = false;
  @state() private active = true;
  /** What the sheet opened on; the draft scope's baseline. */
  #opened?: SheetDraft;
  /** The sheet opened on a way other than the one the line shows, so Done chooses it as it is. */
  #savableAtOpen = false;
  #scope?: DraftScope<SheetDraft>;
  #leave?: LeaveCoordinator;
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    (await this.#leave!.request({ scopes: [this], reason, proceed() {} })) === "proceeded";

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
    if (this.#opened !== undefined) return;
    const kept = this.chosen !== null && offered(this.choice, this.chosen) ? this.chosen : null;
    const current = kept ?? defaultDelivery(this.choice);
    const fallback = this.choice.printers[0] ? `print:${this.choice.printers[0].id}` : "email";
    const defaultWay = this.choice.default;
    this.#savableAtOpen = current === null || kept !== this.chosen;
    this.#opened = {
      way:
        current === null
          ? fallback
          : current.medium === "email"
            ? "email"
            : `print:${current.printerId}`,
      email:
        (current?.medium === "email" ? current.recipient : null) ??
        this.email ??
        (defaultWay?.medium === "email" ? defaultWay.recipient : null) ??
        "",
    };
    this.draft = { ...this.#opened };
  }
  override willUpdate(): void {
    if (!this.isConnected || !this.active || this.#scope) return;
    const { coordinator, scope } = draftScopeFor<SheetDraft>(this, {
      id: this,
      current: () => this.draft,
      snapshot: (value) => ({ ...value }),
      equal: (a, b) => a.way === b.way && (a.way !== "email" || a.email.trim() === b.email.trim()),
      restore: (value) => (this.draft = { ...value }),
    });
    this.#leave = coordinator;
    this.#scope = scope;
    scope.commit(this.#opened!);
  }
  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    super.disconnectedCallback();
  }
  #doneState() {
    return saveActionState(this.#scope, { savableAtOpen: this.#savableAtOpen });
  }
  #deliveryOf(draft: SheetDraft): CorrectiveDelivery {
    return draft.way === "email"
      ? { medium: "email", recipient: draft.email.trim() }
      : { medium: "print", printerId: draft.way.slice("print:".length) };
  }
  #invalid(): boolean {
    return this.draft.way === "email" && !isValidEmail(this.draft.email.trim());
  }
  #set(change: Partial<SheetDraft>): void {
    this.draft = { ...this.draft, ...change };
    this.#scope?.changed();
  }
  async #done(): Promise<void> {
    if (!this.active || this.#doneState().unchanged) return;
    this.attempted = true;
    if (this.#invalid()) {
      await this.updateComplete;
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    this.dispatchEvent(
      new CustomEvent<{ delivery: CorrectiveDelivery }>("corrective-sheet-done", {
        detail: { delivery: this.#deliveryOf(this.draft) },
        bubbles: true,
        composed: true,
      }),
    );
  }
  #closed(event: Event): void {
    event.stopPropagation();
    if (event.target !== event.currentTarget || !this.active) return;
    this.active = false;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.dispatchEvent(
      new CustomEvent("corrective-sheet-cancel", { bubbles: true, composed: true }),
    );
  }
  #options() {
    return [
      ...this.choice.printers.map((printer) => ({
        value: `print:${printer.id}`,
        label: (printer.kind === "a4"
          ? t("invoice.delivery_a4_on")
          : t("give_back.corrective_receipt_on")
        ).replace("{printer}", () => printer.name),
      })),
      ...(this.choice.emailAvailable
        ? [{ value: "email", label: t("invoice.delivery_email") }]
        : []),
    ];
  }
  override render() {
    const error = this.attempted && this.#invalid() ? t("invoice.email_invalid") : "";
    const doneState = this.#doneState();
    return html`<wt-dialog
      ${trackDialog()}
      .open=${this.active}
      .beforeClose=${this.#leave ? this.#beforeClose : undefined}
      .heading=${t("give_back.corrective_heading")}
      @wt-close=${(event: Event) => this.#closed(event)}
    >
      <div class="fields">
        <wt-combobox
          name="delivery"
          search="never"
          preserve-order
          .label=${t("invoice.delivery")}
          .options=${this.#options()}
          .value=${this.draft.way}
          @wt-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation();
            this.#set({ way: event.detail.value });
          }}
        ></wt-combobox>
        ${
          this.draft.way === "email"
            ? html`<wt-input
                name="email"
                type="email"
                required
                autocomplete="off"
                .label=${t("invoice.email")}
                .value=${live(this.draft.email)}
                .error=${error}
                @wt-change=${(event: CustomEvent<{ value: string }>) => {
                  event.stopPropagation();
                  this.#set({ email: event.detail.value });
                }}
                @keydown=${(event: KeyboardEvent) => {
                  submitOnEnter(
                    event,
                    this.shadowRoot!.querySelector<HTMLElement>("[data-corrective-done]"),
                  );
                  // The give-back form around the sheet presses Give back on Enter.
                  if (event.key === "Enter") event.stopPropagation();
                }}
              ></wt-input>`
            : nothing
        }
        <wt-form-actions .error=${error === "" ? "" : t("form.fix_fields")}>
          <wt-button
            slot="cancel"
            variant="secondary"
            data-corrective-cancel
            @click=${() =>
              void this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.requestClose("cancel")}
            >${t("action.cancel")}</wt-button
          >
          <wt-button
            data-corrective-done
            variant=${doneState.variant}
            ?disabled=${doneState.unchanged || error !== ""}
            @click=${() => void this.#done()}
            >${t("give_back.done")}</wt-button
          >
        </wt-form-actions>
      </div>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-corrective-choice": TillCorrectiveChoice;
    "till-corrective-sheet": TillCorrectiveSheet;
  }
}
