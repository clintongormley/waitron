import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { groupedJoinCode } from "@waitron/shared";
import {
  FormFeedback,
  submitOnEnter,
  baseStyles,
  pageTitleStyles,
  leaveCoordinatorFor,
  type DraftScope,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-input.js";
import "@waitron/ui/src/components/wt-form-actions.js";
import { actionsStyles, fieldStyles, helpLinkStyles } from "../form-styles.js";
import { dispatchJoinFinishRequested, dispatchJoinHandle, dispatchSetupGoto } from "../events.js";
import { SetupApi, type JoinState } from "../api/client.js";
import { format, localTime, t } from "../i18n/t.js";
import type { StringKey } from "../i18n/strings.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";
import { serversPageOf } from "../servers-page.js";

/** The holding tab reads every 2 seconds, which keeps it counted as open on the server. */
const READ_EVERY_MS = 2_000;

interface Refusal {
  code?: unknown;
  params?: Record<string, unknown>;
}

type View = JoinState | { state: "address" } | { state: "reading" };

/**
 * A main box's address is its origin, so a typed path, query or fragment is dropped. Anything that
 * is not an http or https URL is left as typed, for the server to refuse.
 */
function originOf(typed: string): string {
  try {
    const url = new URL(typed);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : typed;
  } catch {
    return typed;
  }
}

// A state's words name Start again, the one way on that its view draws; a refusal of Join names Join.
const ENDED_WORDS: Record<string, StringKey> = {
  dismissed: "connect.ended.dismissed",
  replaced: "connect.replaced",
  cancelled: "connect.ended.cancelled",
  code_taken: "connect.ended.code_taken",
  invalid: "connect.ended.invalid",
  stopped: "connect.ended.stopped",
};

const FAILED_WORDS: Record<string, StringKey> = {
  // Only an approved answer whose copy does not check out leaves a join failed this way.
  "mirror.join_invalid": "connect.failed.copy_invalid",
  "mirror.join_not_found": "connect.failed.not_found",
};

const REFUSAL_WORDS: Record<string, StringKey> = {
  "mirror.join_invalid": "connect.refusal.join_invalid",
  "mirror.standby_invalid": "connect.refusal.join_invalid",
  "mirror.join_not_found": "connect.refusal.join_not_found",
  "mirror.join_address_mismatch": "connect.refusal.join_address_mismatch",
  "mirror.join_code_taken": "connect.refusal.join_code_taken",
  "mirror.join_waiting": "connect.refusal.join_waiting",
  "mirror.join_in_use": "connect.refusal.join_in_use",
  "mirror.join_approving": "connect.refusal.join_approving",
  "mirror.join_handle_invalid": "connect.refusal.join_handle_invalid",
  "mirror.bundle_fetch_failed": "connect.refusal.unreachable",
  "mirror.standby_name_taken": "connect.refusal.name_taken",
  "setup.connection_insecure": "connect.refusal.insecure",
  "setup.owner_required": "shell.setup_not_accepted",
  "setup.already_provisioning": "shell.already_provisioning",
  "setup.not_ready": "shell.not_ready",
  "setup.adopt_incomplete": "connect.refusal.adopt_incomplete",
};

/** Refusals of Finish joining whose Join words would name a button the approved view does not draw. */
const FINISH_WORDS: Record<string, StringKey> = {
  "mirror.bundle_fetch_failed": "connect.finish.bundle_fetch_failed",
};

type FullDetail = "retryAt" | "max" | "minutes";

const FULL_WORDS: Record<string, { key: StringKey; needs: FullDetail[] }> = {
  address: { key: "connect.refusal.join_full_address", needs: [] },
  network: { key: "connect.refusal.join_full_network", needs: [] },
  listed: { key: "connect.refusal.join_full_listed", needs: ["max"] },
  recent: { key: "connect.refusal.join_full_recent", needs: ["max", "minutes", "retryAt"] },
};

/** A full join's words, or undefined when a detail its sentence needs is missing or of the wrong type. */
function fullWords(
  { key, needs }: { key: StringKey; needs: FullDetail[] },
  { retryAt, max, minutes }: Record<string, unknown>,
) {
  const details: Partial<Record<FullDetail, string | number>> = {};
  if (typeof retryAt === "string" && retryAt !== "")
    details.retryAt = localTime(retryAt) ?? retryAt;
  if (typeof max === "number") details.max = max;
  if (typeof minutes === "number") details.minutes = minutes;
  return needs.every((name) => details[name] !== undefined) ? format(key, details) : undefined;
}

/** The words for a refusal this screen knows, or undefined. */
function refusalWords({ code, params }: Refusal): string | undefined {
  const details = params ?? {};
  const { limit, primaryAt, standbyAt } = details;
  if (code === "mirror.join_full" && typeof limit === "string" && FULL_WORDS[limit] !== undefined)
    return fullWords(FULL_WORDS[limit], details);
  if (
    code === "mirror.clocks_apart" &&
    typeof primaryAt === "string" &&
    typeof standbyAt === "string"
  )
    return format("connect.refusal.clocks_apart", {
      primaryAt: localTime(primaryAt) ?? primaryAt,
      standbyAt: localTime(standbyAt) ?? standbyAt,
    });
  const key = typeof code === "string" ? REFUSAL_WORDS[code] : undefined;
  return key === undefined ? undefined : t(key);
}

/** Refusals of Join whose way on is to end the join already held, which Start again does. */
const HELD_JOIN_CODES: ReadonlySet<unknown> = new Set([
  "mirror.join_waiting",
  "mirror.join_in_use",
]);

/** Only a non-empty string is a handle: session storage answers `null` for none. */
const handleOf = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

const isAddressRefusal = ({ code, params }: Refusal) =>
  code === "mirror.primary_url_invalid" ||
  (code === "setup.request_invalid" && params?.field === "primaryUrl");

/** Join or Finish joining on a join that is no longer in that state: it changed underneath. */
const isJoinNotApproved = ({ code, params }: Refusal) =>
  code === "setup.request_invalid" && params?.field === "join";

/**
 * The join screen. Join starts a request on the main box and shows its code; Join on the code says
 * the main box shows it too. Only the tab holding the join's handle is shown the code. The shell
 * keeps the handle (`join-handle`) and posts Finish joining (`join-finish-requested`), which this
 * screen asks for by itself once the main box has added this box.
 */
@customElement("setup-connect-screen")
export class SetupConnectScreen extends LitElement {
  static override styles = [
    baseStyles,
    pageTitleStyles,
    helpLinkStyles,
    fieldStyles,
    actionsStyles,
    css`
      :host {
        display: block;
      }
      .code {
        margin: var(--wt-space-4) 0;
        font-family: var(--wt-font-family-mono);
        font-size: var(--wt-font-size-xl);
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-text);
        letter-spacing: var(--wt-letter-spacing-wide);
      }
      .question {
        margin: 0 0 var(--wt-space-2);
        font-weight: var(--wt-font-weight-bold);
      }
      .detail {
        margin: 0 0 var(--wt-space-2);
        color: var(--wt-color-text-muted);
        overflow-wrap: anywhere;
      }
    `,
  ];

  @property({ attribute: false }) api: Pick<
    SetupApi,
    "startJoin" | "joinState" | "cancelJoin" | "confirmJoin"
  > = new SetupApi();

  @property({ attribute: false }) backScreen: "mode" | "role" = "role";

  /** This tab's handle for the join, kept by the shell; without it no code is shown. */
  @property({ attribute: false }) handle?: string;

  /**
   * A refusal of Finish joining the shell routed back, with `errorMessage` as its words. Each new
   * refusal ends `finishing`.
   */
  @property({ attribute: false }) refusal?: Refusal;

  @property() errorMessage?: string;

  /**
   * Set by the screen when it hands Finish joining to the shell, so it is sent once; a routed-back
   * `refusal` clears it, and so may the shell.
   */
  @property({ attribute: false }) finishing = false;

  @state() private view: View = { state: "reading" };

  @state() private primaryUrl = "";

  /** The last refusal of Join, No, Start again or Finish joining; its words are chosen when drawn. */
  @state() private shownRefusal?: { refusal: Refusal; routedBack: boolean };

  @state() private addressRefused = false;

  @state() private busy = false;

  /** This box's Join on the code is out. */
  @state() private confirming = false;

  readonly #feedback = new FormFeedback(this);

  /** Bumped by every start, cancel and disconnect, so a read sent before it is dropped. */
  #generation = 0;
  #timer?: ReturnType<typeof setTimeout>;
  /** When the view's `timeLeftMs` was taken, on `performance.now()`. */
  #shownAt = 0;
  /** The handle whose approved join this screen handed on by itself; each join has a new handle. */
  #finishedFor?: string;

  #baseline?: { primaryUrl: string };
  #scope?: DraftScope<{ primaryUrl: string }>;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#registerScope();
    void this.#read();
  }

  override disconnectedCallback(): void {
    this.#stopReading();
    this.#scope?.dispose();
    this.#scope = undefined;
    super.disconnectedCallback();
  }

  #registerScope(): void {
    if (!this.isConnected || !this.#baseline || this.#scope) return;
    this.#scope = leaveCoordinatorFor(this)?.register({
      id: this,
      current: () => ({ primaryUrl: this.primaryUrl }),
      snapshot: (form) => ({ ...form }),
      equal: (a, b) => a.primaryUrl.trim() === b.primaryUrl.trim(),
      restore: (form) => {
        this.primaryUrl = form.primaryUrl;
        this.#feedback.reset();
      },
    });
    this.#scope?.commit(this.#baseline);
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    this.#baseline ??= { primaryUrl: this.primaryUrl };
    if (changed.has("refusal") && this.refusal !== undefined) {
      this.finishing = false;
      // The shell mounts a new screen for each refusal; its join was already handed on once.
      this.#finishedFor = handleOf(this.handle);
      if (isJoinNotApproved(this.refusal)) {
        this.shownRefusal = undefined;
        void this.#read();
      } else {
        this.shownRefusal = { refusal: this.refusal, routedBack: true };
      }
    }
  }

  protected override updated(): void {
    this.#registerScope();
  }

  #stopReading(): void {
    this.#generation++;
    clearTimeout(this.#timer);
  }

  async #read(): Promise<void> {
    this.#stopReading();
    const generation = this.#generation;
    const handle = handleOf(this.handle);
    try {
      const answer = await this.api.joinState(handle);
      if (generation !== this.#generation || !this.isConnected) return;
      this.#show(answer, handle);
    } catch {
      if (generation !== this.#generation || !this.isConnected) return;
      // A lost read is asked again; without a join to follow, the address is the way on.
      if (this.view.state === "reading") this.view = { state: "address" };
      // The time left is worked out when drawn, and a failed read changes nothing else.
      this.requestUpdate();
      if (handle !== undefined) this.#readLater(generation);
    }
  }

  #readLater(generation: number): void {
    if (generation !== this.#generation) return;
    this.#timer = setTimeout(() => void this.#read(), READ_EVERY_MS);
  }

  #show(answer: JoinState, handle: string | undefined): void {
    // The code belongs to the tab that holds the handle, whatever an answer carries.
    const shown: JoinState =
      handle === undefined && (answer.state === "waiting" || answer.state === "approved")
        ? { state: "elsewhere" }
        : answer;
    if (shown.state === "waiting") {
      this.primaryUrl = shown.primaryUrl;
      this.#baseline = { primaryUrl: shown.primaryUrl };
      this.#scope?.commit(this.#baseline);
    }
    this.#shownAt = performance.now();
    this.view = shown.state === "none" ? { state: "address" } : shown;
    if (shown.state === "approved" && handle !== undefined && this.#finishedFor !== handle) {
      if (this.#finish()) this.#finishedFor = handle;
    }
    if (shown.state === "waiting" || shown.state === "approved") this.#readLater(this.#generation);
  }

  #onAddress(event: CustomEvent<{ value: string }>): void {
    event.stopPropagation();
    this.primaryUrl = event.detail.value;
    this.addressRefused = false;
    this.#scope?.changed();
  }

  #blank(): boolean {
    return this.#feedback.attempted && this.primaryUrl.trim() === "";
  }

  async #join(): Promise<void> {
    if (this.busy) return;
    this.#feedback.press();
    this.shownRefusal = undefined;
    this.addressRefused = false;
    if (this.#blank()) {
      void this.#feedback.focus(this.shadowRoot!);
      return;
    }
    const address = originOf(this.primaryUrl.trim());
    this.primaryUrl = address;
    // A read sent with the previous handle while the start waits would answer `replaced`.
    this.#stopReading();
    const generation = this.#generation;
    this.busy = true;
    try {
      const started = await this.api.startJoin(address, handleOf(this.handle));
      if (generation !== this.#generation || !this.isConnected) return;
      this.handle = started.handle;
      dispatchJoinHandle(this, started.handle);
      this.#scope?.commit({ primaryUrl: address });
      this.#feedback.reset();
      this.#show(
        { state: "waiting", primaryUrl: address, confirmed: false, ...started },
        started.handle,
      );
    } catch (error) {
      if (generation !== this.#generation || !this.isConnected) return;
      const refusal = (error ?? {}) as Refusal;
      if (isAddressRefusal(refusal)) {
        this.view = { state: "address" };
        this.addressRefused = true;
        void this.#feedback.focus(this.shadowRoot!);
      } else {
        this.shownRefusal = { refusal, routedBack: false };
      }
    } finally {
      if (generation === this.#generation) this.busy = false;
    }
  }

  async #confirm(): Promise<void> {
    if (this.busy || this.confirming) return;
    this.shownRefusal = undefined;
    const handle = handleOf(this.handle);
    this.confirming = true;
    let refusal: Refusal | undefined;
    try {
      await this.api.confirmJoin(handle);
    } catch (error) {
      refusal = (error ?? {}) as Refusal;
    }
    this.confirming = false;
    if (!this.isConnected || handleOf(this.handle) !== handle) return;
    if (refusal === undefined || isJoinNotApproved(refusal)) void this.#read();
    else this.shownRefusal = { refusal, routedBack: false };
  }

  /** Ends the join; Start again then asks the same main box again, and No stops at the address. */
  async #endJoin(again: boolean): Promise<void> {
    if (this.busy || this.finishing || this.confirming) return;
    this.shownRefusal = undefined;
    this.#stopReading();
    const generation = this.#generation;
    this.busy = true;
    try {
      await this.api.cancelJoin(handleOf(this.handle));
    } catch (error) {
      if (generation !== this.#generation || !this.isConnected) return;
      this.busy = false;
      this.shownRefusal = { refusal: (error ?? {}) as Refusal, routedBack: false };
      if (this.view.state === "waiting" || this.view.state === "approved")
        this.#readLater(generation);
      return;
    }
    if (generation !== this.#generation || !this.isConnected) return;
    this.busy = false;
    this.handle = undefined;
    dispatchJoinHandle(this, undefined);
    this.#feedback.reset();
    this.view = { state: "address" };
    if (again && this.primaryUrl.trim() !== "") await this.#join();
  }

  /** Hands Finish joining to the shell; false when one is already out or the screen is busy. */
  #finish(): boolean {
    if (this.finishing || this.busy) return false;
    this.finishing = true;
    dispatchJoinFinishRequested(this);
    return true;
  }

  #message(): string | undefined {
    if (this.shownRefusal === undefined) return undefined;
    const { refusal, routedBack } = this.shownRefusal;
    const finishKey =
      routedBack && typeof refusal.code === "string" ? FINISH_WORDS[refusal.code] : undefined;
    if (finishKey !== undefined) return t(finishKey);
    const shellWords = routedBack && this.errorMessage !== "" ? this.errorMessage : undefined;
    return refusalWords(refusal) ?? shellWords ?? t("connect.refusal.generic");
  }

  #actions(): TemplateResult {
    const view = this.view.state;
    const startAgain = (variant: "primary" | "secondary") =>
      html`<wt-button
        variant=${variant}
        slot=${variant === "secondary" ? "secondary" : nothing}
        data-test="start-again"
        .loading=${this.busy && view !== "address"}
        ?disabled=${this.busy || this.finishing}
        @click=${() => void this.#endJoin(true)}
        >${t("connect.start_again")}</wt-button
      >`;
    switch (view) {
      case "reading":
        return html``;
      case "address":
        return html`${
            HELD_JOIN_CODES.has(this.shownRefusal?.refusal.code) ? startAgain("secondary") : nothing
          }<wt-button
            variant="primary"
            data-test="join"
            ?disabled=${this.#blank()}
            .loading=${this.busy}
            @click=${() => void this.#join()}
            >${t("connect.join")}</wt-button
          >`;
      case "waiting": {
        const no = html`<wt-button
          variant="secondary"
          slot="secondary"
          data-test="no"
          .loading=${this.busy}
          ?disabled=${this.busy || this.confirming}
          @click=${() => void this.#endJoin(false)}
          >${t("connect.no")}</wt-button
        >`;
        return this.view.confirmed
          ? no
          : html`${no}<wt-button
                variant="primary"
                data-test="yes"
                .loading=${this.confirming}
                ?disabled=${this.busy || this.confirming}
                @click=${() => void this.#confirm()}
                >${t("connect.join")}</wt-button
              >`;
      }
      case "approved":
        return html`${startAgain("secondary")}${
          this.finishing && this.shownRefusal?.routedBack !== true
            ? nothing
            : html`<wt-button
                variant="primary"
                data-test="finish"
                .loading=${this.finishing}
                ?disabled=${this.busy || this.finishing}
                @click=${() => this.#finish()}
                >${t("connect.try_again")}</wt-button
              >`
        }`;
      default:
        return startAgain("primary");
    }
  }

  #stateWords(): string | TemplateResult {
    const view = this.view;
    switch (view.state) {
      case "waiting": {
        const servers = serversPageOf(view.primaryUrl);
        const open = t("connect.waiting.open_link");
        return html`${
          servers === undefined
            ? open
            : html`<a
                data-test="servers-page"
                href=${servers}
                target="_blank"
                rel="noopener noreferrer"
                >${open}</a
              >`
        }${t("connect.waiting.open_after")}`;
      }
      case "approved":
        return this.finishing
          ? `${t("connect.approved")} ${t("connect.approved.finishing")}`
          : t("connect.approved");
      case "elsewhere":
        return t("connect.elsewhere");
      case "replaced":
        return t("connect.replaced");
      case "ended":
        return t(ENDED_WORDS[view.reason] ?? "connect.ended.unknown");
      case "failed":
        return t(FAILED_WORDS[view.error] ?? "connect.failed");
      default:
        return "";
    }
  }

  #waiting(): TemplateResult | typeof nothing {
    const view = this.view;
    if (view.state !== "waiting") return nothing;
    const minutes = Math.max(
      0,
      Math.ceil((view.timeLeftMs - (performance.now() - this.#shownAt)) / 60_000),
    );
    return html`<p class="code" data-test="code">${groupedJoinCode(view.code)}</p>
      <p class="question" data-test="question" role="status">
        ${t(view.confirmed ? "connect.waiting.confirmed" : "connect.waiting.lead")}
      </p>
      <p class="detail" data-test="time-left">
        ${Number.isNaN(minutes) ? nothing : format("connect.waiting.time_left", { minutes })}
      </p>`;
  }

  #address(): TemplateResult {
    const error = this.#blank()
      ? t("connect.primary_url.error")
      : this.addressRefused
        ? t("connect.primary_url.refused")
        : "";
    return html`<p data-test="connect-intro">${t("connect.intro")}</p>
      <wt-input
        class="field"
        label=${t("connect.primary_url.label")}
        name="primaryUrl"
        type="url"
        autocapitalize="none"
        autocorrect="off"
        spellcheck="false"
        autocomplete="off"
        required
        hint=${t("connect.primary_url.hint")}
        error=${error}
        ?invalid=${error !== ""}
        data-test="primaryUrl"
        .value=${this.primaryUrl}
        @keydown=${(e: KeyboardEvent) =>
          submitOnEnter(e, this.shadowRoot!.querySelector<HTMLElement>("[data-test=join]"))}
        @wt-change=${(e: CustomEvent<{ value: string }>) => this.#onAddress(e)}
      ></wt-input>`;
  }

  override render(): TemplateResult {
    const view = this.view.state;
    const fieldMarked = view === "address" && (this.#blank() || this.addressRefused);
    const message = this.#message();
    const bottom = [
      ...(message === undefined ? [] : [message]),
      ...(fieldMarked ? [t("connect.fix_fields")] : []),
    ].join(" ");
    return html`
      <h1>${t("connect.heading")}</h1>
      ${
        view === "reading"
          ? html`<p data-test="reading" role="status">${t("connect.reading")}</p>`
          : view === "address"
            ? this.#address()
            : html`<p data-test="state" role="status">${this.#stateWords()}</p>
                ${this.#waiting()}`
      }
      <wt-form-actions .error=${bottom}>
        ${
          view === "waiting"
            ? nothing
            : html`<wt-button
                variant="ghost"
                slot="cancel"
                data-test="back"
                ?disabled=${this.busy || this.finishing}
                @click=${() => dispatchSetupGoto(this, this.backScreen)}
                >${t("connect.back")}</wt-button
              >`
        }
        ${this.#actions()}
      </wt-form-actions>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-connect-screen": SetupConnectScreen;
  }
}
