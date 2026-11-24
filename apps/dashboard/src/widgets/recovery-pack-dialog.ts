import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
  type MasterKeyUsedDetail,
  type WtDialog,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import "@waitron/ui/src/components/wt-master-key-box.js";
import type { DashboardApi, RecoveryPackKeyState, RecoveryPackStatus } from "../api/client.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import { codeMessage, codeOf } from "../i18n/codes.js";
import {
  keepDate,
  keyHolder,
  packDate,
  unreceivedWords,
  withStrong,
} from "./recovery-pack-words.js";

/** A plain pack, or a new master key (with a new box key when the box has one) and its pack. */
export type RecoveryPackDialogKind = "pack" | "master-key";

/** The detail of `recovery-pack-made`: the pack's PDF, and whether the box has it marked received. */
export interface RecoveryPackMade {
  pdf: Blob;
  number: number;
  key: RecoveryPackKeyState;
  madeAt: string;
  received: boolean;
}

/** A refusal envelope carries the status the box answered with; a lost answer has none. */
function answeredByBox(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { status?: unknown }).status === "number"
  );
}

type Step = "form" | "lost" | "key-failed" | "shown";
/** A shown master key whose pack was not yet downloaded or printed is lost when the dialog closes. */
type Draft = { unkept: boolean };

/**
 * Makes a recovery pack, or a new master key, after a fresh sign-in. Fires `recovery-pack-closed`
 * on closing only when it sent a make, which may have changed the status.
 */
