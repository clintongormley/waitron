import { LitElement, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-card.js";
import "@waitron/ui/src/components/wt-choice-row.js";
import { helpLinkStyles, introStyles, statusStyles } from "../form-styles.js";
import { modePill, modePillStyles } from "../mode-pill.js";
import type { SetupApi } from "../api/client.js";
import { LocaleChangeController } from "../i18n/locale-controller.js";
import { currentLocale, format, t } from "../i18n/t.js";

export const BACKUP_SETUP_URL = "/backup";

const HEADINGS = {
  none: "done.heading",
  bucket: "done.heading_rebuilt",
  archive: "done.heading_restored",
  cloud: "done.heading_restored",
} as const;

/** The waiting app's answer; its `confirmed` says whether it holds a confirmation the start has not refused. */
function waitingForClock(error: unknown): { confirmed: boolean } | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  if (error.code !== "server.waiting_for_clock") return undefined;
  const params =
    "params" in error ? (error.params as { confirmed?: unknown } | undefined) : undefined;
  return { confirmed: params?.confirmed === true };
}

type ClockAnswer = { result?: string; status?: string; deviceMs?: number; serverMs?: number };
type ClockNote =
  | "done.clock.on_box"
  | "done.clock.set_refused"
  | "done.clock.key_refused"
  | "done.clock.unanswered";
/** No answer to show: the key was refused, the request failed, or the screen left the page. */
type ClockMiss = "key_refused" | "failed" | "gone";

/** The JSON the page of a box whose start failed answers (`recovery-surface.ts`). */
function isRecoveryAnswer(answer: unknown): boolean {
  if (typeof answer !== "object" || answer === null) return false;
  const { failures, level } = answer as { failures?: unknown; level?: unknown };
  return typeof failures === "number" && typeof level === "string";
}

function isServerError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("status" in error)) return false;
  return typeof error.status === "number" && error.status >= 500;
}

@customElement("setup-done-screen")
export class SetupDoneScreen extends LitElement {
  static override styles = [
    helpLinkStyles,
    baseStyles,
    statusStyles,
    introStyles,
    modePillStyles,
    css`
      :host {
        display: block;
      }
      .mode {
        margin: 0 0 var(--wt-space-3);
      }
      .intro {
        margin: 0 0 var(--wt-space-4);
      }
      .choices,
      wt-card,
      .break-glass {
        margin: var(--wt-space-4) 0;
      }
      wt-card p {
        margin: 0 0 var(--wt-space-2);
      }
      wt-card ul {
        margin: 0;
      }
      .clock dl {
        margin: 0 0 var(--wt-space-3);
      }
      .clock dd {
        margin: 0 0 var(--wt-space-2);
        font-weight: var(--wt-font-weight-bold);
      }
      .clock-actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }
      .break-glass {
        padding: var(--wt-space-4);
        border: 1px solid var(--wt-color-warning);
        border-inline-start: var(--wt-space-1) solid var(--wt-color-warning);
        border-radius: var(--wt-radius-lg);
        background: var(--wt-color-surface);
      }
      .break-glass h2 {
        margin: 0 0 var(--wt-space-2);
        font-size: var(--wt-font-size-lg);
      }
      .break-glass-warning {
        margin: 0;
        font-weight: var(--wt-font-weight-bold);
      }
      .break-glass-secret {
        display: block;
        margin: var(--wt-space-2) 0 0;
        padding: var(--wt-space-2) var(--wt-space-3);
        font-family: var(--wt-font-family-mono);
        font-size: var(--wt-font-size-lg);
        word-break: break-all;
        user-select: all;
        background: var(--wt-color-surface-raised);
        color: var(--wt-color-text);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
      }
    `,
  ];

  @property({ attribute: false }) api!: SetupApi;

  /** The server keeps only a verifier of this secret (`mintBreakGlassSecret`), so this screen is the
   * operator's only chance to record it. */
  @property({ attribute: false }) breakGlassSecret?: string;
  @property({ attribute: false }) breakGlassKeyName?: string;

  /**
   * True after a successful adopt, where the box restarts as a joining spare, not a trading
   * server. A separate flag rather than a `breakGlassSecret` test: the secret is a value to
   * display, not a statement of which path ran.
   */
  @property({ type: Boolean }) mirrorJoin = false;

  @property({ attribute: false }) openingHours?: { departmentId: string };

  @property() onboardingIntent?: "demo" | "prepare" | "live";

