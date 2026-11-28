import { LitElement, css, html, nothing } from "lit";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
import { isValidEmail } from "@waitron/shared";
import { baseStyles, focusFirstInvalid, submitOnEnter } from "@waitron/ui";
import type { WtDialog } from "@waitron/ui";
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

/** What a press sends for staff's choice: nothing when it is the way the invoice goes anyway, or a
 * way the latest preview no longer offers. */
export function chosenDelivery(
  choice: CorrectiveChoice | undefined,
  chosen: CorrectiveDelivery | null,
): CorrectiveDelivery | undefined {
  if (
    choice === undefined ||
    chosen === null ||
    !offered(choice, chosen) ||
    same(chosen, defaultDelivery(choice))
  )
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
export function correctiveRefusal(refusal: { code: string; field?: string } | null): string {
  if (refusal === null || !refusal.field?.startsWith("correctiveDelivery")) return "";
  if (refusal.code === "invoice_delivery.printer_invalid")
    return t("give_back.corrective_printer_invalid");
  if (refusal.code === "invoice_delivery.email_unavailable")
    return t("give_back.corrective_email_unavailable");
  return t("give_back.corrective_invalid");
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

function wayText(choice: CorrectiveChoice, chosen: CorrectiveDelivery | null): string {
  if (chosen?.medium === "email")
    return t("give_back.corrective_emailed").replace("{address}", () => chosen.recipient);
  if (chosen?.medium === "print")
    return printedOn(choice.printers.find((row) => row.id === chosen.printerId)!);
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
  error: string,
  onChoose: (delivery: CorrectiveDelivery) => void,
) {
  if (choice === undefined) return nothing;
  return html`<till-corrective-choice
    .choice=${choice}
    .chosen=${chosenDelivery(choice, chosen) ?? null}
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
  /** The box's refusal of the chosen way, if it gave one. */
  @property() error = "";
  @state() private open = false;

  #chose(event: CustomEvent<{ delivery: CorrectiveDelivery }>): void {
    event.stopPropagation();
    this.open = false;
    this.dispatchEvent(
      new CustomEvent("corrective-choice", {
        detail: { delivery: event.detail.delivery },
        bubbles: true,
        composed: true,
      }),
    );
  }
  override render() {
    const choosable = this.choice.printers.length > 0 || this.choice.emailAvailable;
    return html`<p data-corrective-way>${wayText(this.choice, this.chosen)}</p>
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
              @corrective-sheet-done=${(event: CustomEvent<{ delivery: CorrectiveDelivery }>) =>
                this.#chose(event)}
              @corrective-sheet-cancel=${(event: Event) => {
                event.stopPropagation();
                this.open = false;
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
  @state() private draft: SheetDraft = { way: "", email: "" };
  @state() private attempted = false;
  @state() private active = true;

  override connectedCallback(): void {
    super.connectedCallback();
    const current = this.chosen ?? defaultDelivery(this.choice);
    const fallback = this.choice.printers[0] ? `print:${this.choice.printers[0].id}` : "email";
    this.draft = {
      way:
        current === null
          ? fallback
          : current.medium === "email"
            ? "email"
            : `print:${current.printerId}`,
      email: current?.medium === "email" ? current.recipient : "",
    };
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
  }
  async #done(): Promise<void> {
    if (!this.active) return;
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
    return html`<wt-dialog
      ${trackDialog()}
      .open=${this.active}
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
            variant="primary"
            ?disabled=${error !== ""}
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
