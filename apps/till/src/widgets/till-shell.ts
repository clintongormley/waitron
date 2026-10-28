import { LitElement, type PropertyValues, type TemplateResult, css, html, nothing } from "lit";
import { customElement, property, queryAssignedElements, state } from "lit/decorators.js";
import {
  THEME_SELECTED_EVENT,
  ThemeChoiceController,
  VENUE_LOGO_RETRY_MS,
  VenueLogoController,
  baseStyles,
  currentThemeChoice,
  themeChoices,
  reportVenueLogoFailure,
  reportVenueLogoLoaded,
  themeChoicesStyles,
  visuallyHiddenStyles,
  type VenueLogoState,
} from "@waitron/ui";
// `baseStyles` pulls `@waitron/ui`'s module graph, which registers `wt-button` as a side effect.
import { countText, currentLocale, t } from "../i18n/t.js";
import { type HelpKey, helpBadgeLabel, helpText } from "../i18n/help-strings.js";
import { LocaleChangeController } from "../state/locale-controller.js";
import type { FormFactor } from "../layout.js";
import {
  builtInScreensFor,
  resolveBuiltInScreen,
  type BuiltInScreen,
} from "../built-in-screens.js";
import type { TillClockState } from "../api/client.js";
import type { TillClockAction } from "../state/clocking.js";
import type { BarTable } from "../state/bar-tables.js";
import "@waitron/ui/src/components/wt-language-chooser.js";
import "@waitron/ui/src/components/wt-row-actions.js";
import "@waitron/ui/src/components/wt-count-badge.js";
import "@waitron/ui/src/components/wt-help-switch.js";
import "@waitron/ui/src/components/wt-menu-row.js";
import "@waitron/ui/src/components/wt-venue-logo.js";
import "@waitron/ui/src/components/wt-powered-by.js";
import { PHONE_WIDTH, languageChooserStyles } from "./language-chooser-styles.js";
import { themeChooser, themeLabels } from "./theme-chooser.js";
import "./guide-sheet.js";

/** The screens a tab names: a handheld draws no Order tab. */
type TabScreen = Exclude<BuiltInScreen, "order">;

/** The product WORDMARK: a fixed name, never translated UI copy. */
const BRAND = "Waitron";

export type ShellAffordance = "station" | "expo" | "schedule" | "find-bill";

/** Properties whose change owes a step-back, so may let the brand mark or the name come back to
 * the bar. A change of `transferCount` alone does not owe one. */
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
  "legalName",
  "barTables",
];

