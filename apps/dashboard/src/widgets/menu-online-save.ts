import {
  CUSTOMER_MENU_PHOTO_SIZES,
  isCustomerMenuAddress,
  type CustomerMenuAppearance,
  type CustomerMenuOnlineSettings,
  type CustomerMenuStyle,
  type CustomerMenuPhotoSize,
  type MenuStatus,
} from "@waitron/shared";
import {
  cardFrameStyles,
  draftScopeFor,
  FormFeedback,
  leaveCoordinatorFor,
  saveActionState,
  type DraftScope,
} from "@waitron/ui";
import "@waitron/ui/src/components/wt-switch.js";
import "@waitron/ui/src/components/wt-modal.js";
import "@waitron/ui/src/components/wt-disclosure.js";
import { printEquipmentLabel } from "@waitron/ui/src/print-label.js";
import { customerMenuLink, customerMenuPublicUrl } from "./customer-menu-link.js";
import type { CustomerMenuCloudStatus } from "../api/cloud-api.js";
import {
  css,
  html,
  nothing,
  type LitElement,
  type ReactiveController,
  type TemplateResult,
} from "lit";
import type { DirectiveResult } from "lit/directive.js";
import { toDataURL } from "qrcode";
import type { DashboardApi } from "../api/client.js";
import { codeMessage, codeOf, fieldOf } from "../i18n/codes.js";
import { fill, t } from "../i18n/t.js";