  /** Which restore ran, if one did: each re-issues the server's certificate for this machine's
   * addresses, so devices may need pointing at this server. */
  @property() restored?: "bucket" | "archive" | "cloud";

  /** A pause before the first poll so the box has begun its restart. */
  @property({ type: Number }) startDelayMs = 800;

  @property({ type: Number }) pollIntervalMs = 1500;

  /** In memory only, to confirm the restore's start's time; dropped once ready or off the page. */
  @property({ attribute: false }) nodeRecoveryKey?: string;

  @state() private ready = false;

  @state() private startFailed = false;

  @state() private waitingForClock = false;

  @state() private clockTimes?: { deviceMs: number; serverMs: number };

  @state() private confirmed = false;

  /** Confirmations this screen has made; a poll sent before the latest one cannot report it. */
  #confirmations = 0;

  @state() private clockNote?: ClockNote;

  @state() private clockPress?: "confirm" | "set";

  /** Set when the latest comparison got no answer, so the next poll compares again. */
  #compareAgain = false;

  #compares = 0;

  /**
   * Moves on when the screen leaves the page or the start fails, so clock work begun before then
   * sends no keyed request and its answer is dropped.
   */
  #life = 0;

  #timer?: ReturnType<typeof setTimeout>;

  constructor() {
    super();
    new LocaleChangeController(this);
  }

  override firstUpdated(): void {
    if (this.mirrorJoin) return;
    this.#timer = setTimeout(() => void this.#tick(), this.startDelayMs);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#life += 1;
    this.nodeRecoveryKey = undefined;
    if (this.#timer !== undefined) clearTimeout(this.#timer);
  }

  async #tick(): Promise<void> {
    if (!this.isConnected || this.ready) return;
    await this.#pollOnce();
    if (!this.isConnected || this.ready) return;
    this.#timer = setTimeout(() => void this.#tick(), this.pollIntervalMs);
  }

  /**
   * A resolved `getStatus` means the box has not restarted yet. A `TypeError` is `fetch` failing while
   * the box is down mid-restart: expected, never shown. A 5xx is read as not ready yet, so it waits
   * too. Any other rejection (a 404 once the setup route is gone, another non-2xx, or a body that is
   * not JSON) is taken to mean the box is trading, unless `/recovery-api/status` answers the JSON
   * of the page a failed start shows; that keeps polling, as Retry there may start it. A restore's
   * start that is waiting to confirm its time answers `server.waiting_for_clock`, and this screen
   * asks for the time itself: opening the waiting page would reload and lose the key held in
   * memory. Its `confirmed` says whether the server still holds a confirmation; once a refused try
   * drops it, this screen asks again.
   */
  async #pollOnce(): Promise<void> {
    const confirmationsBefore = this.#confirmations;
    try {
      await this.api.getStatus();
    } catch (error) {
      const waiting = waitingForClock(error);
      if (waiting !== undefined && this.isConnected) {
        this.startFailed = false;
        if (waiting.confirmed) {
          this.waitingForClock = true;
          this.confirmed = true;
          return;
        }
        if (this.#confirmations !== confirmationsBefore) return;
        if (this.waitingForClock && !this.confirmed && !this.#compareAgain) return;
        if (this.confirmed) this.clockTimes = undefined;
        this.waitingForClock = true;
        this.confirmed = false;
        await this.#compare();
        return;
      }
      if (error instanceof TypeError || isServerError(error)) {
        return;
      }
      if (!this.isConnected) return;
      const failed = await this.#startFailed();
      if (failed === undefined || !this.isConnected) return;
      if (failed) {
        this.#failed();
        return;
      }
      this.startFailed = false;
      this.ready = true;
      this.nodeRecoveryKey = undefined;
    }
  }

  /** A later start that waits for its time again is compared afresh. */
  #failed(): void {
    this.#life += 1;
    this.startFailed = true;
    this.waitingForClock = false;
    this.clockTimes = undefined;
    this.confirmed = false;
    this.clockNote = undefined;
    this.#compareAgain = false;
  }

