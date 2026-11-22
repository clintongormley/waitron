import { LitElement, css, html, nothing } from "lit";
import { live } from "lit/directives/live.js";
import { customElement, property, state } from "lit/decorators.js";
import { compareDecimal, decimal, formatMoney, subtractDecimal } from "@waitron/shared";
import { baseStyles, parseDecimalInput, submitOnEnter, type WtDialog } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-input.js";
import type {
  DrawerCloseRead,
  FinishedDrawerClose,
  SavedDrawerCount,
  TillApi,
} from "../api/client.js";
import { currentLocale, t } from "../i18n/t.js";
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

@customElement("till-drawer-close")
export class TillDrawerClose extends LitElement {
  static override styles = [
    baseStyles,
    css`
      p,
      dl {
        margin: 0 0 var(--wt-space-3);
      }
      dl {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: var(--wt-space-2) var(--wt-space-3);
      }
      dd {
        margin: 0;
        text-align: end;
      }
      .bank {
        margin-block-start: var(--wt-space-3);
        font-weight: var(--wt-font-weight-bold);
      }
    `,
  ];

  @property({ attribute: false }) api!: DrawerCloseApi;
  @property({ attribute: false }) opener: HTMLElement | null = null;
  @property() printerId = "";
  @property({ type: Boolean }) opensDrawer = false;
  @state() private snapshot: DrawerCloseRead | null = null;
  @state() private finished: FinishedDrawerClose | null = null;
  @state() private busy = true;
  @state() private recounting = false;
  @state() private manual = false;
  @state() private input = "";
  @state() private error = "";
  @state() private switchOperator = false;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
  }

  async #load(previous?: SavedDrawerCount): Promise<void> {
    try {
      const snapshot = await this.api.readDrawerClose();
      if (!this.isConnected) return;
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
        this.snapshot = snapshot;
      } else {
        this.#showCount(snapshot);
      }
    } catch (error) {
      if (!this.#permissionRefused(error)) {
        this.snapshot = null;
        this.error = t("drawer_close.read_failed");
      }
    } finally {
      this.busy = false;
    }
  }

  #permissionRefused(error: unknown): boolean {
    if ((error as { code?: string } | null)?.code !== "authorization.not_permitted") return false;
    this.snapshot = null;
    this.switchOperator = true;
    this.error = t("drawer_close.permission");
    return true;
  }

  #showCount(snapshot: SavedDrawerCount): void {
    this.snapshot = snapshot;
    this.input = snapshot.openingCash;
    this.recounting = false;
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

  async #save(): Promise<void> {
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
        );
      } else if (this.recounting) {
        this.#showCount(
          await this.api.recountDrawer(snapshot.first.id, {
            counted: amount,
            startSequence: snapshot.confirmSequence,
          }),
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

  #field(counting: boolean, error: string) {
    return html`<wt-input
      name=${counting ? "counted" : "amountLeft"}
      autocomplete="off"
      .label=${t(counting ? "drawer_close.counted" : "drawer_close.left")}
      .value=${live(this.input)}
      .decimalLocale=${currentLocale()}
      .error=${error}
      .required=${true}
      .disabled=${this.busy}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        this.input = event.detail.value;
        this.error = "";
      }}
    ></wt-input>`;
  }

  override render() {
    const { snapshot, finished, recounting, busy } = this;
    const saved = snapshot?.state === "counted" ? snapshot : null;
    const counting = snapshot?.state === "new" || recounting;
    const count = saved?.recount ?? saved?.first;
    const stale = saved !== null && compareDecimal(decimal(saved.available), decimal("0.00")) < 0;
    const needsRecount = stale && !counting;
    const canRecount =
      saved !== null &&
      !recounting &&
      (stale || (saved.recount === null && saved.first.difference !== "0.00"));
    const error = this.#amountError();
    const amount = cashAmount(this.input);
    const bank =
      saved && !counting && !needsRecount && amount && !error
        ? money(subtractDecimal(decimal(saved.available), amount))
        : null;
    const canSave = snapshot !== null && finished === null && amount !== null && !error && !busy;
    return html`<wt-dialog
      ${trackDialog()}
      .open=${true}
      .heading=${t("drawer_close.title")}
      .opener=${this.opener}
      .dismissible=${!busy}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        this.dispatchEvent(new CustomEvent("drawer-close-dismiss"));
      }}
    >
      ${
        finished
          ? html`<p role="status">
              ${t("drawer_close.saved")}.
              ${t(finished.slip === "queued" ? "drawer_close.slip_queued" : "drawer_close.slip_unavailable")}
            </p>`
          : snapshot === null
            ? nothing
            : html`
                ${snapshot.state === "new" ? html`<p>${t(this.manual ? "drawer_close.use_key" : "drawer_close.key_if_needed")}</p>` : nothing}
                ${
                  count && !counting
                    ? html`
                        <dl>
                          <dt>${t("drawer_close.counted")}</dt>
                          <dd>${money(count.counted)}</dd>
                          <dt>${t("drawer_close.expected")}</dt>
                          <dd>${money(count.expected)}</dd>
                          <dt>${t("drawer_close.difference")}</dt>
                          <dd>${money(count.difference)}</dd>
                        </dl>
                        ${count.cashMovedWhileCounting ? html`<p role="status">${t("drawer_close.cash_moved")}</p>` : nothing}
                      `
                    : nothing
                }
                <div
                  @keydown=${(event: KeyboardEvent) => submitOnEnter(event, this.renderRoot.querySelector<HTMLElement>(counting ? '[data-drawer-action="count"]' : '[data-drawer-action="finish"]'))}
                >
                  ${needsRecount ? html`<p role="status">${t("drawer_close.stale_recount")}</p>` : this.#field(counting, error)}
                </div>
                ${bank ? html`<p class="bank">${t("drawer_close.bank")} · ${bank}</p>` : nothing}
              `
      }
      <wt-form-actions
        slot="footer"
        .error=${needsRecount ? "" : error ? t("drawer_close.check_amount") : this.error}
      >
        <wt-button
          slot="cancel"
          data-drawer-action="back"
          variant="secondary"
          .disabled=${busy}
          @click=${() => void this.renderRoot.querySelector<WtDialog>("wt-dialog")?.requestClose("navigation")}
          >${t("action.back")}</wt-button
        >
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
          canRecount && !finished
            ? html`<wt-button
                slot="secondary"
                data-drawer-action="recount"
                variant="secondary"
                .disabled=${busy}
                @click=${this.#startRecount}
                >${t("drawer_close.recount")}</wt-button
              >`
            : nothing
        }
        ${
          snapshot && !finished && !needsRecount
            ? html`<wt-button
                data-drawer-action=${counting ? "count" : "finish"}
                variant=${canSave || busy ? "primary" : "secondary"}
                .disabled=${!canSave}
                .loading=${busy}
                @click=${() => void this.#save()}
                >${t(counting ? "drawer_close.save_count" : "drawer_close.finish")}</wt-button
              >`
            : nothing
        }
      </wt-form-actions>
    </wt-dialog>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-drawer-close": TillDrawerClose;
  }
}