function logoKey(state: VenueLogoState): string {
  return state.kind === "logo"
    ? JSON.stringify([state.logo.light, state.logo.dark, state.failed])
    : state.kind;
}

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
    // No step back: the bar draws its logo only while no step is taken. An error is heard here
    // because a box failing a logo already reported failed changes no state that would refit.
    this.addEventListener("wt-logo-load", () => void this.#refit());
    this.addEventListener("wt-logo-error", () => void this.#refit());
    this.addEventListener("wt-guide-open", (event) =>
      this.#onGuideOpen(event as CustomEvent<{ href: string }>),
    );
  }

  /** The guide a help box's link asked for, shown over the till rather than in a new tab. */
  @state() private guideHref = "";
  #guideBadge?: HTMLElement;

  #onGuideOpen(event: CustomEvent<{ href: string }>): void {
    event.preventDefault();
    this.#guideBadge = event.composedPath()[0] as HTMLElement;
    this.guideHref = event.detail.href;
  }

  #onGuideClose(): void {
    this.guideHref = "";
    this.#guideBadge?.shadowRoot?.querySelector("button")?.focus();
    this.#guideBadge = undefined;
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

      .head > wt-venue-logo {
        flex: none;
      }
      /* Kept in the page so it keeps its loaded image and its own retry while it has no room. */
      .head > wt-venue-logo.counter-logo:not([data-room]) {
        position: absolute;
        visibility: hidden;
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
        animation: waiting-attention var(--wt-duration-pulse-slow) ease-in-out infinite;
      }
      @keyframes waiting-attention {
        50% {
          border-color: var(--wt-color-warning-pulse-dim);
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

      .tab,
      .bar-table {
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

      .tab:hover,
      .bar-table:hover {
        background: var(--wt-color-surface-raised);
      }

      .tab[aria-selected="true"],
      .tab[aria-pressed="true"],
      .bar-table[aria-selected="true"] {
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

      .head.phone .tab,
      .head.phone .bar-table {
        padding: var(--wt-space-2) var(--wt-space-3);
      }

      .head.phone .session {
        gap: var(--wt-space-2);
      }

      .settings-group {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
      }

      .settings-heading {
        padding: var(--wt-space-1) var(--wt-space-4);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }

      .menu-rule {
        align-self: stretch;
        margin: 0;
        border: 0;
        border-block-start: 1px solid var(--wt-color-border);
      }

      wt-row-actions > span {
        padding: var(--wt-space-2) var(--wt-space-4);
      }

      .powered-by {
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
  /** Names the venue's logo for a screen reader. */
  @property() legalName = "";
  @property({ attribute: false }) clockState: TillClockState | null = null;
  @property({ type: Boolean }) clockAvailable = false;
  @property({ type: Boolean }) hoursBusy = false;
  @property({ type: Boolean }) clockBusy = false;
  @property() clockError = "";
  @property({ attribute: false }) transferCount?: number;
  @property({ type: Boolean }) transferAvailable = false;
  @property({ attribute: false }) affordances: ShellAffordance[] = [];
  /** A handheld's table buttons, after Floor. */
  @property({ attribute: false }) barTables: readonly BarTable[] = [];
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
    if (this.hasUpdated && this.formFactor !== "till") {
      this.#observe();
      this.#retryHiddenLogo();
    }
    if (this.hasUpdated && this.formFactor === "till") this.#observeCounter();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#phoneWidth?.removeEventListener("change", this.#onPhoneWidth);
    this.#phoneWidth = undefined;
    this.#observer?.disconnect();
    this.#observer = undefined;
    this.#stripObserver?.disconnect();
    this.#stripObserver = undefined;
    this.#watchedStrip = undefined;
    this.#counterObserver?.disconnect();
    this.#counterTargets.clear();
    this.#run += 1;
    this.#counterRun += 1;
    this.#stopLogoRetry();
  }

  /** With More closed and above phone width: 0, the brand mark (the venue's logo, or the word) and
   * the name on the bar; 1, the brand mark hidden; 2, the brand mark hidden and the name in More. */
  @state() private steps = 0;
  @state() private counterLogoRoom = false;
  #run = 0;
  #counterRun = 0;
  #stepBackOwed = false;
  readonly #venueLogo = new VenueLogoController(this);
  // Compared in `updated`, not taken from the controller's `onChange`: a host coming back to the
  // page redraws a changed logo with no `onChange`.
  #drawnLogo?: string;
  #revealedBar?: string;
  #fittedWidth = 0;
  #fittedLocale?: string;
  #logoRetry?: ReturnType<typeof setTimeout>;
  #observer?: ResizeObserver;
  #stripObserver?: ResizeObserver;
  #counterObserver?: ResizeObserver;
  #counterTargets = new Set<Element>();
  #watchedStrip?: Element;
  #watchedPopup?: Element;
  #watchedZonePopup?: Element;
  #shownName = false;
  #heldName?: boolean;
  readonly #onPopupToggle = () => {
    this.#release();
    if (this.#menuOpen()) return;
    if (this.#stepBackOwed) void this.#fit();
  };
  readonly #onZonePopupToggle = () => void this.#measureCounterLogo();

  /** An open More can hold the name though `steps` puts it on the bar; once it has closed, above
   * phone width, raise `steps` to cover it, so closing it moves nothing back before the fit steps
   * back. Runs before every render as well as on the toggle event, because a render can come between
   * closing and that event. */
  #release(): void {
    const held = this.#heldName;
    if (held === undefined || this.#menuOpen()) return;
    this.#heldName = undefined;
    if (this.phone || !held || this.steps >= 2) return;
    this.steps = 2;
    this.#stepBackOwed = true;
  }

  /** On a handheld everything but the name is always in More. While More is open the name does not
   * move from it to the bar, whatever `steps` now selects. */
  #nameInMore(): boolean {
    return this.phone || this.steps >= 2 || (this.#menuOpen() && this.#shownName);
  }

  override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    if (this.formFactor !== "till") {
      this.counterLogoRoom = false;
      this.#release();
    }
  }

  override updated(changed: PropertyValues): void {
    super.updated(changed);
    if (this.formFactor === "till") {
      this.#observeCounter();
      void this.#measureCounterLogo();
      return;
    }
    this.#counterObserver?.disconnect();
    this.#counterTargets.clear();
    this.#observe();
    const logo = logoKey(this.#venueLogo.state);
    const logoChanged = logo !== this.#drawnLogo;
    this.#drawnLogo = logo;
    const contentChanged = CONTENT_PROPERTIES.some((key) => changed.has(key));
    if (contentChanged || logoChanged || currentLocale() !== this.#fittedLocale) {
      this.#stepBackOwed = true;
      void this.#fit();
    } else if (changed.has("transferCount")) {
      void this.#fit();
    }
    this.#retryHiddenLogo();
    if (changed.has("barTables")) void this.#revealSelectedTable();
  }

  /** Scrolls the strip, never the page, to show the selected table's button whenever the buttons
   * change, once the bar's own elements have drawn and so given the strip its width. */
  async #revealSelectedTable(): Promise<void> {
    const bar = JSON.stringify(this.barTables);
    if (bar === this.#revealedBar) return;
    this.#revealedBar = bar;
    const tableId = this.barTables.find((table) => table.current)?.tableId;
    if (tableId === undefined) return;
    await this.#settled();
    if (bar !== this.#revealedBar) return;
    // No button while the bar is not drawn (a kiosk, a kitchen screen); the strip's observer
    // reveals it once the strip is drawn.
    const button = this.renderRoot.querySelector<HTMLElement>(
      `[data-bar-table="${CSS.escape(tableId)}"]`,
    );
    if (!button) return;
    const strip = button.parentElement!;
    const box = button.getBoundingClientRect();
    const view = strip.getBoundingClientRect();
    if (box.left < view.left) strip.scrollLeft -= view.left - box.left;
    else if (box.right > view.right) strip.scrollLeft += box.right - view.right;
  }

  /** A failed logo's box retries only while it is on the page, so while the bar leaves the logo out
   * with at most one step taken it owes a step-back every `VENUE_LOGO_RETRY_MS`: at step 0 the box is
   * drawn again and asks for the image at once, and if that fails the fit takes step 1 again. Further
   * steps start no timer: the logo would not be drawn there even once loaded, and widening steps
   * back on its own. */
  #retryHiddenLogo(): void {
    const state = this.#venueLogo.state;
    const hidden =
      this.isConnected &&
      !this.phone &&
      this.steps <= 1 &&
      state.kind === "logo" &&
      state.failed &&
      this.renderRoot.querySelector(".head") !== null &&
      this.renderRoot.querySelector(".head > wt-venue-logo") === null;
    if (!hidden) this.#stopLogoRetry();
    else if (this.#logoRetry === undefined) {
      this.#logoRetry = setTimeout(() => {
        this.#logoRetry = undefined;
        this.#stepBackOwed = true;
        void this.#fit();
      }, VENUE_LOGO_RETRY_MS);
    }
  }

  #stopLogoRetry(): void {
    clearTimeout(this.#logoRetry);
    this.#logoRetry = undefined;
  }

  /** Observes the host, not the header: its width comes from its container, so a fit does not
   * resize it ("reports no ResizeObserver loop", till-shell.test.ts). */
  #observe(): void {
    if (this.#observer === undefined) {
      this.#observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.contentRect.width > this.#fittedWidth) this.#stepBackOwed = true;
          this.#fittedWidth = entry.contentRect.width;
        }
        void this.#fit();
      });
      this.#observer.observe(this);
    }
    this.#observeStrip();
    const popup = this.#popup();
    if (popup !== this.#watchedPopup) {
      this.#watchedPopup?.removeEventListener("toggle", this.#onPopupToggle);
      popup?.addEventListener("toggle", this.#onPopupToggle);
      this.#watchedPopup = popup;
    }
  }

  /** A strip that changes width can leave the selected table's button outside it, so its reveal
   * runs again then; a redraw at the same width leaves a person's own scroll alone. */
  #observeStrip(): void {
    const strip = this.renderRoot.querySelector(".head .tabs") ?? undefined;
    if (strip === this.#watchedStrip) return;
    this.#stripObserver ??= new ResizeObserver(() => {
      this.#revealedBar = undefined;
      void this.#revealSelectedTable();
    });
    if (this.#watchedStrip) this.#stripObserver.unobserve(this.#watchedStrip);
    if (strip) this.#stripObserver.observe(strip);
    this.#watchedStrip = strip;
  }

  /** The strip itself is not observed: its width is what the logo changes. Only targets new since
   * the last render are observed, since each new observation reports once, and one made while
   * notifications are being delivered is a ResizeObserver loop. */
  #observeCounter(): void {
    this.#counterObserver ??= new ResizeObserver(() => void this.#measureCounterLogo());
    const targets = new Set<Element>([
      this,
      ...this.renderRoot.querySelectorAll(
        ".head > .counter-logo, .head > .session, .till-strip > *",
      ),
    ]);
    for (const target of this.#counterTargets)
      if (!targets.has(target)) this.#counterObserver.unobserve(target);
    for (const target of targets)
      if (!this.#counterTargets.has(target)) this.#counterObserver.observe(target);
    this.#counterTargets = targets;
    const zonePopup = this.#zonePopup();
    if (zonePopup !== this.#watchedZonePopup) {
      this.#watchedZonePopup?.removeEventListener("toggle", this.#onZonePopupToggle);
      zonePopup?.addEventListener("toggle", this.#onZonePopupToggle);
      this.#watchedZonePopup = zonePopup;
    }
  }

  /** Undefined on a bar with one zone, which has no zone menu. */
  #zonePopup(): Element | undefined {
    return (
      this.renderRoot
        .querySelector("wt-row-actions[data-counter-zones]")
        ?.shadowRoot?.querySelector("[popover]") ?? undefined
    );
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
      ".head wt-button, .head wt-row-actions, .head wt-language-chooser, .head wt-count-badge, .head wt-help-switch, .head wt-venue-logo",
    );
    await Promise.all([...children].map((child) => (child as Partial<LitElement>).updateComplete));
  }

  #refit(): Promise<void> {
    return this.formFactor === "till" ? this.#measureCounterLogo() : this.#fit();
  }

  /** The strip's width is taken as it would be with the logo in the row. A box still loading, or
   * failed, is 0 px wide and so never has room. */
  async #measureCounterLogo(): Promise<void> {
    const run = ++this.#counterRun;
    await this.#settled();
    if (run !== this.#counterRun || this.formFactor !== "till" || !this.isConnected) return;
    // The open zone menu's popup stays where it opened, so its trigger must not move under it.
    if (this.#zonePopup()?.matches(":popover-open")) return;
    const head = this.renderRoot.querySelector<HTMLElement>(".head");
    const strip = head?.querySelector<HTMLElement>(".till-strip");
    const box = head?.querySelector<HTMLElement>(":scope > wt-venue-logo.counter-logo");
    if (!head || !strip || !box) {
      this.counterLogoRoom = false;
      return;
    }
    const logoWidth = box.getBoundingClientRect().width;
    const gap = parseFloat(getComputedStyle(head).columnGap) || 0;
    const rects = [...strip.children].map((child) => child.getBoundingClientRect());
    const content =
      rects.length === 0
        ? 0
        : Math.max(...rects.map((r) => r.right)) - Math.min(...rects.map((r) => r.left));
    const stripWidth =
      strip.getBoundingClientRect().width + (box.hasAttribute("data-room") ? logoWidth + gap : 0);
    this.counterLogoRoom = logoWidth > 0 && content + logoWidth + gap <= stripWidth;
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
      if (!this.#menuOpen()) this.#stepBackOwed = false;
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
    while (this.#wraps() && this.steps < 2) {
      this.steps += 1;
      if (await stale()) return;
    }
  }

  #brandMark(): TemplateResult {
    const state = this.#venueLogo.state;
    if (state.kind === "waiting") return html`<wt-venue-logo size="bar"></wt-venue-logo>`;
    if (state.kind === "none") return html`<span class="brand">${BRAND}</span>`;
    const { logo } = state;
    return html`<wt-venue-logo
      size="bar"
      light=${logo.light}
      dark=${logo.dark ?? nothing}
      alt=${this.legalName}
      @wt-logo-error=${() => reportVenueLogoFailure(logo)}
      @wt-logo-load=${() => reportVenueLogoLoaded(logo)}
      ><span class="brand" slot="fallback">${BRAND}</span></wt-venue-logo
    >`;
  }

  #counterLogo(): TemplateResult | typeof nothing {
    const state = this.#venueLogo.state;
    if (state.kind !== "logo") return nothing;
    const { logo } = state;
    return html`<wt-venue-logo
      class="counter-logo"
      size="bar"
      light=${logo.light}
      dark=${logo.dark ?? nothing}
      alt=${this.legalName}
      ?data-room=${this.counterLogoRoom}
      @wt-logo-error=${() => reportVenueLogoFailure(logo)}
      @wt-logo-load=${() => reportVenueLogoLoaded(logo)}
    ></wt-venue-logo>`;
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

  /** A menu option with its help badge beside it; `help` is undefined for an option without one. */
  #withHelp(option: TemplateResult, help: HelpKey | undefined, label: string): TemplateResult {
    return help === undefined
      ? option
      : html`<wt-menu-row help=${helpText(help)} help-label=${helpBadgeLabel(label)}
          >${option}</wt-menu-row
        >`;
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

  /** A handheld's More entries for the screens and settings. */
  #items(): Record<
    | "find-bill"
    | "expo"
    | "station"
    | "schedule"
    | "profile"
    | "zones"
    | "equipment"
    | "transfer-count"
    | "transfer-button",
    TemplateResult | typeof nothing
  > {
    const button = (
      cls: string | typeof nothing,
      type: string,
      label: string,
      help?: HelpKey,
      opensTransfers = false,
    ): TemplateResult =>
      this.#withHelp(
        html`<wt-button
          class=${cls}
          ?data-open-transfers=${opensTransfers}
          variant="ghost"
          align="start"
          @click=${() => this.#emit(type)}
          >${label}</wt-button
        >`,
        help,
        label,
      );
    const affordance = (item: ShellAffordance, type: string, label: string, help?: HelpKey) =>
      this.affordances.includes(item) ? button(item, type, label, help) : nothing;
    return {
      "find-bill": affordance("find-bill", "find-bill", t("find_bill.open")),
      expo: affordance("expo", "show-expo", t("expo.open"), "help.more.pass"),
      station: affordance("station", "show-station", t("station.open")),
      schedule: affordance("schedule", "show-schedule", t("schedule.open")),
      profile: this.canSwitchProfile
        ? button("profile", "open-profile", t("profile.open"), "help.more.profile")
        : nothing,
      zones: button("zones", "open-device-zones", t("device_zones.title"), "help.more.zones"),
      equipment: button("equipment", "open-equipment", t("equipment.open"), "help.more.equipment"),
      "transfer-count":
        this.transferCount !== undefined
          ? html`<span data-test="department-transfers">${this.#transferText()}</span>`
          : nothing,
      "transfer-button": this.transferAvailable
        ? button(
            nothing,
            "open-transfers",
            t("department_transfer.short"),
            "help.more.transfers",
            true,
          )
        : nothing,
    };
  }

  /** The name and its menu on the bar. A handheld's Theme and Log out are in More instead, so
   * without the clock its menu would be empty and the name is drawn alone. */
  #operatorMenu(): TemplateResult {
    if (this.formFactor !== "till" && !this.clockAvailable) return this.#operatorName();
    return html`<wt-row-actions
      class="operator-menu"
      align="end"
      label=${`${this.operatorName}${this.clockAvailable ? `: ${this.#clockLabel()}` : ""}`}
    >
      <span slot="trigger">${this.#operatorName()}</span>
      ${this.#operatorActions(this.formFactor === "till")}
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

  #operatorActions(theme: boolean): TemplateResult {
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
            ${this.#withHelp(
              html`<wt-button
                data-fix-hours
                variant="secondary"
                align="start"
                .disabled=${this.hoursBusy}
                @click=${() => this.#emit("fix-my-hours")}
                >${t("attendance.fix_hours")}</wt-button
              >`,
              "help.person.fix_hours",
              t("attendance.fix_hours"),
            )}
          `
        : nothing
    }${theme ? this.#themeChoices() : nothing}`;
  }

  #themeChoices(): TemplateResult {
    return themeChoices({
      active: currentThemeChoice(),
      labels: themeLabels(),
      onPick: (choice) => this.#emit(THEME_SELECTED_EVENT, { choice }),
    });
  }

  /** A handheld's More, in the design's order: the name's group, the screens, Settings, Log out,
   * then Powered by while a venue logo is in use. */
  #menu(nameInMore: boolean): TemplateResult {
    const items = this.#items();
    const screens = [
      items.expo,
      items.station,
      items["find-bill"],
      items.schedule,
      items.profile,
      items["transfer-count"],
      items["transfer-button"],
    ];
    const pending = this.transferCount !== undefined && this.transferCount > 0;
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
      ${
        nameInMore
          ? html`${this.#operatorName()}${this.#operatorActions(false)}
              <hr class="menu-rule" />`
          : nothing
      }
      ${
        screens.some((screen) => screen !== nothing)
          ? html`${screens}
              <hr class="menu-rule" />`
          : nothing
      }
      <div class="settings-group" role="group" aria-labelledby="settings-heading">
        <span id="settings-heading" class="settings-heading">${t("device_zones.settings")}</span>
        ${items.zones}${items.equipment}${this.#chooser("group")}${this.#themeChoices()}
      </div>
      <hr class="menu-rule" />
      <wt-button class="logout" variant="ghost" align="start" @click=${() => this.#emit("logout")}
        >${t("shell.logout")}</wt-button
      >
      ${this.#poweredBy()}
    </wt-row-actions>`;
  }

  #poweredBy(): TemplateResult | typeof nothing {
    const state = this.#venueLogo.state;
    return state.kind === "logo" && !state.failed
      ? html`<hr class="menu-rule" />
          <wt-powered-by class="powered-by" label=${t("login.powered_by")}></wt-powered-by>`
      : nothing;
  }

  #tillMenu(): TemplateResult {
    const action = (cls: string, event: string, label: string, help?: HelpKey) =>
      this.#withHelp(
        html`<wt-button class=${cls} variant="ghost" align="start" @click=${() => this.#emit(event)}
          >${label}</wt-button
        >`,
        help,
        label,
      );
    return html`<wt-row-actions
      icon="hamburger"
      align="end"
      data-test="more-menu"
      .iconSize=${"lg"}
      label=${t("shell.more")}
    >
      ${this.affordances.includes("find-bill") ? action("find-bill", "find-bill", t("find_bill.open")) : nothing}
      ${this.affordances.includes("schedule") ? action("schedule", "show-schedule", t("schedule.open")) : nothing}
      ${this.canSwitchProfile ? action("profile", "open-profile", t("profile.open"), "help.more.profile") : nothing}
      ${this.#chooser("group")}
      ${action("settings", "open-settings", t("device_zones.settings"), "help.more.settings")}
      ${action("logout", "logout", t("shell.logout"))}
      ${
        this.testingKitchen && this.affordances.includes("station")
          ? html`<details data-testing>
              <summary>${t("shell.testing")}</summary>
              ${action("station", "show-station", t("station.open"))}
            </details>`
          : nothing
      }
      ${this.#poweredBy()}
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

  #screenTitle(screen: TabScreen): string {
    return screen === "kitchen" ? "" : t(`tab.${screen}`);
  }

  #barTable(table: BarTable): TemplateResult {
    return html`<button
      type="button"
      class="bar-table"
      role="tab"
      data-bar-table=${table.tableId}
      aria-selected=${table.current ? "true" : "false"}
      aria-label=${table.unsent ? t("shell.table_unsent").replace("{table}", () => table.name) : nothing}
      @click=${() => this.#emit("open-bar-table", { tableId: table.tableId, held: table.held })}
    >
      ${table.unsent ? html`<wt-icon name="floor-unsent" aria-hidden="true"></wt-icon>` : nothing}${table.name}
    </button>`;
  }

  #primaryTabs(
    screens: readonly TabScreen[],
    activeScreen: TabScreen | undefined,
    counterMenu: boolean,
    counterLabel: string,
  ): TemplateResult {
    const tables = this.formFactor === "till" ? [] : this.barTables;
    const tableOnScreen = tables.some((table) => table.current);
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
                aria-selected=${counterMenu ? nothing : screen === activeScreen && !tableOnScreen ? "true" : "false"}
                aria-pressed=${counterMenu ? (screen === activeScreen ? "true" : "false") : nothing}
                @click=${() => this.#emit("screen-select", { screen })}
              >
                ${this.#screenTitle(screen)}
              </button>
            `,
      )}
      ${tables.map((table) => this.#barTable(table))}
    </nav>`;
  }

  override render(): TemplateResult {
    const hasDrill = this.drillNodes?.length > 0;
    const nameInMore = this.#nameInMore();
    this.#shownName = nameInMore;
    if (this.#menuOpen()) this.#heldName = nameInMore;
    const screens = builtInScreensFor(this.formFactor).filter(
      (screen): screen is TabScreen =>
        screen !== "order" &&
        (this.formFactor !== "till" || (screen === "counter" ? this.showCounter : this.showFloor)),
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
                  ${this.formFactor === "till" ? this.#counterLogo() : this.steps > 0 || this.phone ? nothing : this.#brandMark()}
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
                    ${this.formFactor === "till" ? html`${this.#helpSwitch()}${this.#operatorMenu()}${this.#tillMenu()}` : html`${nameInMore ? nothing : this.#operatorMenu()}${this.#helpSwitch()}${this.#menu(nameInMore)}`}
                  </div>
                  ${this.formFactor !== "till" ? this.#transferStatus() : nothing}
                </header>
                <slot name="notices"></slot>
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
      <till-guide-sheet
        .href=${this.guideHref}
        @guide-close=${() => this.#onGuideClose()}
      ></till-guide-sheet>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "till-shell": TillShell;
  }
}
