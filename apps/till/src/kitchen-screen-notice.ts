import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { t } from "./i18n/t.js";
import type { KitchenScreenKind, ResolvedKitchenScreen, TillApi } from "./api/client.js";

/** What a kitchen display shows in place of a queue. */
export type KitchenScreenNotice =
  { kind: "none" } | { kind: "unavailable"; screen: KitchenScreenKind };

/** The kind a kitchen display runs, or what it shows instead of a queue. */
export function kitchenDisplayScreen(
  screens: readonly ResolvedKitchenScreen[],
):
  | { kind: "station" }
  | { kind: "pass" }
  | { kind: "pass_monitor" }
  | { kind: "notice"; notice: KitchenScreenNotice } {
  const running = screens.find((screen) => screen.available);
  if (running !== undefined) return { kind: running.kind };
  const removed = screens[0];
  if (removed !== undefined)
    return { kind: "notice", notice: { kind: "unavailable", screen: removed.kind } };
  return { kind: "notice", notice: { kind: "none" } };
}

const SCREEN_NAME = {
  station: "kitchen_screen.station",
  pass: "kitchen_screen.pass",
  pass_monitor: "kitchen_screen.pass_monitor",
} as const;

export function kitchenScreenNoticeText(notice: KitchenScreenNotice): string {
  switch (notice.kind) {
    case "none":
      return t("kitchen_screen.none");
    case "unavailable":
      return t("kitchen_screen.unavailable").replace("{screen}", t(SCREEN_NAME[notice.screen]));
  }
}

/** "This station is no longer available: Deli", for a station or zone a narrowing took. */
export function lostSlotLine(slot: "station" | "zone", name: string): string {
  return t(slot === "station" ? "station.unavailable" : "zone.unavailable").replace(
    "{name}",
    () => name,
  );
}

/** The look of a "no longer available" line. */
export const unavailableStyles = css`
  .unavailable {
    margin: 0;
    padding: var(--wt-space-3);
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-md);
    color: var(--wt-color-text-muted);
  }
`;

const REFRESH_MS = 15_000;

/**
 * A kitchen display's notice in place of a queue. It reads the device's choice at the screens'
 * refresh pace and emits `kitchen-screen-changed` when the choice gives it something else to show,
 * so the app re-boots to it, or `device-unauthorized` when the device is refused. While it is still
 * on the page after emitting, as when that re-boot failed, a later read emits again.
 */
@customElement("till-kitchen-screen-notice")
export class TillKitchenScreenNotice extends LitElement {
  @property({ attribute: false }) api?: Pick<TillApi, "getDeviceIdentity">;
  @property({ attribute: false }) notice: KitchenScreenNotice = { kind: "none" };

  #timer?: ReturnType<typeof setInterval>;
  #request = 0;
  #applied = 0;
  /** Reads numbered up to here were sent before the last event, which answered them. */
  #answered = 0;

  /** Light DOM: the card host styles the notice. */
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#timer = setInterval(() => void this.#check(), REFRESH_MS);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearInterval(this.#timer);
  }

  async #check(): Promise<void> {
    if (this.api === undefined) return;
    const request = ++this.#request;
    let changed: boolean;
    try {
      const screen = kitchenDisplayScreen((await this.api.getDeviceIdentity()).kitchenScreens);
      changed = screen.kind !== "notice" || !sameNotice(screen.notice, this.notice);
    } catch (error) {
      if ((error as { code?: string } | null)?.code === "device.unauthorized")
        this.#answer(request, "device-unauthorized");
      return;
    }
    this.#answer(request, changed ? "kitchen-screen-changed" : undefined);
  }

  #answer(request: number, event?: "kitchen-screen-changed" | "device-unauthorized"): void {
    if (request <= this.#answered || !this.isConnected || request < this.#applied) return;
    this.#applied = request;
    if (event === undefined) return;
    this.#answered = this.#request;
    this.dispatchEvent(new CustomEvent(event, { bubbles: true, composed: true }));
  }

  override render() {
    return html`<p class="kitchen-screen-message">${kitchenScreenNoticeText(this.notice)}</p>
      ${
        this.notice.kind === "unavailable"
          ? html`<p data-choose-again>${t("kitchen_screen.choose_again")}</p>`
          : nothing
      }`;
  }
}

function sameNotice(a: KitchenScreenNotice, b: KitchenScreenNotice): boolean {
  return a.kind === b.kind && (a.kind === "none" || a.screen === (b as typeof a).screen);
}

declare global {
  interface HTMLElementTagNameMap {
    "till-kitchen-screen-notice": TillKitchenScreenNotice;
  }
}
