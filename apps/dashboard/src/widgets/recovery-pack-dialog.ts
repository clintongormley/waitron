import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  baseStyles,
  draftScopeFor,
  focusFirstInvalid,
  type DraftScope,
  type LeaveCoordinator,
  type LeaveReason,
  type WtDialog,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-dialog.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import type {
  DashboardApi,
  FreshSignInBody,
  RecoveryPackKeyState,
  RecoveryPackStatus,
} from "../api/client.js";
import { currentLocale, fill, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import type { FreshSignIn, SignInWays } from "./fresh-sign-in.js";
import "./fresh-sign-in.js";

/** The detail of `recovery-pack-made`: the whole PDF, and whether the box has it marked received. */
export interface RecoveryPackMade {
  pdf: Blob;
  number: number;
  key: RecoveryPackKeyState;
  received: boolean;
}

/**
 * A pack's day as the screen language writes it, in the venue's zone as the pack's own pages are
 * dated: "12 October", "12 de octubre".
 */
export function packDate(iso: string, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat(currentLocale(), {
    day: "numeric",
    month: "long",
    timeZone,
  }).format(new Date(iso));
}

/** The pack the status names as holding the current server key, and whether it reached a browser. */
function keyHolder(
  status: RecoveryPackStatus | null,
): { number: number; madeAt: string; received: boolean } | null {
  const kept = status?.keep.find((pack) => pack.why === "server_key");
  if (kept) return { number: kept.number, madeAt: kept.madeAt, received: true };
  const unreceived = status?.unreceived;
  if (unreceived?.holdsCurrentServerKey)
    return { number: unreceived.number, madeAt: unreceived.madeAt, received: false };
  return null;
}

/** `key`'s words with `{name}` drawn in bold as `strong`, every other placeholder filled. */
function withStrong(
  key: StringKey,
  values: Readonly<Record<string, string>>,
  name: string,
  strong: string,
): TemplateResult {
  const [before, after] = fill(key, values).split(`{${name}}`);
  return html`${before}<strong>${strong}</strong>${after ?? ""}`;
}

/** Decision 10's words for a pack holding the current server key that never reached a browser. */
export function unreceivedWords(
  holder: { number: number; madeAt: string },
  timeZone: string | undefined,
): TemplateResult {
  return withStrong(
    "recovery_pack_dialog.unreceived",
    { number: String(holder.number), date: packDate(holder.madeAt, timeZone) },
    "option",
    t("recovery_pack_dialog.new_key"),
  );
}

/** The last pack had no server-key part: the box has no module that keeps one. */
function noServerKey(status: RecoveryPackStatus | null): boolean {
  return (
    status?.latest?.parts.some((part) => part.part === "server-key" && part.state === "absent") ??
    false
  );
}

/** A refusal envelope carries the status the box answered with; a lost answer has none. */
function answeredByBox(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { status?: unknown }).status === "number"
  );
}

type Step = "form" | "lost" | "key-failed";
type Draft = { typed: boolean; ticked: boolean };