@customElement("dashboard-recovery-pack-dialog")
export class RecoveryPackDialog extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: contents;
      }
      p {
        margin: 0 0 var(--wt-space-3);
      }
      .warning {
        margin: var(--wt-space-3) 0;
        padding: var(--wt-space-3) var(--wt-space-4);
        border-inline-start: var(--wt-space-1) solid var(--wt-color-warning);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-surface);
      }
    `,
  ];

  @property({ attribute: false }) api!: Pick<
    DashboardApi,
    "makeRecoveryPack" | "markRecoveryPackReceived" | "getRecoveryPackStatus"
  >;

  @state() private opened = false;
  @state() private status: RecoveryPackStatus | null = null;
  @state() private kind: RecoveryPackDialogKind = "pack";
  @state() private busy = false;
  @state() private step: Step = "form";
  /** A refusal's sentence that names no field, kept until the next press. */
  @state() private refusal = "";
  /** The status read again after a lost answer or an unreplaced key; null when unreadable. */
  @state() private reread: RecoveryPackStatus | null = null;
  @state() private lostMasterKey = false;
  @state() private shown: { key: string; name: string; url: string; number: number } | null = null;
  @state() private used = false;

  #generation = 0;
  #sent = false;
  #scope?: DraftScope<Draft>;
  #leave?: LeaveCoordinator;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  /**
   * Opens the dialog; `status` is the card's latest answer, which names the pack holding the key.
   * A new master key needs one: its keep date is that answer's.
   */
  show(status: RecoveryPackStatus, kind?: RecoveryPackDialogKind): void;
  show(status: RecoveryPackStatus | null, kind?: "pack"): void;
  show(status: RecoveryPackStatus | null, kind: RecoveryPackDialogKind = "pack"): void {
    if (this.opened) return;
    this.#generation++;
    this.opened = true;
    this.#sent = false;
    this.status = status;
    this.kind = kind;
    this.busy = false;
    this.step = "form";
    this.refusal = "";
    this.reread = null;
    const { coordinator, scope } = draftScopeFor<Draft>(this, {
      id: {},
      current: () => this.#draft(),
      snapshot: (value) => ({ ...value }),
      equal: (a, b) => a.unkept === b.unkept,
      restore: () => {
        this.refusal = "";
      },
    });
    this.#leave = coordinator;
    this.#scope = scope;
    scope.commit({ unkept: false });
  }

  /** Closes without asking, forgetting everything typed. */
  dismiss(): void {
    if (this.opened) this.#close();
  }

  get isOpen(): boolean {
    return this.opened;
  }

  /** Handed another api, it closes without a word: a make still out belongs to the old one. */
  override willUpdate(changes: PropertyValues<this>): void {
    if (changes.has("api") && changes.get("api") !== undefined && this.opened) this.#close(false);
  }

  override disconnectedCallback(): void {
    this.#close();
    super.disconnectedCallback();
  }

  /** The venue's zone, which the pack's pages are dated in; the browser's until a status names it. */
  get #zone(): string | undefined {
    return (this.reread ?? this.status)?.timeZone;
  }

  /** The box saves a new master key before it answers, so the answer must reach the person. */
  get #making(): boolean {
    return this.busy && this.kind === "master-key";
  }

  #draft(): Draft {
    return { unkept: this.step === "shown" && !this.used };
  }

  #close(announce = true): void {
    const wasOpen = this.opened;
    this.#generation++;
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    this.opened = false;
    this.busy = false;
    this.step = "form";
    this.refusal = "";
    this.reread = null;
    this.#forgetShown();
    if (announce && wasOpen && this.#sent && this.isConnected)
      this.dispatchEvent(
        new CustomEvent("recovery-pack-closed", { bubbles: true, composed: true }),
      );
  }

  /** The shown key and the link to its pack go when the dialog closes: nothing else holds them. */
  #forgetShown(): void {
    if (this.shown) URL.revokeObjectURL(this.shown.url);
    this.shown = null;
    this.used = false;
  }

  #dialog(): WtDialog | null {
    return this.renderRoot.querySelector<WtDialog>("wt-dialog");
  }

  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.#leave ||
    !this.#scope ||
    (await this.#leave.request({ scopes: [this.#scope.id], reason, proceed() {} })) === "proceeded";

  async #make(): Promise<void> {
    if (!this.opened || this.busy) return;
    const generation = this.#generation;
    const newServerKey = this.kind === "master-key";
    const api = this.api;
    this.refusal = "";
    this.busy = true;
    let made;
    this.#sent = true;
    try {
      made = await api.makeRecoveryPack({
        locale: currentLocale().startsWith("es") ? "es" : "en",
        newServerKey,
      });
    } catch (error) {
      if (generation !== this.#generation) return;
      if (answeredByBox(error)) {
        this.busy = false;
        this.refusal = codeMessage(codeOf(error, "server.internal"));
        return;
      }
      this.reread = await this.#readStatus(api, generation);
      if (generation !== this.#generation) return;
      this.lostMasterKey = newServerKey;
      this.step = "lost";
      this.busy = false;
      return;
    }
    if (generation !== this.#generation) return;
    const received = await this.#markReceived(api, made.number);
    // Sent even if the dialog closed meanwhile, for a card still showing; a card that has gone or
    // lost system.manage drops it, though the box already counts it received. Never sent to a card
    // that has since moved to another api.
    if (api !== this.api) return;
    this.dispatchEvent(
      new CustomEvent<RecoveryPackMade>("recovery-pack-made", {
        detail: {
          pdf: made.pdf,
          number: made.number,
          key: made.key,
          madeAt: made.madeAt,
          received,
        },
        bubbles: true,
        composed: true,
      }),
    );
    if (generation !== this.#generation) return;
    if (made.key === "failed" && newServerKey) {
      this.reread = await this.#readStatus(api, generation);
      if (generation !== this.#generation) return;
      this.step = "key-failed";
      this.busy = false;
      return;
    }
    if (newServerKey && made.masterKey) {
      this.shown = {
        key: made.masterKey.key,
        name: made.masterKey.name,
        url: URL.createObjectURL(made.pdf),
        number: made.number,
      };
      this.step = "shown";
      this.busy = false;
      this.#scope?.changed();
      return;
    }
    this.#dialog()?.closeAfter("security");
    this.#close();
  }

  async #markReceived(api: this["api"], number: number): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await api.markRecoveryPackReceived(number);
        return true;
      } catch {
        // A second failure is left for the card, which names the pack as never received.
      }
    }
    return false;
  }

  /** Hands the card the status only while this dialog session is still open: the card re-reads on close. */
  async #readStatus(api: this["api"], generation: number): Promise<RecoveryPackStatus | null> {
    let status: RecoveryPackStatus;
    try {
      status = await api.getRecoveryPackStatus();
    } catch {
      return null;
    }
    if (api !== this.api || generation !== this.#generation) return null;
    this.dispatchEvent(
      new CustomEvent<RecoveryPackStatus>("recovery-pack-status", {
        detail: status,
        bubbles: true,
        composed: true,
      }),
    );
    return status;
  }

  #remake(): void {
    this.step = "form";
    this.refusal = "";
  }

  /** Copy does not count: the pack can hold more than the key, such as a new box key. */
  #keyUsed(event: CustomEvent<MasterKeyUsedDetail>): void {
    if (event.detail.action === "copy") return;
    this.used = true;
    this.#scope?.changed();
  }

  #retry(): void {
    this.step = "form";
    void this.#make();
  }

  override render(): TemplateResult {
    const open = this.opened;
    return html`<wt-dialog
      data-test="recovery-pack-dialog"
      heading=${t(
        this.step === "shown"
          ? "master_key_shown.heading"
          : this.kind === "master-key"
            ? "master_key_dialog.heading"
            : "recovery_pack_dialog.heading",
      )}
      .open=${open}
      .dismissible=${!this.#making}
      .beforeClose=${this.#beforeClose}
      @wt-close=${(event: Event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) this.#close();
      }}
    >
      ${open ? this.#body() : nothing} ${open ? this.#footer() : nothing}
    </wt-dialog>`;
  }

  #body(): TemplateResult {
    return html`<div ?hidden=${this.step !== "form"}>
        ${
          this.kind === "master-key"
            ? html`<p data-test="intro">
                ${fill("master_key_dialog.text", {
                  date: keepDate(this.status!.keepOldPackUntil, this.#zone),
                })}
              </p>`
            : html`<p data-test="intro">${t("recovery_pack_dialog.intro")}</p>`
        }
      </div>
      ${this.step === "lost" ? this.#lost() : nothing}
      ${this.step === "key-failed" ? this.#keyFailed() : nothing}
      ${this.step === "shown" && this.shown ? this.#shown(this.shown) : nothing}`;
  }

  #shown(shown: { key: string; name: string; url: string; number: number }): TemplateResult {
    return html`<p data-test="shown-lead">${t("master_key_shown.lead")}</p>
      <p class="warning" data-test="shown-warning">${t("master_key_shown.warning")}</p>
      <wt-master-key-box
        data-test="master-key-box"
        .masterKey=${shown.key}
        .keyName=${shown.name}
        .pdfUrl=${shown.url}
        fileName=${`waitron-recovery-pack-${shown.number}.pdf`}
        .copy=${{
          name: (name: string) => fill("master_key_shown.key_name", { name }),
          download: t("master_key_shown.download"),
          print: t("master_key_shown.print"),
          copy: t("master_key_shown.copy"),
          copied: t("master_key_shown.copied"),
          copyFailed: t("master_key_shown.copy_failed"),
          printFailed: t("master_key_shown.print_failed"),
        }}
        @wt-master-key-used=${(event: CustomEvent<MasterKeyUsedDetail>) => this.#keyUsed(event)}
      ></wt-master-key-box>`;
  }

  #lost(): TemplateResult {
    if (!this.lostMasterKey)
      return html`<div data-test="lost" role="alert">
        <p>${t("recovery_pack_dialog.lost")}</p>
        <p>${t("recovery_pack_dialog.lost_choices")}</p>
      </div>`;
    const unreceived = this.reread?.unreceived;
    return html`<div data-test="lost" role="alert">
      <p>
        ${t("recovery_pack_dialog.lost_new_key")}
        ${
          unreceived?.holdsCurrentServerKey
            ? fill("recovery_pack_dialog.lost_new_key_named", {
                number: String(unreceived.number),
                date: packDate(unreceived.madeAt, this.#zone),
              })
            : nothing
        }
      </p>
      <p>${t("recovery_pack_dialog.lost_new_key_choices")}</p>
    </div>`;
  }

  #keyFailed(): TemplateResult {
    const holder = keyHolder(this.reread);
    const where =
      holder === null
        ? nothing
        : holder.received || holder.offeredAtSetup
          ? fill("recovery_pack_dialog.key_still_works", {
              number: String(holder.number),
              date: packDate(holder.madeAt, this.#zone),
            })
          : unreceivedWords(holder, this.#zone);
    return html`<p data-test="key-failed" role="alert">
      ${withStrong("recovery_pack_dialog.key_failed", {}, "not", t("recovery_pack_dialog.not"))}
      ${where}
    </p>`;
  }

  #footer(): TemplateResult {
    const leave = () =>
      void this.#dialog()?.requestClose(this.step === "form" ? "cancel" : "navigation");
    const master = this.kind === "master-key";
    if (this.step === "shown")
      return this.used
        ? html`<wt-form-actions slot="footer">
            <wt-button
              data-test="key-continue"
              variant="primary"
              @click=${() => {
                this.#dialog()?.closeAfter("saved");
                this.#close();
              }}
              >${t("master_key_shown.continue")}</wt-button
            >
          </wt-form-actions>`
        : html``;
    if (this.step === "key-failed")
      return html`<wt-form-actions slot="footer">
        <wt-button data-test="close-pack" variant="primary" @click=${leave}
          >${t("action.close")}</wt-button
        >
      </wt-form-actions>`;
    if (this.step === "lost")
      return html`<wt-form-actions slot="footer">
        <wt-button slot="cancel" data-test="stop-pack" variant="secondary" @click=${leave}
          >${t(this.lostMasterKey ? "master_key_dialog.stop" : "recovery_pack_dialog.stop")}</wt-button
        >
        ${
          this.lostMasterKey
            ? html`<wt-button
                data-test="remake-pack"
                variant="danger"
                @click=${() => this.#remake()}
                >${t("master_key_dialog.make")}</wt-button
              >`
            : html`<wt-button data-test="retry-pack" variant="primary" @click=${() => this.#retry()}
                >${t("recovery_pack_dialog.try_again")}</wt-button
              >`
        }
      </wt-form-actions>`;
    return html`<wt-form-actions slot="footer" .error=${this.refusal}>
      <wt-button
        slot="cancel"
        data-test="cancel-pack"
        variant="secondary"
        ?disabled=${this.#making}
        @click=${leave}
        >${t(master ? "master_key_dialog.stop" : "action.cancel")}</wt-button
      >
      <wt-button
        data-test="make-pack"
        variant=${master ? "danger" : "primary"}
        ?disabled=${this.busy}
        @click=${() => void this.#make()}
        >${t(master ? "master_key_dialog.make" : "recovery_pack_dialog.make")}</wt-button
      >
    </wt-form-actions>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-recovery-pack-dialog": RecoveryPackDialog;
  }
}