export const menuOnlineStyles = css`
  .online-editor {
    container: online-editor / inline-size;
  }
  .online-settings {
    display: grid;
    align-content: start;
    gap: var(--wt-space-4);
    padding-block: var(--wt-space-4);
    min-inline-size: 0;
  }
  .online-settings p {
    margin: 0;
  }
  .online-card,
  .online-appearance {
    display: grid;
    gap: var(--wt-space-3);
    min-inline-size: 0;
    ${cardFrameStyles}
  }
  .online-card wt-switch {
    --wt-switch-track-width: calc(var(--wt-space-6) + var(--wt-space-1));
  }
  .online-card wt-switch::part(label) {
    margin-inline-start: calc(-1 * var(--wt-space-1));
  }
  .online-address {
    display: grid;
    align-items: start;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--wt-space-2);
  }
  .online-address[data-host] {
    grid-template-columns: minmax(0, max-content) minmax(calc(2 * var(--wt-tap-min)), 1fr);
  }
  .online-address p {
    display: flex;
    align-items: center;
    min-block-size: var(--wt-field-height);
    padding-block: calc(var(--wt-space-3) + var(--wt-font-size-sm)) var(--wt-space-2);
    font-size: var(--wt-text-control-font-size);
    color: var(--wt-color-text-muted);
    overflow-wrap: anywhere;
  }
  .online-address wt-input {
    grid-column: 2;
    min-inline-size: 0;
  }
  .online-divider {
    margin: var(--wt-space-1) calc(-1 * var(--wt-space-4));
    border: 0;
    border-block-start: 1px solid var(--wt-color-border);
  }
  .online-copy-result[data-quiet] {
    position: absolute;
    clip-path: inset(50%);
  }
  .online-availability,
  .online-copy-result,
  .online-draft-hint,
  .online-embed p {
    color: var(--wt-color-text-muted);
  }
  .online-copy-result,
  .online-draft-hint {
    font-size: var(--wt-font-size-sm);
  }
  .online-availability {
    --wt-action-native-icon-color: var(--wt-color-text-muted);
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: start;
    gap: var(--wt-space-2);
  }
  .online-availability > wt-button {
    grid-column: 2;
    justify-self: start;
  }
  .online-sharing {
    display: grid;
    --qr-plate-size: calc(var(--wt-share-qr-size) + 2 * (var(--wt-space-3) + 1px));
    grid-template-columns: minmax(0, var(--qr-plate-size)) minmax(max-content, 1fr);
    align-items: center;
    gap: var(--wt-space-4);
  }
  .online-qr {
    overflow: clip;
    display: grid;
    align-items: center;
    aspect-ratio: 1;
    border: 1px solid var(--wt-color-border);
    border-radius: var(--wt-radius-md);
    background: var(--wt-color-paper);
    color: var(--wt-color-ink);
    font-size: var(--wt-font-size-sm);
  }
  .online-qr img {
    display: block;
    inline-size: 100%;
    scale: 1.0625;
    image-rendering: pixelated;
  }
  .online-share-actions,
  .online-embed {
    display: grid;
    gap: var(--wt-space-2);
  }
  :is(.online-share-actions, .online-embed) wt-button {
    --wt-action-icon-color: var(--wt-color-text-muted);
  }
  :is(.online-share-actions, .online-embed) wt-button[data-copied] {
    --wt-action-icon-color: var(--wt-color-success);
    --wt-action-border-color: var(--wt-color-border);
    --wt-action-hover: var(--wt-color-surface);
  }
  :is(.online-share-actions, .online-embed)
    wt-button:not([data-copied])::part(button):hover:enabled {
    --wt-action-icon-color: var(--wt-color-primary);
    border-color: var(--wt-color-primary);
    color: var(--wt-color-primary-text);
  }
  .online-embed pre {
    margin: 0;
    padding: var(--wt-space-3);
    border-radius: var(--wt-radius-md);
    background: var(--wt-color-field-fill);
    font: var(--wt-font-size-sm) var(--wt-font-family-mono);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .online-card wt-disclosure::part(section) {
    padding: 0;
  }
  .online-card wt-disclosure::part(header) {
    grid-template: auto auto / minmax(0, 1fr) auto;
    min-block-size: var(--wt-tap-min);
    align-content: center;
  }
  .online-card wt-disclosure::part(chevron) {
    grid-row: 1 / span 2;
    justify-self: end;
  }
  .online-embed {
    padding-block-start: var(--wt-space-3);
  }
  .online-embed > wt-button {
    justify-self: start;
    scroll-margin-block-end: calc(var(--wt-tap-min) + var(--wt-space-6) + var(--wt-space-1));
  }
  .online-live-link wt-icon {
    margin-inline-start: var(--wt-space-1);
    vertical-align: middle;
    --wt-action-native-icon-color: var(--wt-color-primary);
  }
  .online-settings a {
    text-underline-offset: calc(var(--wt-space-1) / 2);
    color: var(--wt-color-primary-text);
    overflow-wrap: anywhere;
  }
  .online-settings-status {
    display: grid;
    gap: var(--wt-space-2);
  }
  wt-segmented-control[name="customer-menu-photos"]::part(button) {
    padding-inline: var(--wt-space-3);
  }
  .online-workspace {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--wt-space-4);
  }
  .online-view {
    padding-block-start: var(--wt-space-3);
  }
  @container online-editor (inline-size <= 760px) {
    .online-workspace {
      gap: 0;
    }
    .online-workspace[data-view="preview"] .online-settings {
      padding-block-end: 0;
    }
    .online-workspace[data-view="preview"] .online-card {
      display: contents;
    }
    .online-workspace[data-view="settings"] dashboard-menu-online-preview,
    .online-workspace[data-view="preview"]
      .online-settings
      > :not(.online-card, .online-settings-status),
    .online-workspace[data-view="preview"] .online-card > :not(.online-availability),
    .online-workspace[data-view="preview"] .online-unpublished,
    .online-workspace[data-view="preview"] + wt-form-actions {
      display: none;
    }
  }
  @container online-editor (inline-size > 760px) {
    .online-workspace {
      grid-template-columns: minmax(min-content, 1fr) minmax(0, 2fr);
    }
    wt-segmented-control[name="customer-menu-photos"] {
      inline-size: max-content;
    }
    wt-segmented-control[name="customer-menu-photos"]::part(button) {
      min-inline-size: max-content;
      white-space: nowrap;
    }
    .online-appearance {
      min-inline-size: min-content;
    }
    .online-workspace > dashboard-menu-online-preview {
      --menu-preview-space: var(--wt-space-2);
    }
    .online-workspace:has(.online-unpublished) > dashboard-menu-online-preview {
      --menu-preview-unpublished-display: none;
    }
    .online-view {
      display: none;
    }
  }
`;

export interface CustomerStyleChange {
  action: "pick" | "copy" | "edit";
  styleId: string | null;
  style: CustomerMenuStyle;
}

type OnlineView = "settings" | "preview";
type CopyTarget = "link" | "embed";

export class MenuOnlineSave implements ReactiveController {
  #menuId: string | null = null;
  #generation = 0;
  #saved: CustomerMenuOnlineSettings | null = null;
  #pickedStyle?: { id: string | null; appearance: CustomerMenuAppearance };
  #scope?: DraftScope<boolean>;
  #refusal: unknown;
  #loadFailed = false;
  #confirming = false;
  #publicUrl: string | undefined;
  #qr?: string | null;
  #copyFeedback?: { target: CopyTarget; copied: boolean };
  #copyTimer?: number;
  #feedback: FormFeedback;
  pendingWrite?: Promise<void>;
  draft: CustomerMenuOnlineSettings | null = null;
  view: OnlineView = "preview";

