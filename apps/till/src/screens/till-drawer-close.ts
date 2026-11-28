import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
import { compareDecimal, decimal, formatMoney, subtractDecimal } from "@waitron/shared";
import {
  baseStyles,
  formMessage,
  formMessageStyles,
  formatDecimalInput,
  parseDecimalInput,
  submitOnEnter,
  type WtDialog,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-amount-block.js";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-foot-button-bar.js";
import "@waitron/ui/src/components/wt-full-screen-panel.js";
import "@waitron/ui/src/components/wt-icon.js";
import "@waitron/ui/src/components/wt-price-input.js";
import "@waitron/ui/src/components/wt-top-bar.js";
import type { TillApi } from "../api/client.js";
import type { DrawerCloseRead, FinishedDrawerClose, SavedDrawerCount } from "../api/drawer-api.js";
import { currentLocale, named, t } from "../i18n/t.js";
import { startFirstRead, type FirstReadView } from "../state/first-read.js";
import { firstReadNotice, firstReadNoticeStyles } from "../widgets/first-read-notice.js";
import "../widgets/numeric-pad.js";
import { trackDialog } from "../widgets/track-dialog.js";

type DrawerCloseApi = Pick<
  TillApi,
  "readDrawerClose" | "openDrawer" | "saveDrawerCount" | "recountDrawer" | "finishDrawerClose"
>;

function cashAmount(input: string) {
  const parsed = parseDecimalInput(input);
  if (parsed === null || !/^\d{1,12}(\.\d{1,2})?$/.test(parsed)) return null;
  const [whole, cents = ""] = parsed.split(".");
  return decimal(`${whole!.replace(/^0+(?=\d)/, "")}.${cents.padEnd(2, "0")}`);
}

function money(value: string) {
  return formatMoney(value, currentLocale());
}

function describeDifference(value: string) {
  const short = value.startsWith("-");
  const label =
    value === "0.00" ? "drawer_close.even" : short ? "drawer_close.short" : "drawer_close.over";
  return {
    short,
    label: t(label),
    amount: value === "0.00" ? "" : money(short ? value.slice(1) : value),
  };
}

@customElement("till-drawer-close")
export class TillDrawerClose extends LitElement {
  static override styles = [
    baseStyles,
    firstReadNoticeStyles,
    formMessageStyles,
    css`
      wt-full-screen-panel::part(body) {
        display: grid;
      }

      .content {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-3);
        min-block-size: 100%;
        max-inline-size: var(--wt-till-chooser-dialog-width);
        margin-inline: auto;
        padding: var(--wt-space-4);
      }

      p,
      dl,
      dd,
      h2 {
        margin: 0;
      }

      wt-card {
        --wt-radius-lg: calc(var(--wt-radius-md) + var(--wt-space-1));
      }

      .figures {
        margin: calc(-1 * var(--wt-space-4));
      }

      .figures > div {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--wt-space-2);
        padding: var(--wt-space-3) calc(var(--wt-space-3) + var(--wt-space-1) / 2);
        font-size: var(--wt-text-control-font-size);
      }

      .figures > div + div {
        border-block-start: var(--wt-field-line-width) solid var(--wt-color-border);
      }

      dd {
        text-align: end;
        font-weight: var(--wt-font-weight-bold);
        font-size: var(--wt-font-size-lg);
        font-variant-numeric: tabular-nums;
      }

      .short,
      .amount-error {
        color: var(--wt-color-danger);
      }

      dt small,
      .blind-note,
      .left-hint {
        display: block;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-md);
      }

      dt small {
        font-size: calc(var(--wt-font-size-sm) + var(--wt-space-1) / 4);
      }

      wt-amount-block::part(amount) {
        font-size: calc(var(--wt-font-size-payment-amount) + var(--wt-space-1) / 2);
      }

      .left-hint {
        margin-block-start: calc(var(--wt-space-1) + var(--wt-space-1) / 2);
      }

      .note {
        padding: calc(var(--wt-space-2) + var(--wt-space-1) / 2)
          calc(var(--wt-space-3) + var(--wt-space-1) / 2);
        border-radius: calc(var(--wt-radius-md) + var(--wt-space-1) / 2);
        background: var(--wt-color-surface-lifted);
        font-size: var(--wt-font-size-md);
      }

      till-numeric-pad {
        --wt-action-weight: var(--wt-font-weight-normal);
        --wt-till-keypad-row-height: calc(var(--wt-tap-min) + var(--wt-space-1) / 2);
        --wt-till-keypad-font-size: var(--wt-font-size-lg);
        --wt-till-keypad-gap: calc(var(--wt-space-2) - var(--wt-space-1) / 2);
        margin-block-start: auto;
      }

      [data-drawer-action="recount"] {
        align-self: center;
        margin-block: calc(-1 * var(--wt-space-2));
        --wt-action-text: var(--wt-color-primary-text);
      }

      .closed {
        display: grid;
        justify-items: center;
        gap: var(--wt-space-3);
        text-align: center;
        margin-block: var(--wt-space-3) var(--wt-space-2);
      }

      .closed h2 {
        font-size: calc(var(--wt-font-size-xl) + var(--wt-space-3) / 2);
      }

      .closed-mark {
        display: grid;
        place-items: center;
        inline-size: calc(var(--wt-space-6) * 2);
        block-size: calc(var(--wt-space-6) * 2);
        border-radius: var(--wt-radius-full);
        background: var(--wt-color-success);
        color: var(--wt-color-on-success);
      }

      .closed-mark wt-icon {
        color: inherit;
        inline-size: calc(var(--wt-space-6) + var(--wt-space-1));
        block-size: calc(var(--wt-space-6) + var(--wt-space-1));
      }

      [data-drawer-feedback] {
        max-inline-size: var(--wt-till-chooser-dialog-width);
        margin-inline: auto;
        padding-inline: var(--wt-space-4);
      }

      wt-foot-button-bar > wt-button:not([slot]) {
        inline-size: 100%;
        max-inline-size: calc(var(--wt-till-chooser-dialog-width) - 2 * var(--wt-space-4));
        justify-self: center;
      }
      .first-content-read {
        min-inline-size: min(calc(var(--wt-tap-min) * 6), calc(100dvw - var(--wt-space-6) * 2));
      }
      .first-content-read:has([data-stage="unreachable"]) {
        min-block-size: 0;
      }
      .first-content-read [data-stage="unreachable"] {
        position: static;
      }
    `,
  ];

  @property({ attribute: false }) api!: DrawerCloseApi;
  @property({ attribute: false }) opener: HTMLElement | null = null;
  @property() printerId = "";
  @property() printerName = "";
  @property({ type: Boolean }) opensDrawer = false;
  @property({ type: Boolean }) canClockOut = false;
  @property({ type: Boolean }) clockBusy = false;
  @state() private snapshot: DrawerCloseRead | null = null;
  @state() private finished: FinishedDrawerClose | null = null;
  @state() private busy = true;
  @state() private recounting = false;
  @state() private manual = false;
  @state() private input = "";
  @state() private error = "";
  @state() private switchOperator = false;

  @state() private firstRead: FirstReadView | undefined;
  #firstAttempt?: ReturnType<typeof startFirstRead<DrawerCloseRead>>;
  #clockOutAfterClose = false;
  #focusAmountLeft = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  override disconnectedCallback(): void {
    this.#firstAttempt?.cancel();
    this.#firstAttempt = undefined;
    super.disconnectedCallback();
  }

  override updated(changed: PropertyValues): void {
    if (changed.has("snapshot") || changed.has("recounting") || changed.has("finished")) {
      const amount = this.#focusAmountLeft ? this.renderRoot.querySelector("wt-price-input") : null;
      this.#focusAmountLeft = false;
      if (amount) {
        void amount.updateComplete.then(() => {
          if (amount.isConnected) amount.focus({ preventScroll: true });
        });
      } else {
        this.renderRoot
          .querySelector<HTMLElement>("[data-stage-focus]")
          ?.focus({ preventScroll: true });
      }
    }
  }

  async #load(previous?: SavedDrawerCount): Promise<void> {
    const attempt =
      previous === undefined
        ? startFirstRead(
            (signal) => this.api.readDrawerClose({ signal }),
            (stage) => (this.firstRead = stage),
          )
        : undefined;
    if (attempt !== undefined) {
      this.#firstAttempt?.cancel();
      this.#firstAttempt = attempt;
      this.firstRead = "quiet";
      this.busy = true;
    }
    const current = () =>
      this.isConnected && (attempt === undefined || attempt === this.#firstAttempt);
    try {
      const snapshot = await (attempt?.result ?? this.api.readDrawerClose());
      if (!current()) return;
      this.firstRead = undefined;
      if (
        snapshot.printerId !== this.printerId ||
        (previous && (snapshot.state !== "counted" || snapshot.first.id !== previous.first.id))
      ) {
        this.snapshot = null;
        this.error = t("drawer_close.reopen");
        return;
      }
      if (snapshot.state === "new") {
        this.manual = !this.opensDrawer;
        if (this.opensDrawer) {
          try {
            await this.api.openDrawer();
          } catch {
            this.manual = true;
          }
        }
        if (current()) this.snapshot = snapshot;
      } else {
        this.#showCount(snapshot);
      }
    } catch (error) {
      if (!current()) return;
      if (this.#permissionRefused(error)) {
        this.firstRead = undefined;
      } else if (attempt !== undefined) {
        this.firstRead = "unreachable";
      } else {
        this.snapshot = null;
        this.error = t("drawer_close.read_failed");
      }
    } finally {
      if (current()) {
        this.#firstAttempt = undefined;
        this.busy = false;
      }
    }
  }

  #permissionRefused(error: unknown): boolean {
    if ((error as { code?: string } | null)?.code !== "authorization.not_permitted") return false;
    this.snapshot = null;
    this.switchOperator = true;
    this.error = t("drawer_close.permission");
    return true;
  }

  #showCount(snapshot: SavedDrawerCount, fromKeyboard = false): void {
    this.snapshot = snapshot;
    this.input = snapshot.openingCash;
    this.recounting = false;
    this.#focusAmountLeft = fromKeyboard;
  }

  #amountError(): string {
    if (this.input === "") return "";
    const amount = cashAmount(this.input);
    if (amount === null) return t("drawer_close.amount");
    return this.snapshot?.state === "counted" &&
      !this.recounting &&
      compareDecimal(amount, decimal(this.snapshot.available)) > 0
      ? t("drawer_close.too_much")
      : "";
  }

  async #save(fromKeyboard = false): Promise<void> {
    const snapshot = this.snapshot;
    const amount = cashAmount(this.input);
    if (
      this.busy ||
      snapshot === null ||
      this.finished !== null ||
      amount === null ||
      this.#amountError()
    )
      return;
    this.busy = true;
    this.error = "";
    try {
      if (snapshot.state === "new") {
        this.#showCount(
          await this.api.saveDrawerCount({
            printerId: snapshot.printerId,
            startSequence: snapshot.startSequence,
            counted: amount,
          }),
          fromKeyboard,
        );
      } else if (this.recounting) {
        this.#showCount(
          await this.api.recountDrawer(snapshot.first.id, {
            counted: amount,
            startSequence: snapshot.confirmSequence,
          }),
          fromKeyboard,
        );
      } else {
        this.finished = await this.api.finishDrawerClose(snapshot.first.id, {
          amountLeft: amount,
          confirmSequence: snapshot.confirmSequence,
        });
      }
    } catch (error) {
      if (this.#permissionRefused(error)) return;
      const code = (error as { code?: string } | null)?.code;
      if (
        snapshot.state === "counted" &&
        (code === "drawer.close_changed" ||
          code === "drawer.recount_unavailable" ||
          code === "drawer.close_not_found")
      ) {
        this.error = t("drawer_close.changed");
        await this.#load(snapshot);
      } else if (code === "drawer.close_changed" || code === "drawer.no_printer") {
        this.snapshot = null;
        this.error = t("drawer_close.reopen");
      } else {
        this.error = t("drawer_close.failed");
      }
    } finally {
      this.busy = false;
    }
  }

  #startRecount(): void {
    this.recounting = true;
    this.input = "";
    this.error = "";
  }

  #changeAmount(value: string): void {
    if (this.busy) return;
    this.input = value;
    this.error = "";
  }

  #field(error: string, hint: string) {
    return html`<wt-price-input
      name="amountLeft"
      fixed-unit
      .label=${t("drawer_close.left")}
      .hint=${hint}
      .value=${live(this.input)}
      .locale=${currentLocale()}
      .error=${error}
      .required=${true}
      .disabled=${this.busy}
      @wt-change=${(event: CustomEvent<{ value: string }>) => this.#changeAmount(event.detail.value)}
    ></wt-price-input>`;
  }

  #countScreen(amount: ReturnType<typeof cashAmount>, error: string) {
    return html`
      <p class="note">${t(this.manual ? "drawer_close.use_key" : "drawer_close.key_if_needed")}</p>
      <div
        data-stage-focus
        tabindex="-1"
        role="group"
        aria-labelledby="count-label"
        aria-describedby=${error ? "count-note count-error" : "count-note"}
        aria-invalid=${error ? "true" : nothing}
      >
        <wt-amount-block>
          <span id="count-label" slot="label">${t("drawer_close.count_all")}</span>
          ${amount !== null || this.input === "" ? money(amount ?? "0.00") : formatDecimalInput(this.input, currentLocale())}
          <span id="count-note" class="blind-note" slot="breakdown"
            >${t("drawer_close.blind_note")}</span
          >
          ${error ? html`<span id="count-error" class="amount-error" slot="breakdown">${error}</span>` : nothing}
        </wt-amount-block>
      </div>
      <till-numeric-pad
        ascending
        .value=${this.input}
        .disabled=${this.busy}
        @wt-change=${(event: CustomEvent<{ value: string }>) => this.#changeAmount(event.detail.value)}
        @pad-enter=${() => void this.#save(true)}
      ></till-numeric-pad>
    `;
  }

  #figure(label: string, amount: string) {
    return html`<div>
      <dt>${label}</dt>
      <dd>${money(amount)}</dd>
    </div>`;
  }

  #difference(value: string, recountHint = false) {
    const { short, label, amount } = describeDifference(value);
    return html`<div class=${short ? "short" : nothing}>
      <dt>
        ${label}${short && recountHint ? html`<small>${t("drawer_close.recount_hint")}</small>` : nothing}
      </dt>
      <dd>${amount}</dd>
    </div>`;
  }

  #review(
    saved: SavedDrawerCount,
    amount: ReturnType<typeof cashAmount>,
    error: string,
    stale: boolean,
  ) {
    const count = saved.recount ?? saved.first;
    const canRecount = stale || (saved.recount === null && saved.first.difference !== "0.00");
    const leftHint =
      amount === saved.openingCash && saved.openingCash !== "0.00"
        ? t("drawer_close.same_as_last")
        : "";
    let description = leftHint;
    if (this.#focusAmountLeft) {
      const difference = describeDifference(count.difference);
      const result = [difference.label, difference.amount].filter(Boolean).join(" ");
      description =
        `${t("drawer_close.you_counted")} ${money(count.counted)}. ${t("drawer_close.expected")} ${money(count.expected)}. ${result}. ${leftHint}`.trim();
    }
    return html`
      <wt-card data-stage-focus tabindex="-1">
        <dl class="figures">
          ${this.#figure(t("drawer_close.you_counted"), count.counted)}
          ${this.#figure(t("drawer_close.expected"), count.expected)}
          ${this.#difference(count.difference, canRecount && !stale)}
        </dl>
      </wt-card>
      ${count.cashMovedWhileCounting ? html`<p role="status">${t("drawer_close.cash_moved")}</p>` : nothing}
      ${
        canRecount
          ? html`<wt-button
              data-drawer-action="recount"
              variant="ghost"
              .disabled=${this.busy}
              @click=${this.#startRecount}
              >${t("drawer_close.recount")}</wt-button
            >`
          : nothing
      }
      ${
        stale
          ? html`<p role="status">${t("drawer_close.stale_recount")}</p>`
          : html`
              <div
                @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.renderRoot.querySelector('[data-drawer-action="finish"]'))}
              >
                ${this.#field(error, description)}
                ${leftHint ? html`<p class="left-hint" aria-hidden="true">${leftHint}</p>` : nothing}
              </div>
              ${
                amount !== null && !error
                  ? html`<wt-card>
                      <dl class="figures">
                        ${this.#figure(t("drawer_close.bank"), subtractDecimal(decimal(saved.available), amount))}
                      </dl>
                    </wt-card>`
                  : nothing
              }
            `
      }
    `;
  }

  #summary(saved: SavedDrawerCount, finished: FinishedDrawerClose) {
    const slip =
      finished.slip === "queued"
        ? named(
            this.printerName,
            t("drawer_close.slip_queued_named"),
            t("drawer_close.slip_queued"),
          )
        : t(
            finished.slip === "already_closed"
              ? "drawer_close.slip_already_closed"
              : "drawer_close.slip_unavailable",
          );
    return html`
      <div class="closed">
        <span class="closed-mark" aria-hidden="true"><wt-icon name="check"></wt-icon></span>
        <h2 data-stage-focus tabindex="-1">${t("drawer_close.saved")}</h2>
      </div>
      <wt-card>
        <dl class="figures">
          ${this.#figure(t("drawer_close.counted"), (saved.recount ?? saved.first).counted)}
          ${this.#difference(finished.difference)}
          ${this.#figure(t("drawer_close.left_saved"), finished.amountLeft)}
          ${this.#figure(t("drawer_close.bank"), finished.bankWithdrawal)}
        </dl>
      </wt-card>
      <p class="note">${slip}</p>
    `;
  }

  #loading() {
    const stage = this.firstRead;
    return stage === undefined
      ? nothing
      : html`<div class="first-content-read">
          ${stage === "placeholder" || stage === "waiting" ? html`<wt-placeholder></wt-placeholder><wt-placeholder></wt-placeholder>` : nothing}
          ${firstReadNotice(stage, false, () => {
            if (this.firstRead === "unreachable") void this.#load();
          })}
        </div>`;
  }

  async #close(clockOut = false): Promise<void> {
    const dialog = this.renderRoot.querySelector<WtDialog>("wt-dialog");
    if (!dialog?.open) return;
    this.#clockOutAfterClose = clockOut;
    if (!(await dialog.requestClose("navigation"))) this.#clockOutAfterClose = false;
  }

  override render() {
    const { snapshot, finished, recounting, busy } = this;
    const canLeave = !busy || this.firstRead === "unreachable";
    const saved = snapshot?.state === "counted" ? snapshot : null;
    const counting = snapshot?.state === "new" || recounting;
    const amount = cashAmount(this.input);
    const error = this.#amountError();
    const stale =
      saved !== null && !counting && compareDecimal(decimal(saved.available), decimal("0.00")) < 0;
    const editing = snapshot !== null && finished === null && !stale;
    const canSave = editing && amount !== null && !error && !busy;
    const title = t(finished ? "drawer_close.saved" : "drawer_close.heading");
    const name = this.printerName
      ? t("drawer_entry.printer").replace("{printer}", () => this.printerName)
      : "";
    const step =
      snapshot === null || finished
        ? ""
        : t(counting ? "drawer_close.step_one" : "drawer_close.step_two");
    const label = counting
      ? "drawer_close.save_count"
      : this.opensDrawer
        ? "drawer_close.finish_print"
        : "drawer_close.finish";
    return html`
      <wt-dialog
        ${trackDialog()}
        full-screen
        aria-label=${title}
        .open=${true}
        .opener=${this.opener}
        .dismissible=${canLeave}
        @wt-close=${(event: Event) => {
          event.stopPropagation();
          this.dispatchEvent(new CustomEvent("drawer-close-dismiss"));
          if (this.#clockOutAfterClose) {
            this.dispatchEvent(
              new CustomEvent("clock-action", {
                bubbles: true,
                composed: true,
                detail: { action: "out" },
              }),
            );
          }
        }}
      >
        <wt-full-screen-panel .bodyLabel=${title}>
          <wt-top-bar
            slot="header"
            .heading=${title}
            .subtitle=${finished ? "" : [name, step].filter(Boolean).join(" · ")}
            .backLabel=${t("tab.floor")}
            .backDisabled=${!canLeave}
            @wt-back=${() => void this.#close()}
          ></wt-top-bar>
          <div class="content">
            ${
              saved && finished
                ? this.#summary(saved, finished)
                : counting
                  ? this.#countScreen(amount, error)
                  : saved
                    ? this.#review(saved, amount, error, stale)
                    : this.#loading()
            }
          </div>
          <div slot="footer">
            <div data-drawer-feedback>
              ${formMessage(stale ? "" : error ? t("drawer_close.check_amount") : this.error)}
            </div>
            ${
              editing || finished || this.switchOperator
                ? html`<wt-foot-button-bar>
                    ${
                      this.switchOperator
                        ? html`<wt-button
                            data-drawer-action="sign-in"
                            variant="primary"
                            @click=${() => this.dispatchEvent(new CustomEvent("logout", { bubbles: true, composed: true }))}
                            >${t("action.logout")}</wt-button
                          >`
                        : nothing
                    }
                    ${
                      editing
                        ? html`<wt-button
                            data-drawer-action=${counting ? "count" : "finish"}
                            variant=${canSave || busy ? "primary" : "secondary"}
                            .disabled=${!canSave}
                            .loading=${busy}
                            @click=${() => void this.#save()}
                            >${t(label)}</wt-button
                          >`
                        : nothing
                    }
                    ${
                      finished && this.canClockOut
                        ? html`<wt-button
                            data-drawer-action="clock-out"
                            variant="primary"
                            .disabled=${this.clockBusy}
                            @click=${() => void this.#close(true)}
                            >${t("clock.out")}</wt-button
                          >`
                        : nothing
                    }
                    ${
                      finished
                        ? html`<wt-button
                            slot="link"
                            data-drawer-action="back"
                            variant="ghost"
                            @click=${() => void this.#close()}
                            >${t("drawer_close.back_to_floor")}</wt-button
                          >`
                        : nothing
                    }
                  </wt-foot-button-bar>`
                : nothing
            }
          </div>
        </wt-full-screen-panel>
      </wt-dialog>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-drawer-close": TillDrawerClose;
  }
}