/** Makes a recovery pack after a fresh sign-in. */
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
      .sign-in {
        margin-block-end: var(--wt-space-4);
      }
      .option {
        display: grid;
        grid-template-columns: auto 1fr;
        column-gap: var(--wt-space-3);
        align-items: start;
      }
      .option input {
        width: var(--wt-space-5);
        height: var(--wt-space-5);
        margin: 0;
      }
      .option label {
        font-weight: var(--wt-font-weight-bold);
      }
      .option .why {
        grid-column: 2;
        margin: var(--wt-space-1) 0 0;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
    `,
  ];

  @property({ attribute: false }) api!: Pick<
    DashboardApi,
    | "getProfile"
    | "recoveryPackPasskeyOptions"
    | "makeRecoveryPack"
    | "markRecoveryPackReceived"
    | "getRecoveryPackStatus"
  >;

  @state() private opened = false;
  @state() private status: RecoveryPackStatus | null = null;
  @state() private ticked = false;
  @state() private busy = false;
  @state() private step: Step = "form";
  @state() private ways: SignInWays | null = null;
  /** A refusal's sentence that names no field, kept until the next press. */
  @state() private refusal = "";
  /** The status read again after a lost answer or an unreplaced key; null when unreadable. */
  @state() private reread: RecoveryPackStatus | null = null;
  @state() private lostTicked = false;

  #generation = 0;
  #method: "password" | "passkey" | undefined;
  #scope?: DraftScope<Draft>;
  #leave?: LeaveCoordinator;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  /** Opens the dialog; `status` is the card's latest answer, which names the pack holding the key. */
  show(status: RecoveryPackStatus | null): void {
    if (this.opened) return;
    this.#generation++;
    this.opened = true;
    this.status = status;
    this.ticked = false;
    this.busy = false;
    this.step = "form";
    this.ways = null;
    this.refusal = "";
    this.reread = null;
    const { coordinator, scope } = draftScopeFor<Draft>(this, {
      id: {},
      current: () => this.#draft(),
      snapshot: (value) => ({ ...value }),
      equal: (a, b) => a.typed === b.typed && a.ticked === b.ticked,
      restore: () => {
        this.#signIn()?.clear();
        this.ticked = false;
        this.refusal = "";
      },
    });
    this.#leave = coordinator;
    this.#scope = scope;
    scope.commit({ typed: false, ticked: false });
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

  #draft(): Draft {
    if (this.step !== "form") return { typed: false, ticked: false };
    return { typed: this.#signIn()?.typed ?? false, ticked: this.ticked };
  }

  #close(announce = true): void {
    const wasOpen = this.opened;
    this.#generation++;
    this.#signIn()?.clear();
    this.#scope?.dispose();
    this.#scope = undefined;
    this.#leave = undefined;
    this.opened = false;
    this.busy = false;
    this.step = "form";
    this.ticked = false;
    this.refusal = "";
    this.reread = null;
    this.ways = null;
    if (announce && wasOpen && this.isConnected)
      this.dispatchEvent(
        new CustomEvent("recovery-pack-closed", { bubbles: true, composed: true }),
      );
  }

  #dialog(): WtDialog | null {
    return this.renderRoot.querySelector<WtDialog>("wt-dialog");
  }

  #signIn(): FreshSignIn | null {
    return this.renderRoot.querySelector<FreshSignIn>("dashboard-fresh-sign-in");
  }

  readonly #beforeClose = async (reason: LeaveReason): Promise<boolean> =>
    !this.#leave ||
    !this.#scope ||
    (await this.#leave.request({ scopes: [this.#scope.id], reason, proceed() {} })) === "proceeded";

  #edited(): void {
    this.#scope?.changed();
    this.requestUpdate();
  }

  async #make(method?: "password" | "passkey"): Promise<void> {
    const signIn = this.#signIn();
    if (!this.opened || this.busy || signIn === null) return;
    const generation = this.#generation;
    const newServerKey = this.ticked;
    const api = this.api;
    this.#method = method;
    this.refusal = "";
    this.busy = true;
    let body: FreshSignInBody | null;
    try {
      body = await signIn.signIn(method);
    } catch (error) {
      if (generation !== this.#generation) return;
      this.busy = false;
      this.refusal = signIn.refuse(error);
      return;
    }
    if (generation !== this.#generation) return;
    if (body === null) {
      this.busy = false;
      if (signIn.invalid) {
        await this.updateComplete;
        await focusFirstInvalid(signIn.shadowRoot!);
      }
      return;
    }
    let made;
    try {
      made = await api.makeRecoveryPack({
        locale: currentLocale().startsWith("es") ? "es" : "en",
        newServerKey,
        signIn: body,
      });
    } catch (error) {
      if (generation !== this.#generation) return;
      if (answeredByBox(error)) {
        this.busy = false;
        this.refusal = signIn.refuse(error);
        return;
      }
      if (newServerKey) signIn.clear();
      this.reread = await this.#readStatus(api, generation);
      if (generation !== this.#generation) return;
      this.lostTicked = newServerKey;
      this.step = "lost";
      this.busy = false;
      return;
    }
    if (generation !== this.#generation) return;
    const received = await this.#markReceived(api, made.number);
    // Sent even if the dialog closed meanwhile: the pack is marked received, so it must be handed
    // over — but never to a card that has since moved to another api.
    if (api !== this.api) return;
    this.dispatchEvent(
      new CustomEvent<RecoveryPackMade>("recovery-pack-made", {
        detail: { pdf: made.pdf, number: made.number, key: made.key, received },
        bubbles: true,
        composed: true,
      }),
    );
    if (generation !== this.#generation) return;
    if (made.key === "failed" && newServerKey) {
      signIn.clear();
      this.reread = await this.#readStatus(api, generation);
      if (generation !== this.#generation) return;
      this.step = "key-failed";
      this.busy = false;
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
    this.ticked = true;
    this.refusal = "";
    this.#signIn()?.clear();
    this.#scope?.changed();
  }

  #retry(): void {
    this.step = "form";
    void this.#make(this.#method);
  }

  override render(): TemplateResult {
    const open = this.opened;
    return html`<wt-dialog
      data-test="recovery-pack-dialog"
      heading=${t("recovery_pack_dialog.heading")}
      .open=${open}
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
        <p data-test="intro">${t("recovery_pack_dialog.intro")}</p>
        <dashboard-fresh-sign-in
          class="sign-in"
          .api=${this.api}
          ?disabled=${this.busy}
          @sign-in-ways=${(event: CustomEvent<SignInWays>) => {
            this.ways = event.detail;
          }}
          @sign-in-change=${() => this.#edited()}
          @sign-in-passkey=${() => void this.#make("passkey")}
        ></dashboard-fresh-sign-in>
        ${this.#option()}
      </div>
      ${this.step === "lost" ? this.#lost() : nothing}
      ${this.step === "key-failed" ? this.#keyFailed() : nothing}`;
  }

  #option(): TemplateResult | typeof nothing {
    if (noServerKey(this.status)) return nothing;
    const holder = keyHolder(this.status);
    const why =
      holder === null
        ? t("recovery_pack_dialog.new_key_unknown")
        : holder.received
          ? fill("recovery_pack_dialog.new_key_held", {
              number: String(holder.number),
              date: packDate(holder.madeAt, this.#zone),
            })
          : unreceivedWords(holder, this.#zone);
    return html`<div class="option">
      <input
        type="checkbox"
        id="new-server-key"
        name="new-server-key"
        aria-describedby="new-key-why"
        .checked=${this.ticked}
        ?disabled=${this.busy}
        @change=${(event: Event) => {
          this.ticked = (event.target as HTMLInputElement).checked;
          this.#edited();
        }}
      />
      <label for="new-server-key">${t("recovery_pack_dialog.new_key")}</label>
      <p class="why" id="new-key-why" data-test="new-key-why">
        ${why} ${t("recovery_pack_dialog.new_key_effect")}
      </p>
    </div>`;
  }

  #lost(): TemplateResult {
    if (!this.lostTicked)
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
        : holder.received
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
    const leave = () => void this.#dialog()?.requestClose("cancel");
    if (this.step === "key-failed")
      return html`<wt-form-actions slot="footer">
        <wt-button data-test="close-pack" variant="primary" @click=${leave}
          >${t("action.close")}</wt-button
        >
      </wt-form-actions>`;
    if (this.step === "lost")
      return html`<wt-form-actions slot="footer">
        <wt-button slot="cancel" data-test="stop-pack" variant="secondary" @click=${leave}
          >${t("recovery_pack_dialog.stop")}</wt-button
        >
        ${
          this.lostTicked
            ? html`<wt-button
                data-test="remake-pack"
                variant="danger"
                @click=${() => this.#remake()}
                >${t("recovery_pack_dialog.remake")}</wt-button
              >`
            : html`<wt-button data-test="retry-pack" variant="primary" @click=${() => this.#retry()}
                >${t("recovery_pack_dialog.try_again")}</wt-button
              >`
        }
      </wt-form-actions>`;
    const signIn = this.#signIn();
    const noWayIn = this.ways !== null && !this.ways.password && !this.ways.passkey;
    const bottom = [this.refusal, signIn?.marked ? t("form.fix_fields") : ""]
      .filter(Boolean)
      .join(" ");
    return html`<wt-form-actions slot="footer" .error=${bottom}>
      <wt-button slot="cancel" data-test="cancel-pack" variant="secondary" @click=${leave}
        >${t("action.cancel")}</wt-button
      >
      ${
        noWayIn
          ? nothing
          : html`<wt-button
              data-test="make-pack"
              variant=${this.ticked ? "danger" : "primary"}
              ?disabled=${this.busy || this.ways === null || (signIn?.invalid ?? false)}
              @click=${() => void this.#make()}
              >${t("recovery_pack_dialog.make")}</wt-button
            >`
      }
    </wt-form-actions>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "dashboard-recovery-pack-dialog": RecoveryPackDialog;
  }
}