  constructor(
    private readonly host: LitElement,
    private readonly api: () => DashboardApi,
    private readonly canOpenCloudServices: () => boolean,
  ) {
    this.#feedback = new FormFeedback(host);
    host.addController(this);
  }

  hostConnected(): void {
    this.#scope = draftScopeFor(this.host, {
      id: this,
      current: () => this.#dirty,
      snapshot: (dirty) => dirty,
      equal: (a, b) => a === b,
      restore: () => this.#restore(),
    }).scope;
    this.#scope.commit(false);
  }

  hostDisconnected(): void {
    this.#scope?.dispose();
    this.#scope = undefined;
    this.show(null);
  }

  get #dirty(): boolean {
    const { draft } = this;
    const saved = this.#saved;
    return (
      draft !== null &&
      saved !== null &&
      (draft.enabled !== saved.enabled ||
        draft.address !== saved.address ||
        draft.photos !== saved.photos ||
        draft.styleId !== saved.styleId)
    );
  }

  get #addressInvalid(): boolean {
    const { draft } = this;
    return (
      draft !== null &&
      (draft.address === null ? draft.enabled : !isCustomerMenuAddress(draft.address))
    );
  }

  get loading(): boolean {
    return this.draft === null && !this.#loadFailed;
  }

  #changed(): void {
    this.#scope?.changed();
    this.host.requestUpdate();
  }

  #restore(): void {
    this.draft = this.#saved;
    this.#refusal = undefined;
    this.#feedback.reset();
    this.#changed();
  }

  show(menuId: string | null): void {
    if (menuId === this.#menuId) return;
    this.#menuId = menuId;
    this.#generation++;
    this.pendingWrite = undefined;
    this.#saved = null;
    this.#pickedStyle = undefined;
    this.#confirming = false;
    this.#setPublicUrl(undefined);
    this.#loadFailed = false;
    this.view = "preview";
    this.#restore();
    if (menuId !== null) void this.#load(menuId);
  }

  async #load(menuId: string): Promise<void> {
    const generation = this.#generation;
    this.#loadFailed = false;
    this.host.requestUpdate();
    try {
      const api = this.api();
      const value = await (api.background ?? api).getCustomerOnlineSettings(menuId);
      if (generation !== this.#generation) return;
      this.#saved = value;
      this.#restore();
    } catch {
      if (generation !== this.#generation) return;
      this.#loadFailed = true;
      this.host.requestUpdate();
    }
  }

  get savedStyleId(): string | null | undefined {
    return this.#saved?.styleId;
  }

  get draftAppearance(): CustomerMenuAppearance | undefined {
    const id = this.draft?.styleId;
    return id !== this.savedStyleId && this.#pickedStyle?.id === id
      ? this.#pickedStyle?.appearance
      : undefined;
  }

  styleChanged({ action, styleId, style }: CustomerStyleChange): void {
    if (!this.draft || !this.#saved || this.pendingWrite) return;
    this.#pickedStyle = { id: styleId, appearance: style.appearance };
    if (action === "copy") this.#saved = { ...this.#saved, styleId };
    this.#edit({ styleId });
  }

  #edit(change: Partial<CustomerMenuOnlineSettings>): void {
    if (!this.draft || this.pendingWrite) return;
    this.draft = { ...this.draft, ...change };
    if ("address" in change || "enabled" in change) this.#feedback.dismiss("address");
    this.#feedback.dismiss("_form");
    this.#changed();
  }

  async #save(confirmLinkChange: boolean): Promise<void> {
    const menuId = this.#menuId;
    const { draft } = this;
    if (!menuId || !draft || saveActionState(this.#scope).unchanged || this.pendingWrite) return;
    this.#feedback.press("address", "_form");
    if (this.#addressInvalid) {
      this.view = "settings";
      await this.#focusAddress();
      return;
    }
    if (
      confirmLinkChange &&
      this.#saved?.enabled &&
      (!draft.enabled || draft.address !== this.#saved.address)
    ) {
      this.#confirming = true;
      this.host.requestUpdate();
      return;
    }
    const generation = this.#generation;
    const write = this.api().saveCustomerOnlineSettings(menuId, draft);
    this.pendingWrite = write.then(
      () => undefined,
      () => undefined,
    );
    this.host.requestUpdate();
    try {
      const saved = await write;
      if (generation !== this.#generation) return;
      this.#saved = saved;
      this.#restore();
      this.#scope?.commit(false);
    } catch (error) {
      if (generation !== this.#generation) return;
      this.#refusal = error;
      this.#feedback.newRefusal();
      if (fieldOf(error) === "address" || codeOf(error) === "customer_menu.not_published")
        this.view = "settings";
    } finally {
      if (generation === this.#generation) {
        this.pendingWrite = undefined;
        this.#changed();
      }
    }
    if (generation === this.#generation && this.#refusal && fieldOf(this.#refusal) === "address")
      await this.#focusAddress();
  }

  async #focusAddress(): Promise<void> {
    this.host.requestUpdate();
    const settings = this.host.renderRoot.querySelector(".online-settings");
    if (settings) await this.#feedback.focus(settings);
  }

  #cancel(): void {
    const leave = leaveCoordinatorFor(this.host);
    if (leave) void leave.request({ scopes: [this], reason: "navigation", proceed() {} });
    else this.#restore();
  }

  #addressError(): string {
    if (this.#addressInvalid && this.#feedback.attempted)
      return this.draft?.address === null
        ? t("customer_menu.address_required")
        : codeMessage("customer_menu.address_invalid");
    return this.#refusal && fieldOf(this.#refusal) === "address" && this.#feedback.shows("address")
      ? codeMessage(codeOf(this.#refusal))
      : "";
  }

  viewControl() {
    return html`<wt-segmented-control
      class="online-view"
      name="customer-menu-view"
      label=${t("customer_menu.online_view")}
      hide-label
      .options=${[
        { value: "settings", label: t("customer_menu.settings") },
        { value: "preview", label: t("menus.tab_preview") },
      ]}
      .value=${this.view}
      @wt-change=${(event: CustomEvent<{ value: OnlineView }>) => {
        event.stopPropagation();
        this.view = event.detail.value;
        this.host.requestUpdate();
      }}
    ></wt-segmented-control>`;
  }

  #availability(
    cloud: CustomerMenuCloudStatus | null,
    failed: boolean,
    retry: () => void,
    unpublished: boolean,
    preview: TemplateResult,
  ) {
    const message = unpublished
      ? html`${t("customer_menu.unpublished")} ${preview}`
      : failed
        ? t("customer_menu.status_failed")
        : cloud?.status === "ready" && this.#saved?.enabled === false
          ? t("customer_menu.offline")
          : this.#cloudNotice(cloud);
    return message !== nothing
      ? html`<div
          class=${unpublished ? "online-availability online-unpublished" : "online-availability"}
        >
          <wt-icon name="info" size="sm"></wt-icon>
          <p role=${failed && !unpublished ? "alert" : nothing}>${message}</p>
          ${failed && !unpublished ? html`<wt-button variant="secondary" @click=${retry}>${t("menus.retry")}</wt-button>` : nothing}
        </div>`
      : nothing;
  }

  #cloudNotice(cloud: CustomerMenuCloudStatus | null) {
    if (!cloud || cloud.status === "ready") return nothing;
    if (cloud.status === "unavailable") return t("customer_menu.not_public");
    const [before, after] = t(`customer_menu.sharing_${cloud.status}`).split("{cloudServices}");
    const label = t("nav.cloud");
    return html`${before}${this.canOpenCloudServices() ? html`<a href="/cloud">${label}</a>` : label}${after}`;
  }

  #setPublicUrl(url: string | undefined): void {
    if (url === this.#publicUrl) return;
    this.#publicUrl = url;
    this.#qr = undefined;
    this.#copyFeedback = undefined;
    window.clearTimeout(this.#copyTimer);
    if (url) {
      const setQr = (value: string | null) => {
        if (url !== this.#publicUrl) return;
        this.#qr = value;
        this.host.requestUpdate();
      };
      void toDataURL(url, { width: 512 }).then(setQr, () => setQr(null));
    }
  }

  async #copy(url: string, target: CopyTarget, text: string): Promise<void> {
    const generation = this.#generation;
    let copied = true;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      copied = false;
    }
    if (url !== this.#publicUrl || generation !== this.#generation) return;
    window.clearTimeout(this.#copyTimer);
    this.#copyFeedback = { target, copied };
    this.host.requestUpdate();
    if (copied)
      this.#copyTimer = window.setTimeout(() => {
        this.#copyFeedback = undefined;
        this.host.requestUpdate();
      }, 2000);
  }

  #copyButton(url: string, target: CopyTarget, text: string) {
    const copied = this.#copyFeedback?.target === target && this.#copyFeedback.copied;
    return html`<wt-button
      variant="secondary"
      align="start"
      icon=${copied ? "check" : "copy"}
      ?data-copied=${copied}
      @click=${() => void this.#copy(url, target, text)}
      >${t(copied ? "customer_menu.copied_button" : target === "link" ? "customer_menu.copy_link" : "customer_menu.copy_embed")}</wt-button
    >`;
  }

  #copyStatus(target: CopyTarget) {
    const feedback = this.#copyFeedback?.target === target ? this.#copyFeedback : undefined;
    const message = feedback
      ? t(feedback.copied ? "customer_menu.copied" : "customer_menu.copy_failed")
      : "";
    return html`<p
      class="online-copy-result"
      role="status"
      ?data-quiet=${feedback?.copied !== false}
    >
      ${message}
    </p>`;
  }

  #sharingControls(url: string, menuName: string, addressChanged: boolean) {
    const qr = this.#qr;
    const embed = `<iframe src="${url}" title="${t("menus.tab_customer_menu")}" loading="lazy"></iframe>`;
    return html`${
        addressChanged
          ? html`<p class="online-draft-hint">${t("customer_menu.share_on_save")}</p>`
          : nothing
      }
      ${customerMenuLink(url)} ${this.#copyStatus("link")}
      <div class="online-sharing">
        <div class="online-qr">
          ${
            qr
              ? html`<img alt=${fill("customer_menu.qr_for", { address: url })} src=${qr} />`
              : html`<p role="status">
                  ${t(qr === null ? "customer_menu.qr_failed" : "customer_menu.qr_loading")}
                </p>`
          }
        </div>
        <div class="online-share-actions">
          ${this.#copyButton(url, "link", url)}
          <wt-button
            variant="secondary"
            align="start"
            icon="download"
            aria-label=${t("customer_menu.download_qr")}
            .disabled=${!qr}
            @click=${() => {
              if (qr)
                Object.assign(document.createElement("a"), {
                  href: qr,
                  download: `${new URL(url).pathname.slice(1)}-qr.png`,
                }).click();
            }}
            >${t("action.download")}</wt-button
          >
          <wt-button
            variant="secondary"
            align="start"
            icon="print"
            aria-label=${t("customer_menu.print_qr")}
            .disabled=${!qr}
            @click=${() => qr && printEquipmentLabel({ qr, code: url, name: menuName })}
            >${t("equipment.print")}</wt-button
          >
        </div>
      </div>
      <hr class="online-divider" />
      <wt-disclosure
        @wt-toggle=${async (event: CustomEvent<{ open: boolean }>) => {
          if (!event.detail.open) return;
          const disclosure = event.currentTarget as HTMLElementTagNameMap["wt-disclosure"];
          await disclosure.updateComplete;
          await new Promise(requestAnimationFrame);
          await Promise.allSettled(
            disclosure.shadowRoot!.getAnimations().map((effect) => effect.finished),
          );
          if (disclosure.open)
            disclosure.querySelector("wt-button")?.scrollIntoView({ block: "nearest" });
        }}
        heading=${t("customer_menu.embed")}
        summary=${t("customer_menu.embed_summary")}
      >
        <div class="online-embed">
          <p>${t("customer_menu.embed_hint")}</p>
          <pre><code>${embed}</code></pre>
          ${this.#copyButton(url, "embed", embed)} ${this.#copyStatus("embed")}
        </div>
      </wt-disclosure>`;
  }

  settings(
    menuName: string,
    status: MenuStatus | null,
    previewHref: string,
    openPreview: (event: MouseEvent) => void,
    style: DirectiveResult,
    cloud: CustomerMenuCloudStatus | null,
    statusFailed: boolean,
    retryStatus: () => void,
  ) {
    const { draft } = this;
    const saving = this.pendingWrite !== undefined;
    const unpublished = status?.state === "unpublished";
    const host = cloud?.status === "ready" ? new URL(cloud.origin).hostname : undefined;
    const url =
      status && !unpublished && this.#saved?.enabled
        ? customerMenuPublicUrl(cloud, this.#saved.address)
        : undefined;
    this.#setPublicUrl(url);
    const preview = html`<a href=${previewHref} @click=${openPreview}
      >${t("customer_menu.go_to_preview")}</a
    >`;
    const availability = this.#availability(cloud, statusFailed, retryStatus, unpublished, preview);
    return html`<div class="online-settings">
      <div class="online-appearance">
        ${style}
        ${
          draft
            ? html`<hr class="online-divider" />
                <wt-segmented-control
                  name="customer-menu-photos"
                  label=${t("customer_menu.photos")}
                  .options=${CUSTOMER_MENU_PHOTO_SIZES.map((value) => ({
                    value,
                    label: t(`customer_menu.photos_${value}`),
                  }))}
                  .value=${draft.photos}
                  .disabled=${saving}
                  @wt-change=${(event: CustomEvent<{ value: CustomerMenuPhotoSize }>) =>
                    this.#edit({ photos: event.detail.value })}
                ></wt-segmented-control>`
            : nothing
        }
      </div>
      ${
        draft
          ? html`<div class="online-card">
              <wt-switch
                name="customer-menu-enabled"
                label=${t("customer_menu.online")}
                .checked=${draft.enabled}
                .disabled=${saving}
                @wt-change=${(event: CustomEvent<{ checked: boolean }>) =>
                  this.#edit({ enabled: event.detail.checked })}
              ></wt-switch>
              <div class="online-address" ?data-host=${host !== undefined}>
                ${host ? html`<p>${host}/</p>` : nothing}
                <wt-input
                  name="customer-menu-address"
                  label=${t("customer_menu.address")}
                  placeholder="lunch"
                  autocorrect="off"
                  spellcheck="false"
                  autocapitalize="none"
                  autocomplete="off"
                  .value=${draft.address ?? ""}
                  .required=${draft.enabled}
                  .disabled=${saving}
                  .error=${this.#addressError()}
                  @wt-change=${(event: CustomEvent<{ value: string }>) =>
                    this.#edit({ address: event.detail.value || null })}
                ></wt-input>
              </div>
              <hr class="online-divider" />
              ${this.#refusal && !unpublished && codeOf(this.#refusal) === "customer_menu.not_published" ? preview : nothing}
              ${url ? this.#sharingControls(url, menuName, draft.address !== this.#saved?.address) : availability}
            </div>`
          : html`<div class="online-settings-status">
              ${
                this.#loadFailed
                  ? html`<p role="alert">${t("customer_menu.settings_load_error")}</p>
                      <wt-button
                        variant="secondary"
                        @click=${() => {
                          if (this.#menuId) void this.#load(this.#menuId);
                        }}
                      >
                        ${t("menus.retry")}
                      </wt-button>`
                  : html`<p role="status">${t("customer_menu.settings_loading")}</p>`
              }
              ${availability}
            </div>`
      }
    </div>`;
  }

  #closeConfirmation(): void {
    this.#confirming = false;
    this.host.requestUpdate();
  }

  actions(blocked: boolean, mayHavePublicLink: boolean) {
    const action = saveActionState(this.#scope);
    const disabled = blocked || this.pendingWrite !== undefined || action.unchanged;
    const address = this.#addressError();
    const form =
      this.#refusal && fieldOf(this.#refusal) !== "address" && this.#feedback.shows("_form")
        ? codeMessage(codeOf(this.#refusal))
        : "";
    const message = this.#feedback.message(
      { address, form },
      new Set(address ? ["address"] : []),
      t("form.fix_fields"),
    );
    return html`<wt-form-actions class="structure-actions" .error=${message}>
        <wt-button
          slot="cancel"
          variant="secondary"
          .disabled=${disabled}
          @click=${() => this.#cancel()}
        >
          ${t("action.cancel")}
        </wt-button>
        <wt-button
          variant=${action.variant}
          .disabled=${disabled || (this.#feedback.attempted && this.#addressInvalid)}
          @click=${() => {
            if (!blocked) void this.#save(mayHavePublicLink);
          }}
          >${t("action.save")}</wt-button
        >
      </wt-form-actions>
      <wt-modal
        size="compact"
        .open=${this.#confirming}
        heading=${t(this.draft?.enabled ? "customer_menu.change_live_link" : "customer_menu.take_offline")}
        description=${t("customer_menu.old_links_stop")}
        @wt-close=${() => this.#closeConfirmation()}
      >
        <wt-form-actions slot="footer">
          <wt-button
            slot="cancel"
            variant="secondary"
            autofocus
            @click=${() => this.#closeConfirmation()}
          >
            ${t("customer_menu.keep_live_link")}
          </wt-button>
          <wt-button
            variant="danger"
            @click=${() => {
              this.#closeConfirmation();
              if (!blocked) void this.#save(false);
            }}
            >${t("action.save")}</wt-button
          >
        </wt-form-actions>
      </wt-modal>`;
  }
}
