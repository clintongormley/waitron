import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, queryAssignedElements, state } from "lit/decorators.js";
import {
  THEME_SELECTED_EVENT,
  ThemeChoiceController,
  baseStyles,
  currentThemeChoice,
  themeChoices,
  themeChoicesStyles,
  visuallyHiddenStyles,
} from "@waitron/ui";
// `baseStyles` pulls `@waitron/ui`'s module graph, which registers `wt-button` as a side effect.
import { countText, currentLocale, t } from "../i18n/t.js";
import { helpText } from "../i18n/help-strings.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import type { FormFactor } from "../layout.js";
import {
  builtInScreensFor,
  resolveBuiltInScreen,
  type BuiltInScreen,
} from "../built-in-screens.js";
import type { TillClockState } from "../api/client.js";
import type { TillClockAction } from "../state/clocking.js";
import "@waitron/ui/src/components/wt-language-chooser.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-count-badge.js";
import "@waitron/ui/src/components/wt-help-switch.js";
import { PHONE_WIDTH, languageChooserStyles } from "./language-chooser-styles.js";
import { themeChooser, themeLabels } from "./theme-chooser.js";

/** The product WORDMARK: a fixed name, never translated UI copy. */
const BRAND = "Waitron";

export type ShellAffordance = "station" | "expo" | "schedule" | "find-bill";

type ActionVariant = "secondary" | "ghost";

/** An item of the bar that can move into More; "transfers" is the count and its button together,
 * "operator" the name and everything in its menu together. */
type BarItem =
  | "transfers"
  | "find-bill"
  | "station"
  | "expo"
  | "schedule"
  | "profile"
  | "equipment"
  | "operator";

/** First to leave the bar first: the lowest priority first, and who is signed in last. `#items`
 * draws the others in the reverse order, so the rightmost of them leaves first. */
const LEAVE_ORDER: readonly BarItem[] = [
  "transfers",
  "equipment",
  "profile",
  "schedule",
  "station",
  "expo",
  "find-bill",
  "operator",
];

/** Properties whose change owes a step-back, so may let items come back to the bar. A change of
 * `transferCount` alone does not owe one. */
const CONTENT_PROPERTIES: readonly PropertyKey[] = [
  "formFactor",
  "counterZones",
  "selectedCounterZoneId",
  "showCounter",
  "showFloor",
  "affordances",
  "operatorName",
  "transferAvailable",
  "canSwitchProfile",
  "loadLocales",
  "phone",
  "kiosk",
  "clockState",
  "clockAvailable",
  "clockBusy",
  "clockError",
];

/**
 * Presentational: `till-app` owns data, active screen state and the drill-in stack; the shell only emits
 * intent. While the `drill` slot has assigned nodes the body is `inert`, so nothing behind the overlay
 * is focusable or clickable.
 */
@customElement("till-shell")
export class TillShell extends LitElement {
  constructor() {
    super();
    new LocaleChangeController(this);
    new ThemeChoiceController(this);
  }

  static override styles = [
    baseStyles,
    languageChooserStyles,
    themeChoicesStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100dvh;
        --wt-help-badge-target: 32px;
        --wt-help-badge-size: 24px;
      }

      .shell {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
      }

