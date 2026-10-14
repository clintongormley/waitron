import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
import { trackDialog } from "./track-dialog.js";
import { baseStyles, focusFirstInvalid, draftScopeFor, saveActionState } from "@waitron/ui";
import type { WtDialog, DraftScope, LeaveCoordinator, LeaveReason } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-number-stepper.js";
import type { TableState } from "../api/client.js";
import { countText, t } from "../i18n/t.js";
import { codeMessage } from "../i18n/codes.js";
import { shownName, splitsGroup } from "../state/floor-today.js";

export interface SplitJoinedDetail {
  partIds: string[];
  seats: number | null;
}

interface Draft {
  chosen: string[];
  seats: string;
}

const SEATS_MAX = 999;

function seatsFrom(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const seats = Number(trimmed);
  return seats >= 1 && seats <= SEATS_MAX ? seats : null;
}

@customElement("till-split-joined-dialog")
export class TillSplitJoinedDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      .fields {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-4);
        width: min(
          var(--wt-form-max-width),
          calc(var(--wt-dialog-max-width) - 2 * var(--wt-space-5))
        );
      }
      wt-number-stepper {
        --wt-stepper-field-width: 100%;
      }
      p {
        margin: 0;
      }
    `,
  ];

  @property({ attribute: false }) joined!: TableState;
  @property({ attribute: false }) parts: TableState[] = [];
  /** The window's heading names this: the joined table's shown name, or the group's name. */
  @property() name = "";
  /** Whether the tables left would need their seats, given their ids. */
  @property({ attribute: false }) asksSeats: (staying: readonly string[]) => boolean = (staying) =>
    staying.length >= 2;
  /** In a group's window, where the guests go for the tables ticked, one name per party. */
  @property({ attribute: false }) guestsMoveTo: (ticked: readonly string[]) => string[] = () => [];
  /** In a group's window, whether the tables ticked hold every table some party holds. */
  @property({ attribute: false }) strandsGuests: (ticked: readonly string[]) => boolean = () =>
    false;
  /** Asks the seats while two or more tables are left, as when the server refused a split for want
   * of them. */
  @property({ type: Boolean }) seatsRequired = false;
  @property({ type: Boolean }) busy = false;
  @property({ attribute: false }) refusal: { code: string; field?: string } | null = null;

  @state() private chosen: string[] = [];
  @state() private seats = "";
  @state() private attempted = false;
  @state() private refusalDismissed = false;
  @state() private active = true;
  #scope?: DraftScope<Draft>;
  #leave?: LeaveCoordinator;
  #baseline: Draft = { chosen: [], seats: "" };
  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.busy &&
    (await this.#leave!.request({ scopes: [this], reason, proceed() {} })) === "proceeded";

  override connectedCallback(): void {
    super.connectedCallback();
    this.requestUpdate();
  }

  override willUpdate(changed: PropertyValues): void {
    if (changed.has("refusal")) this.refusalDismissed = false;
    if (!this.isConnected || !this.active || this.#scope) return;
    const { coordinator, scope } = draftScopeFor<Draft>(this, {
      id: this,
      current: () => ({ chosen: this.#chosen(), seats: this.seats }),
      snapshot: (value) => ({ chosen: [...value.chosen], seats: value.seats }),
      equal: (a, b) => {
        const [x, y] = [seatsFrom(a.seats), seatsFrom(b.seats)];
        const sameSeats = x !== null && y !== null ? x === y : a.seats.trim() === b.seats.trim();
        return sameSeats && [...a.chosen].sort().join() === [...b.chosen].sort().join();
      },
      restore: (value) => {
        this.chosen = [...value.chosen];
        this.seats = value.seats;
      },
    });
    this.#leave = coordinator;
    this.#scope = scope;
    scope.commit(this.#baseline);
  }

  override disconnectedCallback(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    super.disconnectedCallback();
  }

  /** Marks the current choice saved, so the holder can close the window without the leave question. */
  commit(): void {
    if (!this.isConnected || !this.active) return;
    this.#baseline = { chosen: this.#chosen(), seats: this.seats };
    this.#scope?.commit(this.#baseline);
  }

  /** The chosen parts that are still parts, in the order the parts are given. */
  #chosen(): string[] {
    return this.parts.map((part) => part.id).filter((id) => this.chosen.includes(id));
  }

  #left(): TableState[] {
    const chosen = this.#chosen();
    return this.parts.filter((part) => !chosen.includes(part.id));
  }

  #asksSeats(): boolean {
    const left = this.#left().map((part) => part.id);
    return (this.seatsRequired && left.length >= 2) || this.asksSeats(left);
  }

  #partsError(): string {
    if (!this.attempted) return "";
    if (this.#chosen().length === 0) return t("floor.split_none");
    if (this.#left().length === 0) return t("floor.split_all");
    if (this.strandsGuests(this.#chosen())) return t("floor.split_strands");
    return "";
  }

  #seatsError(): string {
    return this.attempted && this.#asksSeats() && seatsFrom(this.seats) === null
      ? t("floor.seats_invalid")
      : "";
  }

  /** A refusal naming a field not shown goes to the foot, so it is never silent. */
  #shownRefusal(): { code: string; field?: string } | null {
    if (this.refusal === null || this.refusalDismissed) return null;
    if (this.refusal.field === "seats" && !this.#asksSeats()) return { code: this.refusal.code };
    return this.refusal;
  }

  #onChoose(event: CustomEvent<{ values: string[] }>): void {
    event.stopPropagation();
    if (!this.isConnected || !this.active || this.busy) return;
    this.chosen = [...event.detail.values];
    if (this.#shownRefusal()?.field === "partIds") this.refusalDismissed = true;
    this.#scope?.changed();
  }

  #onSeats(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    if (!this.isConnected || !this.active || this.busy) return;
    this.seats = event.detail.value;
    if (this.refusal?.field === "seats") this.refusalDismissed = true;
    this.#scope?.changed();
  }

  async #confirm(): Promise<void> {
    if (!this.isConnected || !this.active || this.busy) return;
    if (saveActionState(this.#scope).unchanged) return;
    this.attempted = true;
    this.refusalDismissed = true;
    if (this.#partsError() !== "" || this.#seatsError() !== "") {
      await focusFirstInvalid(this.shadowRoot!);
      return;
    }
    this.dispatchEvent(
      new CustomEvent<SplitJoinedDetail>("split-joined-confirm", {
        detail: {
          partIds: this.#chosen(),
          seats: this.#asksSeats() ? seatsFrom(this.seats) : null,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  #cancel(): void {
    if (!this.isConnected || !this.active || this.busy) return;
    void this.shadowRoot!.querySelector<WtDialog>("wt-dialog")!.requestClose("cancel");
  }

  #closed(event: Event): void {
    event.stopPropagation();
    if (event.target !== event.currentTarget || !this.isConnected || !this.active) return;
    this.active = false;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.dispatchEvent(new CustomEvent("split-joined-cancel", { bubbles: true, composed: true }));
  }

  override render() {
    const partsError = this.#partsError();
    const seatsError = this.#seatsError();
    const refusal = this.#shownRefusal();
    const refusalText = refusal === null ? "" : codeMessage(refusal.code);
    const partsMessage = partsError || (refusal?.field === "partIds" ? refusalText : "");
    const seatsMessage = seatsError || (refusal?.field === "seats" ? refusalText : "");
    const invalid = partsError !== "" || seatsError !== "";
    const footError =
      invalid || partsMessage !== "" || seatsMessage !== "" ? t("form.fix_fields") : refusalText;
    const actionState = saveActionState(this.#scope);
    const left = this.#left();
    const guestsMove = splitsGroup(this.joined)
      ? this.guestsMoveTo(this.#chosen())
      : this.joined.party !== null && left.length === 1
        ? [shownName(left[0]!)]
        : [];
    const heading = (key: "floor.split_title" | "floor.seats_title") =>
      t(key).replace("{table}", () => this.name);
    return html`<wt-dialog
      ${trackDialog()}
      .open=${this.active}
      .beforeClose=${this.#leave ? this.#beforeClose : () => Promise.resolve(!this.busy)}
      .heading=${heading("floor.split_title")}
      @wt-close=${(event: Event) => this.#closed(event)}
    >
      <div class="fields">
        <wt-combobox
          name="split-off"
          required
          multiple
          search="never"
          label=${t("floor.split_parts")}
          .options=${this.parts.map((part) => {
            const seats = part.today?.seats ?? null;
            return seats === null
              ? { value: part.id, label: shownName(part) }
              : {
                  value: part.id,
                  label: shownName(part),
                  description: countText(seats, "floor.seats", "floor.seats_one"),
                };
          })}
          .countLabel=${(count: number) => t("floor.split_count").replace("{count}", String(count))}
          .values=${this.#chosen()}
          .disabled=${this.busy}
          .error=${partsMessage}
          @wt-change=${(event: CustomEvent<{ values: string[] }>) => this.#onChoose(event)}
        ></wt-combobox>
        ${
          this.#asksSeats()
            ? html`<wt-number-stepper
                name="seats"
                required
                .min=${1}
                .max=${SEATS_MAX}
                .label=${splitsGroup(this.joined) ? t("floor.seats_staying") : heading("floor.seats_title")}
                .decreaseLabel=${(label: string) => t("action.decrease").replace("{label}", label)}
                .increaseLabel=${(label: string) => t("action.increase").replace("{label}", label)}
                .value=${live(this.seats)}
                .disabled=${this.busy}
                .error=${seatsMessage}
                @wt-change=${(event: CustomEvent<{ value: string }>) => this.#onSeats(event)}
              ></wt-number-stepper>`
            : nothing
        }
        ${
          this.joined.nextReservation === null
            ? nothing
            : html`<p data-reserved>${t("floor.reserved")} ${this.joined.nextReservation.time}</p>`
        }
        ${guestsMove.map(
          (to) =>
            html`<p data-guests-move>
              ${t("floor.split_guests_move").replace("{table}", () => to)}
            </p>`,
        )}
        <wt-form-actions .error=${footError}>
          <wt-button
            slot="cancel"
            data-split-cancel
            variant="secondary"
            ?disabled=${this.busy}
            @click=${() => this.#cancel()}
          >
            ${t("action.cancel")}
          </wt-button>
          <wt-button
            data-split-action
            variant=${actionState.variant}
            ?disabled=${this.busy || actionState.unchanged || invalid}
            @click=${() => void this.#confirm()}
          >
            ${t("floor.split")}
          </wt-button>
        </wt-form-actions>
      </div>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-split-joined-dialog": TillSplitJoinedDialog;
  }
}