  /** Undefined when the box could not be reached, or answered 5xx, so the next poll asks again. */
  async #startFailed(): Promise<boolean | undefined> {
    try {
      return isRecoveryAnswer(await this.api.getRecoveryStatus());
    } catch (error) {
      return error instanceof TypeError || isServerError(error) ? undefined : false;
    }
  }

  /** This device's time against a fresh challenge. */
  async #timed(route: "compare" | "confirm" | "set"): Promise<ClockAnswer | ClockMiss> {
    const life = this.#life;
    const key = this.nodeRecoveryKey;
    try {
      const { id } = await this.api.restoreClock<{ id: string }>("challenge", { key });
      if (life !== this.#life) return "gone";
      const answer = await this.api.restoreClock<ClockAnswer>(route, {
        key,
        challengeId: id,
        instantMs: Date.now(),
      });
      return life === this.#life ? answer : "gone";
    } catch (error) {
      if (life !== this.#life) return "gone";
      const refused =
        typeof error === "object" && error !== null && "status" in error && error.status === 403;
      return refused ? "key_refused" : "failed";
    }
  }

  /** Both times are hidden after a failure, which keeps Confirm and This device off. */
  #missed(miss: "key_refused" | "failed"): void {
    if (miss === "key_refused") {
      this.clockNote = "done.clock.key_refused";
      return;
    }
    this.clockNote = "done.clock.unanswered";
    this.clockTimes = undefined;
    this.#compareAgain = true;
  }

  async #compare(): Promise<void> {
    const request = ++this.#compares;
    const answer = await this.#timed("compare");
    if (answer === "gone" || request !== this.#compares) return;
    if (typeof answer === "string") {
      this.#missed(answer);
      return;
    }
    if (answer.result === "same_machine") {
      this.#compareAgain = false;
      this.clockNote = "done.clock.on_box";
      return;
    }
    // Answered without times (`challenge`: the round trip was too slow or the box's clock moved).
    if (answer.deviceMs === undefined || answer.serverMs === undefined) {
      this.#missed("failed");
      return;
    }
    this.#compareAgain = false;
    if (this.clockNote === "done.clock.unanswered") this.clockNote = undefined;
    this.clockTimes = { deviceMs: answer.deviceMs, serverMs: answer.serverMs };
  }

  async #press(press: "confirm" | "set"): Promise<void> {
    // The host still takes a click while its button is disabled.
    if (this.clockPress !== undefined || this.clockTimes === undefined) return;
    this.clockPress = press;
    this.clockNote = undefined;
    try {
      const answer = await this.#timed(press);
      const setRefused = press === "set" && typeof answer === "object" && answer.status !== "set";
      // Choosing this device's time is the confirmation (plan D-confirm), measured against the
      // clock just set rather than assumed.
      const checked =
        typeof answer === "object" && answer.status === "set"
          ? await this.#timed("confirm")
          : answer;
      if (checked === "gone") return;
      if (typeof checked === "string") {
        this.#missed(checked);
      } else if (checked.result === "confirmed") {
        this.#confirmations += 1;
        this.confirmed = true;
      } else {
        if (setRefused) this.clockNote = "done.clock.set_refused";
        await this.#compare();
      }
    } finally {
      this.clockPress = undefined;
    }
  }

  #clockStep(): TemplateResult | typeof nothing {
    if (!this.waitingForClock || this.ready || this.confirmed) return nothing;
    const when = (ms: number | undefined) =>
      ms === undefined
        ? ""
        : new Date(ms).toLocaleString(currentLocale(), {
            day: "numeric",
            month: "long",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          });
    return html`<section class="clock" data-test="clock-step">
      <dl>
        <dt>${t("done.clock.server_time")}</dt>
        <dd data-test="clock-server">${when(this.clockTimes?.serverMs)}</dd>
        <dt>${t("done.clock.device_time")}</dt>
        <dd data-test="clock-device">${when(this.clockTimes?.deviceMs)}</dd>
      </dl>
      ${
        this.clockNote === undefined
          ? nothing
          : html`<p class="intro" data-test="clock-note" role="alert">${t(this.clockNote)}</p>`
      }
      <div class="clock-actions">
        <wt-button
          data-test="clock-confirm"
          variant="primary"
          ?disabled=${this.clockTimes === undefined}
          ?loading=${this.clockPress === "confirm"}
          @click=${() => void this.#press("confirm")}
          >${t("done.clock.confirm")}</wt-button
        >
        <wt-button
          data-test="clock-this-device"
          variant="secondary"
          ?disabled=${this.clockTimes === undefined}
          ?loading=${this.clockPress === "set"}
          @click=${() => void this.#press("set")}
          >${t("done.clock.this_device")}</wt-button
        >
      </div>
    </section>`;
  }

  override render(): TemplateResult {
    return this.mirrorJoin ? this.#renderJoining() : this.#renderTrading();
  }

  #keyName(name: string): string {
    const parts = /^(\d{4}-\d{2}-\d{2}) · ([34679ACDEFHJKMNPQRTUVWXY]{4})$/.exec(name);
    if (parts === null) return name;
    const date = new Date(`${parts[1]}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== parts[1])
      return name;
    return format("done.break_glass.key_name", {
      date: new Intl.DateTimeFormat(currentLocale(), {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(date),
      code: parts[2]!,
    });
  }

  #breakGlass(): TemplateResult | null {
    if (this.breakGlassSecret === undefined) return null;
    return html`<div class="break-glass" data-test="break-glass">
      <h2>${t("done.break_glass.heading")}</h2>
      <p class="break-glass-warning" data-test="break-glass-warning">
        ${t("done.break_glass.warning")}
        ${t(this.mirrorJoin ? "done.break_glass.take_over" : "done.break_glass.promote")}
      </p>
      ${this.breakGlassKeyName === undefined ? nothing : html`<p data-test="break-glass-key-name">${this.#keyName(this.breakGlassKeyName)}</p>`}
      <code class="break-glass-secret" data-test="break-glass-secret"
        >${this.breakGlassSecret}</code
      >
      <p data-test="break-glass-backup-warning">${t("done.break_glass.backups")}</p>
    </div>`;
  }

  #renderTrading(): TemplateResult {
    return html`
      <h1>${t(HEADINGS[this.restored ?? "none"])}</h1>
      ${
        this.onboardingIntent === undefined
          ? nothing
          : html`<div class="mode">${modePill(this.onboardingIntent, "mode-indicator")}</div>`
      }
      <p class="intro" data-test="status" role="status">${t(this.#statusKey())}</p>
      ${this.#clockStep()}
      <div class="choices" data-test="links">
        ${this.startFailed ? this.#serverLink() : this.#appLinks()}
      </div>
      ${
        this.openingHours === undefined || this.startFailed
          ? nothing
          : html`<wt-card data-test="opening-hours">
              <p>${t("done.opening_hours")}</p>
              <a href="/opening-hours/view/year">${t("done.change_opening_hours")}</a>
            </wt-card>`
      }
      ${this.restored === undefined || this.startFailed ? nothing : this.#deviceSteps()}
      ${this.#breakGlass()}
      ${
        this.onboardingIntent === "demo" || this.restored === "bucket" || this.startFailed
          ? nothing
          : html`<wt-card data-test="backup-nudge">
              <p>${t("done.backup_nudge")}</p>
              <a href=${BACKUP_SETUP_URL}>${t("done.backup_link")}</a>
            </wt-card>`
      }
    `;
  }

  #appLinks(): TemplateResult {
    return html`<wt-choice-row
        data-test="link-dashboard"
        heading=${t("done.link.dashboard")}
        href="/"
        >${t("done.description.dashboard")}</wt-choice-row
      >
      <wt-choice-row data-test="link-till" heading=${t("done.link.till")} href="/till/"
        >${t("done.description.till")}</wt-choice-row
      >
      ${
        this.onboardingIntent === "demo"
          ? html`<wt-choice-row data-test="link-email" heading=${t("done.link.email")} href="/email"
              >${t("done.description.email")}</wt-choice-row
            >`
          : nothing
      }`;
  }

  #serverLink(): TemplateResult {
    return html`<wt-choice-row data-test="link-server" heading=${t("done.link.server")} href="/"
      >${t("done.description.server")}</wt-choice-row
    >`;
  }

  #statusKey():
    | "done.ready"
    | "done.start_failed"
    | "done.waiting_for_clock"
    | "done.clock_confirmed"
    | "done.restarting" {
    if (this.ready) return "done.ready";
    if (this.startFailed) return "done.start_failed";
    if (!this.waitingForClock) return "done.restarting";
    return this.confirmed ? "done.clock_confirmed" : "done.waiting_for_clock";
  }

  #deviceSteps(): TemplateResult {
    return html`<wt-card data-test="device-steps">
      <p>${t("done.devices.intro")}</p>
      <ul>
        <li>${t("done.devices.local")}</li>
        <li>${t("done.devices.ip")}</li>
        <li>${t("done.devices.print_agent")}</li>
      </ul>
    </wt-card>`;
  }

  #renderJoining(): TemplateResult {
    return html`
      <h1>${t("done.joining.heading")}</h1>
      <p data-test="joining-body">${t("done.joining.body")}</p>
      <p data-test="joining-switch-label">${t("done.joining.switch_label")}</p>
      ${this.#breakGlass()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "setup-done-screen": SetupDoneScreen;
  }
}