      .head {
        display: flex;
        flex-wrap: nowrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--wt-space-3);
        padding: var(--wt-space-3) var(--wt-space-4);
        border-bottom: 1px solid var(--wt-color-border);
      }

      .brand {
        flex: none;
        font-size: var(--wt-font-size-lg);
        font-weight: var(--wt-font-weight-bold);
      }

      .tabs {
        display: flex;
        flex: 0 1 auto;
        min-width: 0;
        flex-wrap: nowrap;
        overflow-x: auto;
        align-items: center;
        gap: var(--wt-space-2);
      }

      .till-strip {
        display: flex;
        flex: 1;
        min-width: 0;
        overflow-x: auto;
        align-items: center;
        gap: var(--wt-space-2);
      }
      .till-strip > * {
        flex: none;
      }
      .head.phone .till-strip .tabs {
        flex: none;
      }
      .head:has(.till-strip) .operator {
        max-width: calc(var(--wt-tap-min) * 6);
      }
      .head.phone:has(.till-strip) .operator {
        max-width: calc(var(--wt-tap-min) * 3);
      }
      .head:has(.till-strip) .operator-label {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .head:has(.till-strip) .clock-dot {
        flex: none;
      }
      [data-testing] summary {
        min-height: var(--wt-tap-min);
        cursor: pointer;
        padding: var(--wt-space-2) var(--wt-space-4);
      }
      .bar-action {
        min-height: var(--wt-tap-min);
        min-width: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        color: var(--wt-color-text);
        background: var(--wt-color-surface);
        font: inherit;
        white-space: nowrap;
        cursor: pointer;
      }
      .bar-action[data-attention] {
        border-color: var(--wt-color-warning);
        animation: waiting-attention 2s ease-in-out infinite;
      }
      @keyframes waiting-attention {
        50% {
          border-color: transparent;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .bar-action[data-attention] {
          animation: none;
        }
      }
      .bar-action[aria-pressed="true"] {
        background: var(--wt-color-surface-raised);
      }
      .bar-action:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }

      .tab {
        flex: none;
        white-space: nowrap;
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-4);
        border: 1px solid transparent;
        border-radius: var(--wt-radius-md);
        background: transparent;
        color: var(--wt-color-text);
        font: inherit;
        font-weight: var(--wt-font-weight-bold);
        cursor: pointer;
      }

      .tab:hover {
        background: var(--wt-color-surface-raised);
      }

      .tab[aria-selected="true"],
      .tab[aria-pressed="true"] {
        background: var(--wt-color-surface-raised);
        border-color: var(--wt-color-border);
      }

      [data-counter-zones]::part(trigger) {
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-3);
        font-weight: var(--wt-font-weight-bold);
      }

      [data-counter-zones][data-active]::part(trigger) {
        background: var(--wt-color-surface-raised);
        border-color: var(--wt-color-border);
      }

      [data-counter-zone] {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        min-height: var(--wt-tap-min);
        padding: var(--wt-space-2) var(--wt-space-3);
        border: 0;
        background: transparent;
        color: var(--wt-color-text);
        font: inherit;
        cursor: pointer;
        text-align: start;
      }
      [data-counter-zone]:hover {
        background: var(--wt-color-surface-raised);
      }
      [data-counter-zone]:focus-visible {
        outline: var(--wt-focus-ring);
        outline-offset: var(--wt-focus-offset);
      }
      .zone-check {
        width: var(--wt-space-4);
      }

      .session {
        display: flex;
        flex: none;
        flex-wrap: nowrap;
        white-space: nowrap;
        align-items: center;
        gap: var(--wt-space-3);
      }

      .operator {
        font-weight: var(--wt-font-weight-bold);
        display: inline-flex;
        align-items: center;
        gap: var(--wt-space-2);
      }

      .clock-dot {
        width: var(--wt-space-2);
        height: var(--wt-space-2);
        border-radius: var(--wt-radius-full);
        background: var(--wt-color-text-muted);
      }

      .clock-dot.working {
        background: var(--wt-color-success);
      }
      .clock-dot.on_break {
        background: var(--wt-color-warning);
      }

      .clock-message {
        white-space: normal;
        max-width: calc(var(--wt-tap-min) * 6);
      }

      .head.phone {
        gap: var(--wt-space-2);
        padding: var(--wt-space-2) var(--wt-space-3);
      }

      .head.phone .tabs {
        flex: 1;
      }

      .head.phone .tab {
        padding: var(--wt-space-2) var(--wt-space-3);
      }

      .head.phone .session {
        gap: var(--wt-space-2);
      }

      wt-row-actions > span {
        padding: var(--wt-space-2) var(--wt-space-4);
      }

      /* wt-row-actions keeps its popup 8px from each viewport edge; what does not fit scrolls. */
      wt-row-actions::part(popup) {
        max-height: calc(100dvh - 2 * var(--wt-space-2));
        overflow-y: auto;
      }

      .visually-hidden {
        ${visuallyHiddenStyles}
      }

      .region {
        position: relative;
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
      }

      .body {
        flex: 1;
        min-height: 0;
        overflow: auto;
      }

      /* Stands in for the bar, so the chooser sits where the bar's trailing end would put it. */
      .language-corner {
        padding: var(--wt-space-3) var(--wt-space-4);
      }

      .drill {
        position: absolute;
        inset: 0;
        overflow: auto;
        background: var(--wt-color-bg);
      }
    `,
  ];

  @property() formFactor: FormFactor = "till";
  @property() activeScreen?: BuiltInScreen;
  @property({ attribute: false }) counterZones: readonly { id: string; name: string }[] = [];
  @property() selectedCounterZoneId = "";
  @property({ type: Boolean }) showCounter = true;
  @property({ type: Boolean }) showFloor = true;
  @property({ type: Number }) parkedCount = 0;
  @property({ type: Number }) waitingCount = 0;
  @property({ attribute: false }) activeOrderList: "parked" | "waiting" | null = null;
  @property({ type: Boolean }) testingKitchen = false;
  @property() operatorName = "";
  @property({ attribute: false }) clockState: TillClockState | null = null;
  @property({ type: Boolean }) clockAvailable = false;
  @property({ type: Boolean }) hoursBusy = false;
  @property({ type: Boolean }) clockBusy = false;
  @property() clockError = "";
  @property({ attribute: false }) transferCount?: number;
  @property({ type: Boolean }) transferAvailable = false;
  @property({ attribute: false }) affordances: ShellAffordance[] = [];
  @property({ attribute: false }) loadLocales?: () => Promise<{ code: string; label: string }[]>;
  /** Suppresses the whole operator `<header>`: a kitchen display shows its board, no operator
   * chrome (owner decision 2026-09-04). */
  @property({ type: Boolean }) kiosk = false;
  /** The device is approved for more than one profile, so a signed-in person may switch it. */
  @property({ type: Boolean }) canSwitchProfile = false;

  @queryAssignedElements({ slot: "drill" }) private drillNodes!: HTMLElement[];

  @state() private phone = false;
  #phoneWidth?: MediaQueryList;
  readonly #onPhoneWidth = (event: MediaQueryListEvent) => {
    this.phone = event.matches;
  };

  override connectedCallback(): void {
    super.connectedCallback();
    this.#phoneWidth = window.matchMedia(PHONE_WIDTH);
    this.phone = this.#phoneWidth.matches;
    this.#phoneWidth.addEventListener("change", this.#onPhoneWidth);
    if (this.hasUpdated && this.formFactor !== "till") this.#observe();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#phoneWidth?.removeEventListener("change", this.#onPhoneWidth);
    this.#phoneWidth = undefined;
    this.#observer?.disconnect();
    this.#observer = undefined;
    this.#observedChooser = undefined;
    this.#run += 1;
  }

  /** With More closed and above phone width: 0, everything on the bar; 1, the name hidden; n, the
   * name hidden and the first n − 1 present items of `LEAVE_ORDER` in More. */
  @state() private steps = 0;
  /** A handheld at phone width whose bar does not fit with the language chooser: it moves to the
   * end of More. */
  @state() private chooserInMore = false;
  #run = 0;
  #stepBackOwed = false;
  #fittedWidth = 0;
  #fittedLocale?: string;
  #observer?: ResizeObserver;
  #observedChooser?: Element;
  #watchedPopup?: Element;
  #shown: ReadonlySet<BarItem> = new Set();
  #held?: ReadonlySet<BarItem>;
  readonly #onPopupToggle = () => {
    this.#release();
    if ((this.#stepBackOwed || this.phone) && !this.#menuOpen()) void this.#fit();
  };

  /** An open More can hold more than `steps` selects; once it has closed, above phone width, raise
   * `steps` to cover what it held, so closing it moves nothing back before the fit steps back. Runs before every
   * render as well as on the toggle event, because a render can come between closing and that
   * event. */
  #release(): void {
    const held = this.#held;
    if (held === undefined || this.#menuOpen()) return;
    this.#held = undefined;
    if (this.phone) return;
    const present = this.#present();
    const covering = Math.max(0, ...present.map((item, i) => (held.has(item) ? i + 2 : 0)));
    if (covering > this.steps) {
      this.steps = covering;
      this.#stepBackOwed = true;
    }
  }

  #present(): BarItem[] {
    const has: Record<BarItem, boolean> = {
      transfers: this.transferCount !== undefined || this.transferAvailable,
      "find-bill": false,
      station: this.affordances.includes("station"),
      expo: this.affordances.includes("expo"),
      schedule: this.affordances.includes("schedule"),
      profile: this.canSwitchProfile,
      equipment: true,
      operator: true,
    };
    return LEAVE_ORDER.filter((item) => has[item]);
  }

  /** While More is open no item moves from it to the bar: what it showed stays, whatever `steps`
   * now selects. */
  #moved(): ReadonlySet<BarItem> {
    const present = this.#present();
    const fitted = this.phone ? present : present.slice(0, Math.max(0, this.steps - 1));
    const moved = new Set(
      this.#menuOpen()
        ? present.filter((item) => fitted.includes(item) || this.#shown.has(item))
        : fitted,
    );
    if (this.affordances.includes("find-bill")) moved.add("find-bill");
    return moved;
  }

  override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    if (!this.phone) this.chooserInMore = false;
    if (this.formFactor !== "till") this.#release();
  }

  override updated(changed: PropertyValues): void {
    super.updated(changed);
    if (this.formFactor === "till") return;
    this.#observe();
    const contentChanged = CONTENT_PROPERTIES.some((key) => changed.has(key));
    if (contentChanged || currentLocale() !== this.#fittedLocale) {
      this.#stepBackOwed = true;
      void this.#fit();
    } else if (changed.has("transferCount")) {
      void this.#fit();
    }
  }

  /** Observes the host, not the header: its width comes from its container, so a fit does not
   * resize it ("reports no ResizeObserver loop", till-shell.test.ts). The chooser is observed
   * because its label can change once its language list loads. */
  #observe(): void {
    if (this.#observer === undefined) {
      this.#observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.target === this) {
            if (entry.contentRect.width > this.#fittedWidth) this.#stepBackOwed = true;
            this.#fittedWidth = entry.contentRect.width;
          } else {
            this.#stepBackOwed = true;
          }
        }
        void this.#fit();
      });
      this.#observer.observe(this);
    }
    const chooser = this.renderRoot.querySelector(".session > wt-language-chooser") ?? undefined;
    if (chooser !== this.#observedChooser) {
      if (this.#observedChooser) this.#observer.unobserve(this.#observedChooser);
      if (chooser) this.#observer.observe(chooser);
      this.#observedChooser = chooser;
    }
    const popup = this.#popup();
    if (popup !== this.#watchedPopup) {
      this.#watchedPopup?.removeEventListener("toggle", this.#onPopupToggle);
      popup?.addEventListener("toggle", this.#onPopupToggle);
      this.#watchedPopup = popup;
    }
  }

  #popup(): Element | undefined {
    return (
      this.renderRoot
        .querySelector('wt-row-actions[data-test="more-menu"]')
        ?.shadowRoot?.querySelector("[popover]") ?? undefined
    );
  }

  #menuOpen(): boolean {
    return this.#popup()?.matches(":popover-open") ?? false;
  }

  /** Resolves once this element and the Lit elements in its bar have rendered. */
  async #settled(): Promise<void> {
    await this.updateComplete;
    const children = this.renderRoot.querySelectorAll(
      ".head wt-button, .head wt-row-actions, .head wt-language-chooser, .head wt-count-badge, .head wt-help-switch",
    );
    await Promise.all([...children].map((child) => (child as Partial<LitElement>).updateComplete));
  }

  #wraps(): boolean {
    const head = this.renderRoot.querySelector<HTMLElement>(".head");
    const tabs = this.renderRoot.querySelector<HTMLElement>(".head .tabs");
    if (!head || !tabs) return false;
    return head.scrollWidth > head.clientWidth || tabs.scrollWidth > tabs.clientWidth;
  }

  /** Adds steps while the bar wraps. Takes steps away only when `#stepBackOwed`, and never while
   * More is open, which would rebuild it under the finger; the owed step-back runs when it closes. */
  async #fit(): Promise<void> {
    const run = ++this.#run;
    await this.#settled();
    if (run !== this.#run || this.formFactor === "till" || this.kiosk || !this.isConnected) return;
    this.#fittedLocale = currentLocale();
    const stale = async (): Promise<boolean> => {
      await this.#settled();
      return run !== this.#run;
    };
    if (this.phone) {
      // More draws its popup after the shell has rendered, so its toggle listener is attached here.
      this.#observe();
      if (this.#menuOpen()) return;
      if (this.#stepBackOwed && this.chooserInMore) {
        this.chooserInMore = false;
        if (await stale()) return;
      }
      this.#stepBackOwed = false;
      if (this.#wraps()) this.chooserInMore = true;
      return;
    }
    if (this.#stepBackOwed && !this.#menuOpen()) {
      // Still owed until it finishes: a newer fit, which may owe none of its own (after a
      // `transferCount` change), finishes it instead.
      while (this.steps > 0) {
        this.steps -= 1;
        if (await stale()) return;
        if (this.#wraps()) {
          this.steps += 1;
          if (await stale()) return;
          break;
        }
      }
      this.#stepBackOwed = false;
    }
    const most = this.#present().length + 1;
    while (this.#wraps() && this.steps < most) {
      this.steps += 1;
      if (await stale()) return;
    }
  }

  #emit(type: string, detail?: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  #chooser(layout: "menu" | "group" = "menu"): TemplateResult | typeof nothing {
    return this.loadLocales !== undefined
      ? html`<wt-language-chooser
          layout=${layout}
          label=${t("shell.language")}
          active=${currentLocale()}
          .loadLocales=${this.loadLocales}
        ></wt-language-chooser>`
      : nothing;
  }

  #helpSwitch(): TemplateResult {
    return html`<wt-help-switch
      data-test="help-switch"
      label=${helpText("help.label")}
    ></wt-help-switch>`;
  }

  #transferText(): string {
    return this.transferCount === undefined
      ? ""
      : t("department_transfer.open").replace("{count}", String(this.transferCount));
  }

  /** While the transfers are in More the visible count sits in the closed menu, out of the
   * accessibility tree, so this region is the one a screen reader hears. */
  #transferStatus(): TemplateResult {
    return html`<span class="visually-hidden" role="status" data-test="department-transfers-status"
      >${this.#transferText()}</span
    >`;
  }

  /** The bar's items in the bar's order, those in More when `inMore`, else those on the bar. */
  #items(moved: ReadonlySet<BarItem>, inMore: boolean): TemplateResult {
    const variant: ActionVariant = inMore ? "ghost" : "secondary";
    const here = (item: BarItem) => moved.has(item) === inMore;
    const button = (
      cls: string | typeof nothing,
      type: string,
      label: string,
      opensTransfers = false,
    ): TemplateResult =>
      html`<wt-button
        class=${cls}
        ?data-open-transfers=${opensTransfers}
        variant=${variant}
        align=${inMore ? "start" : nothing}
        @click=${() => this.#emit(type)}
        >${label}</wt-button
      >`;
    const affordance = (item: ShellAffordance & BarItem, type: string, label: string) =>
      here(item) && this.affordances.includes(item) ? button(item, type, label) : nothing;
    return html`${affordance("find-bill", "find-bill", t("find_bill.open"))}${affordance(
      "expo",
      "show-expo",
      t("expo.open"),
    )}${affordance("station", "show-station", t("station.open"))}${affordance(
      "schedule",
      "show-schedule",
      t("schedule.open"),
    )}${
      here("profile") && this.canSwitchProfile
        ? button("profile", "open-profile", t("profile.open"))
        : nothing
    }${here("equipment") ? button("equipment", "open-equipment", t("equipment.open")) : nothing}${
      here("transfers") && this.transferCount !== undefined
        ? html`<span data-test="department-transfers" role=${inMore ? nothing : "status"}
            >${this.#transferText()}</span
          >`
        : nothing
    }${
      here("transfers") && this.transferAvailable
        ? button(nothing, "open-transfers", t("department_transfer.short"), true)
        : nothing
    }`;
  }

  #operatorAndLogout(variant: ActionVariant): TemplateResult {
    if (variant === "ghost") return html`${this.#operatorName()}${this.#operatorActions(variant)}`;
    return html`<wt-row-actions
      class="operator-menu"
      align="end"
      label=${`${this.operatorName}${this.clockAvailable ? `: ${this.#clockLabel()}` : ""}`}
    >
      <span slot="trigger">${this.#operatorName()}</span>
      ${this.#operatorActions(variant, this.formFactor !== "till")}
    </wt-row-actions>`;
  }

  #clockLabel(): string {
    if (this.clockState === null) return t("clock.unknown");
    return t(
      this.clockState.state === "working"
        ? "clock.working"
        : this.clockState.state === "on_break"
          ? "clock.on_break"
          : "clock.clocked_out",
    );
  }

  #operatorName(): TemplateResult {
    return html`<span class="operator"
      ><span class="operator-label">${this.operatorName}</span>${
        this.clockAvailable
          ? html` ${this.clockState?.state === "out" ? nothing : html`<span class=${`clock-dot ${this.clockState?.state ?? "unknown"}`} aria-hidden="true"></span>`}
              <span class="visually-hidden" data-clock-state>${this.#clockLabel()}</span>`
          : nothing
      }</span
    >`;
  }

  #operatorActions(variant: ActionVariant, logout = true): TemplateResult {
    const state = this.clockState;
    const foreign =
      state !== null &&
      state.activeLocationId !== null &&
      state.activeLocationId !== state.locationId;
    const disabled = this.clockBusy || state === null || foreign;
    const action = (kind: TillClockAction, label: string) =>
      html`<wt-button
        data-clock-action=${kind}
        variant=${disabled ? "secondary" : "primary"}
        align="start"
        .disabled=${disabled}
        @click=${() => this.#emit("clock-action", { action: kind })}
        >${label}</wt-button
      >`;
    return html`${
      this.clockAvailable
        ? html`
            ${this.clockError ? html`<span class="clock-message" role="status">${this.clockError}</span>` : nothing}
            ${foreign ? html`<span class="clock-message">${t("clock.other_location")}</span>` : nothing}
            ${
              state === null
                ? html`<wt-button
                    data-clock-retry
                    variant="secondary"
                    align="start"
                    .disabled=${this.clockBusy}
                    @click=${() => this.#emit("retry-clock-read")}
                    >${t("clock.retry")}</wt-button
                  >`
                : state.state === "out"
                  ? action("in", t("clock.in"))
                  : html` ${state.state === "working" ? action("break-start", t("clock.break_start")) : action("break-end", t("clock.break_end"))}
                    ${action("out", t("clock.out"))}`
            }
            <wt-button
              data-my-hours
              variant="secondary"
              align="start"
              .disabled=${this.hoursBusy}
              @click=${() => this.#emit("my-hours")}
              >${t("hours.mine")}</wt-button
            >
            <wt-button
              data-fix-hours
              variant="secondary"
              align="start"
              .disabled=${this.hoursBusy}
              @click=${() => this.#emit("fix-my-hours")}
              >${t("attendance.fix_hours")}</wt-button
            >
          `
        : nothing
    }${
      logout
        ? html`<wt-button
            class="logout"
            variant=${variant}
            align=${variant === "ghost" ? "start" : nothing}
            @click=${() => this.#emit("logout")}
            >${t("shell.logout")}</wt-button
          >`
        : nothing
    }${themeChoices({
      active: currentThemeChoice(),
      labels: themeLabels(),
      onPick: (choice) => this.#emit(THEME_SELECTED_EVENT, { choice }),
    })}`;
  }

  #menu(moved: ReadonlySet<BarItem>): TemplateResult {
    const pending =
      moved.has("transfers") && this.transferCount !== undefined && this.transferCount > 0;
    return html`<wt-row-actions
      icon="hamburger"
      align="end"
      data-test="more-menu"
      .iconSize=${"lg"}
      label=${
        pending
          ? countText(this.transferCount!, "shell.more_transfers", "shell.more_transfers_one")
          : t("shell.more")
      }
    >
      ${
        pending
          ? html`<wt-count-badge
              slot="badge"
              tone="warning"
              .count=${this.transferCount!}
            ></wt-count-badge>`
          : nothing
      }
      ${this.#items(moved, true)}
      ${this.formFactor === "till" ? html`<wt-button class="settings" variant="ghost" align="start" @click=${() => this.#emit("open-settings")}>${t("device_zones.settings")}</wt-button>` : nothing}
      ${moved.has("operator") ? this.#operatorAndLogout("ghost") : nothing}
      ${this.chooserInMore ? this.#chooser("group") : nothing}
    </wt-row-actions>`;
  }

  #tillMenu(): TemplateResult {
    const action = (cls: string, event: string, label: string) =>
      html`<wt-button class=${cls} variant="ghost" align="start" @click=${() => this.#emit(event)}
        >${label}</wt-button
      >`;
    return html`<wt-row-actions
      icon="hamburger"
      align="end"
      data-test="more-menu"
      .iconSize=${"lg"}
      label=${t("shell.more")}
    >
      ${this.affordances.includes("find-bill") ? action("find-bill", "find-bill", t("find_bill.open")) : nothing}
      ${this.affordances.includes("schedule") ? action("schedule", "show-schedule", t("schedule.open")) : nothing}
      ${this.canSwitchProfile ? action("profile", "open-profile", t("profile.open")) : nothing}
      ${this.#chooser("group")} ${action("settings", "open-settings", t("device_zones.settings"))}
      ${action("logout", "logout", t("shell.logout"))}
      ${
        this.testingKitchen && this.affordances.includes("station")
          ? html`<details data-testing>
              <summary>${t("shell.testing")}</summary>
              ${action("station", "show-station", t("station.open"))}
            </details>`
          : nothing
      }
    </wt-row-actions>`;
  }

  #counterOrders(kind: "parked" | "waiting", count: number): TemplateResult {
    return html`<button
      type="button"
      class="bar-action"
      data-counter-orders=${kind}
      ?data-attention=${kind === "waiting" && count > 0}
      aria-pressed=${resolveBuiltInScreen(this.formFactor, this.activeScreen ?? null) === "counter" && this.activeOrderList === kind ? "true" : "false"}
      @click=${() => this.#emit("show-counter-orders", { kind })}
    >
      <span role=${kind === "waiting" ? "status" : nothing}
        >${t(kind === "parked" ? "shell.parked" : "shell.waiting")} <span>${count}</span></span
      >
    </button>`;
  }

  #screenTitle(screen: BuiltInScreen): string {
    return screen === "kitchen" ? "" : t(`tab.${screen}`);
  }

  #primaryTabs(
    screens: readonly BuiltInScreen[],
    activeScreen: BuiltInScreen | undefined,
    counterMenu: boolean,
    counterLabel: string,
  ): TemplateResult {
    return html` <nav class="tabs" role=${counterMenu ? nothing : "tablist"}>
      ${screens.map((screen) =>
        screen === "counter" && this.counterZones.length > 1
          ? html`<wt-row-actions
              data-counter-zones
              ?data-active=${screen === activeScreen}
              label=${counterLabel}
            >
              <span slot="trigger">${`${counterLabel} ▾`}</span>
              <div role="menu">
                ${this.counterZones.map(
                  (zone) =>
                    html`<button
                      type="button"
                      role="menuitemradio"
                      data-counter-zone=${zone.id}
                      aria-checked=${zone.id === this.selectedCounterZoneId ? "true" : "false"}
                      @click=${() => this.#emit("counter-zone-selected", { zoneId: zone.id })}
                    >
                      <span class="zone-check" aria-hidden="true"
                        >${zone.id === this.selectedCounterZoneId ? "✓" : ""}</span
                      >${zone.name}
                    </button>`,
                )}
              </div>
            </wt-row-actions>`
          : html`
              <button
                type="button"
                class="tab"
                role=${counterMenu ? nothing : "tab"}
                aria-selected=${counterMenu ? nothing : screen === activeScreen ? "true" : "false"}
                aria-pressed=${counterMenu ? (screen === activeScreen ? "true" : "false") : nothing}
                @click=${() => this.#emit("screen-select", { screen })}
              >
                ${this.#screenTitle(screen)}
              </button>
            `,
      )}
    </nav>`;
  }

  override render(): TemplateResult {
    const hasDrill = this.drillNodes?.length > 0;
    const moved = this.#moved();
    this.#shown = moved;
    if (this.#menuOpen()) this.#held = moved;
    const screens = builtInScreensFor(this.formFactor).filter(
      (screen) =>
        this.formFactor !== "till" || (screen === "counter" ? this.showCounter : this.showFloor),
    );
    const requestedScreen = resolveBuiltInScreen(this.formFactor, this.activeScreen ?? null);
    const activeScreen = screens.find((screen) => screen === requestedScreen) ?? screens[0];
    const counterMenu =
      this.formFactor === "till" && this.showCounter && this.counterZones.length > 1;
    const counterLabel = `${t("tab.counter")}: ${this.counterZones.find((zone) => zone.id === this.selectedCounterZoneId)?.name ?? ""}`;
    return html`
      <div class="shell">
        ${
          this.kiosk || this.formFactor === "kds"
            ? this.loadLocales !== undefined
              ? html`<div class="language-corner">${themeChooser()}${this.#chooser()}</div>`
              : nothing
            : html`
                <header class=${this.phone ? "head phone" : "head"}>
                  ${this.formFactor === "till" || this.steps > 0 || this.phone || [...moved].some((item) => item !== "find-bill") ? nothing : html`<span class="brand">${BRAND}</span>`}
                  ${
                    this.formFactor === "till"
                      ? html`<div class="till-strip">
                          ${this.#primaryTabs(screens, activeScreen, counterMenu, counterLabel)}
                          ${this.showCounter ? html`${this.#counterOrders("parked", this.parkedCount)}${this.#counterOrders("waiting", this.waitingCount)}` : nothing}
                          ${this.transferAvailable ? html`<wt-button data-open-transfers variant="secondary" @click=${() => this.#emit("open-transfers")}>${t("department_transfer.short")}${this.transferCount === undefined ? nothing : html` <span role="status" data-test="department-transfers" aria-label=${this.#transferText()}>${this.transferCount}</span>`}</wt-button>` : nothing}
                          ${this.affordances.includes("expo") ? html`<wt-button class="expo" variant="secondary" @click=${() => this.#emit("show-expo")}>${t("expo.open")}</wt-button>` : nothing}
                        </div>`
                      : this.#primaryTabs(screens, activeScreen, counterMenu, counterLabel)
                  }
                  <div class="session">
                    ${this.formFactor === "till" ? html`${this.#helpSwitch()}${this.#operatorAndLogout("secondary")}${this.#tillMenu()}` : html`${this.#items(moved, false)}${this.chooserInMore ? nothing : this.#chooser()}${this.#helpSwitch()}${moved.has("operator") ? nothing : this.#operatorAndLogout("secondary")}${moved.size > 0 ? this.#menu(moved) : nothing}`}
                  </div>
                  ${this.formFactor !== "till" && (this.phone || moved.has("transfers")) ? this.#transferStatus() : nothing}
                </header>
              `
        }
        <div class="region">
          <main class="body" ?inert=${hasDrill}>
            <slot @slotchange=${() => this.requestUpdate()}></slot>
          </main>
          <div class="drill" ?hidden=${!hasDrill}>
            <slot name="drill" @slotchange=${() => this.requestUpdate()}></slot>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-shell": TillShell;
  }
}
